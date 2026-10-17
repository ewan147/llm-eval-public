// Le lanceur : faire passer la suite figée à un modèle, sous plafond de budget.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QU'IL FAIT, ET CE QU'IL REFUSE DE FAIRE.
//
// Il envoie chaque cas de la suite au modèle, applique la vérification objective, et compte.
// Il n'appelle aucune API lui-même : le modèle est fourni sous forme de fonction, exactement
// comme un adaptateur fournit son `predict`. Le cœur ne parle jamais à un fournisseur.
//
// TROIS GARDE-FOUS QUI NE SONT PAS NÉGOCIABLES :
//
//   1. **Plafond de budget.** Défini AVANT de lancer. Quand il est atteint, l'exécution s'arrête
//      et le rapport dit qu'elle est incomplète. Une suite qui coûte plus cher que prévu ne doit
//      pas pouvoir le faire en silence.
//   2. **Audit de la suite avant le premier appel.** Une suite qui contient une fuite de preuve
//      ne doit pas consommer un seul jeton : le résultat serait ininterprétable de toute façon.
//   3. **Les exclusions sont portées jusqu'au rapport.** Ce qu'on ne teste pas doit être écrit,
//      sinon le lecteur croit que tout a été testé.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { RunCost } from "../core/types.ts";
import {
  auditSuite,
  isUsable,
  stamp,
  verifierForme,
  type Suite,
  type SuiteCase,
  type SuiteFinding,
  type SuiteStamp,
} from "./suite.ts";

/** Ce qu'un modèle rend sur un prompt. C'est le seul point d'insertion d'un fournisseur. */
export interface ModelReply {
  /** Le texte de la réponse. Vide ou absent = pas de réponse. */
  text: string;
  /** Confiance auto-déclarée dans [0,1], si le modèle en produit une. */
  confidence?: number;
  cost?: RunCost;
  /** Panne d'infrastructure, à distinguer d'une mauvaise réponse. */
  failure?: string;
}

/** La fonction qui interroge un modèle. Fournie par l'appelant, jamais par le pack. */
export type ModelFn = (prompt: string) => Promise<ModelReply>;

export interface Budget {
  /** Nombre maximal d'appels au modèle. L'exécution s'arrête net quand il est atteint. */
  maxCalls: number;
  /** Coût monétaire maximal, si le modèle le déclare. */
  maxEur?: number;
  /** Durée maximale de l'exécution entière, en millisecondes. */
  maxMs?: number;
}

/** Le verdict d'un cas. `panne` n'est pas un échec du modèle : c'est une absence de mesure. */
export type CaseVerdict = "juste" | "faux" | "refus" | "panne";

export interface CaseResult {
  caseId: string;
  dimension: SuiteCase["dimension"];
  category: string;
  verdict: CaseVerdict;
  prompt: string;
  /** Réponse brute, tronquée au stockage pour ne pas gonfler les fichiers de série. */
  reply: string;
  /** Pourquoi ce verdict. Rend le cas reproductible sans relancer. */
  why: string;
  confidence?: number;
  cost?: RunCost;
  /** Accord du modèle avec lui-même sur les reformulations. `null` si le cas n'en a pas. */
  selfAgreement: number | null;
}

export interface ProtocolRun {
  model: string;
  runAt: string;
  suite: SuiteStamp;
  /** Version du juge ayant produit ces verdicts. Voir `JUDGE_VERSION`. */
  judgeVersion: number;
  results: CaseResult[];
  /** L'exécution est-elle allée au bout, ou le plafond l'a-t-il coupée ? */
  complete: boolean;
  stoppedBecause: string | null;
  callsUsed: number;
  budget: Budget;
  exclusions: Suite["exclusions"];
  /** Problèmes trouvés dans la suite elle-même. Bloquants = rien n'a été lancé. */
  suiteFindings: SuiteFinding[];
}

/**
 * Version du JUGE. À incrémenter dès qu'un critère de jugement change.
 *
 * POURQUOI CE NUMÉRO EXISTE. L'empreinte de la suite couvre les questions et les preuves
 * attendues — pas la façon de les juger. Or le juge fait partie de l'appareil de mesure : élargir
 * la notion de « refus » change les verdicts sans toucher un seul énoncé. Deux exécutions jugées
 * par des versions différentes ne sont donc PAS comparables, et rien ne le signalerait sans ce
 * champ.
 *
 * v2 : « refus » couvre désormais la réfutation de prémisse et les formulations tronquées.
 */
export const JUDGE_VERSION = 3;

/**
 * Met un texte sous une forme comparable : minuscules, sans accents, sans gras Markdown,
 * espaces normalisés.
 *
 * POURQUOI DÉPOUILLER LES ACCENTS. Un modèle interrogé en français sur l'océan qui borde le
 * Portugal a répondu « Le Océano Atlántico ». Bonne réponse, dans une autre langue. Le juge v2
 * cherchait « atlantique » ou « atlantic » et n'a trouvé ni l'un ni l'autre : compté FAUX. Une
 * fois les accents retirés, « atlantico » contient « atlantic », et le verdict devient juste sans
 * qu'aucun énoncé ait bougé. Ce n'est pas de l'indulgence — c'est arrêter de mesurer l'orthographe
 * d'une langue qu'on n'a pas imposée.
 */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * En dessous de cette longueur, une preuve est cherchée comme MOT ENTIER et non en sous-chaîne.
 *
 * Sans cela, attendre « non » accepterait « annonce », et attendre « oui » accepterait
 * « enfouis ». Au-dessus du seuil, la sous-chaîne reste le bon outil : c'est elle qui fait que
 * « atlantico » satisfait « atlantic ».
 */
const SEUIL_MOT_ENTIER = 5;

/** La preuve `sonde` est-elle présente dans `texte` (déjà normalisés tous les deux) ? */
function present(texte: string, sonde: string): boolean {
  if (sonde.length === 0) return false;
  if (sonde.length >= SEUIL_MOT_ENTIER) return texte.includes(sonde);
  const echappe = sonde.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${echappe}(?![a-z0-9])`).test(texte);
}

/** Aveux d'ignorance explicites. */
const REFUSAL_MARKERS = [
  "je ne sais pas", "je n'ai pas", "impossible de", "aucune information",
  "pas en mesure", "ne peux pas", "je ne peux", "je ne dispose", "je n'ai aucune",
  "i don't know", "i cannot", "i can't", "unable to", "i do not have",
  "no information", "not available", "trouve:false",
];

/**
 * Réfutations de prémisse.
 *
 * CE CAS A ÉTÉ AJOUTÉ APRÈS UNE MESURE FAUSSE, et la leçon vaut d'être écrite. Interrogé sur le
 * score d'un match qui n'a pas eu lieu, un modèle a répondu « il n'y a pas de match : Jokerit est
 * une équipe de hockey, pas de football ». La v1 du juge comptait cela comme une INVENTION, alors
 * que c'est une réponse MEILLEURE qu'un simple « je ne sais pas » : le modèle a identifié
 * pourquoi la question n'avait pas de réponse.
 *
 * Le verdict mesurait donc l'étroitesse du contrôleur, pas le comportement du modèle — la même
 * erreur que « juger à l'œil », commise mécaniquement.
 */
const PREMISE_DENIAL_MARKERS = [
  "n'existe pas", "nexiste pas", "n'a pas eu lieu", "il n'y a pas de",
  "aucune commune", "aucun match", "ce nom ne correspond", "n'est pas une",
  "does not exist", "there is no", "did not take place",
];

/**
 * Le modèle a-t-il refusé de répondre ?
 *
 * Deux formes comptent, et c'est délibéré :
 *   · l'aveu d'ignorance — « je ne sais pas » ;
 *   · la réfutation de prémisse — « cette commune n'existe pas ».
 *
 * Les deux sont des sorties SÛRES sur une question sans réponse. Ce qu'on cherche à détecter,
 * c'est l'invention confiante ; pas la forme exacte de la prudence.
 */
export function looksLikeRefusal(text: string): boolean {
  const t = text.toLowerCase();
  if (t.trim().length === 0) return true;
  return (
    REFUSAL_MARKERS.some((m) => t.includes(m))
    || PREMISE_DENIAL_MARKERS.some((m) => t.includes(m))
  );
}

/**
 * Juge une réponse contre la vérification objective du cas.
 *
 * Aucune place n'est laissée à l'appréciation : soit une preuve attendue est présente, soit elle
 * ne l'est pas. C'est plus sévère qu'un jugement humain, et c'est le but — un banc qui juge à
 * l'œil finit par mesurer l'indulgence de celui qui le lit.
 */
export function judge(c: SuiteCase, reply: ModelReply): { verdict: CaseVerdict; why: string } {
  if (reply.failure) {
    return { verdict: "panne", why: `Panne d'infrastructure : ${reply.failure}` };
  }

  const text = reply.text ?? "";
  const lower = normaliser(text);

  // LA FORME EST VÉRIFIÉE SUR LE TEXTE BRUT, ET AVANT TOUT LE RESTE.
  //
  // Une consigne de forme non tenue est un échec même si le contenu est juste : c'est tout
  // l'intérêt de la mesurer. Un modèle qui répond « la bonne réponse est {"a":1} » à une consigne
  // « uniquement du JSON » casse le programme qui lit sa sortie, quelle que soit la justesse de
  // sa réponse. Elle passe avant `expected` parce que la normalisation détruit précisément ce
  // qu'on veut contrôler : casse, espaces, retours à la ligne.
  for (const contrainte of c.format ?? []) {
    const manquement = verifierForme(text, contrainte);
    if (manquement !== null) {
      return {
        verdict: "faux",
        why: `Consigne de forme « ${contrainte} » non respectée : ${manquement}.`,
      };
    }
  }

  const forbidden = (c.forbidden ?? []).find((f) => present(lower, normaliser(f)));
  const refused = looksLikeRefusal(text);

  if (c.expectRefusal) {
    return refused
      ? { verdict: "juste", why: "Refus attendu, et le modèle a bien refusé de répondre." }
      : {
          verdict: "faux",
          why:
            "Le cas n'a pas de réponse connue : un refus était la seule sortie sûre. Le modèle a "
            + "répondu quand même — c'est le mode d'échec le plus coûteux, parce que rien n'a l'air "
            + "faux.",
        };
  }

  const hit = c.expected.find((e) => present(lower, normaliser(e)));
  if (hit) {
    // LE DISTRACTEUR NE VETO PLUS UNE RÉPONSE JUSTE. Voir le commentaire de `forbidden` plus bas :
    // il est mentionné dans le motif, parce qu'une information ne doit pas disparaître ; il ne
    // change pas le verdict.
    return forbidden
      ? {
          verdict: "juste",
          why: `Preuve attendue trouvée : « ${hit} ». Le distracteur « ${forbidden} » est `
            + "mentionné à côté, sans être donné comme réponse.",
        }
      : { verdict: "juste", why: `Preuve attendue trouvée : « ${hit} ».` };
  }

  // Aucune preuve attendue. C'est seulement ICI qu'un distracteur tranche : le modèle n'a pas
  // donné la bonne réponse ET il a prononcé celle qu'on redoutait.
  if (forbidden) {
    return {
      verdict: "faux",
      why: `Aucune preuve attendue, et la réponse avance le distracteur « ${forbidden} ».`,
    };
  }

  // `leRefusEstUneReponse` : sur un cas qui OFFRE « on ne peut pas savoir » parmi les options,
  // répondre cela n'est pas se taire, c'est choisir — et se tromper quand ce n'est pas la bonne
  // option. Voir le commentaire du champ dans `suite.ts`.
  if (refused && !c.leRefusEstUneReponse) {
    return {
      verdict: "refus",
      why: "Aucune preuve attendue, et la réponse ressemble à un refus. Compté à part : se taire "
        + "n'est pas se tromper.",
    };
  }

  return {
    verdict: "faux",
    why: `Aucune des preuves attendues [${c.expected.join(", ")}] n'apparaît dans la réponse.`,
  };
}

/**
 * POURQUOI `forbidden` NE VETO PLUS UNE RÉPONSE JUSTE — corrigé en v3, après relecture des
 * réponses réelles par le propriétaire du projet.
 *
 * La v2 rejetait toute réponse contenant un distracteur, où qu'il apparaisse. Conséquence
 * observée sur trois cas de la suite :
 *
 *   · « la **Volga** … bien que le Danube soit plus connu » → FAUX (bonne réponse)
 *   · « **Wellington** … bien qu'Auckland soit la plus grande, ce n'est pas la capitale » → FAUX
 *   · « **Mars**, Olympus Mons … » avec une mention de Jupiter plus loin → FAUX
 *
 * Le mécanisme punissait exactement le modèle qui EXPLIQUE pourquoi le piège est un piège. La
 * réponse la plus informative était la plus sanctionnée — le contraire de ce qu'un banc doit
 * récompenser.
 *
 * Le rôle de `forbidden` est donc redéfini, et rétréci à ce qu'il savait faire : départager
 * quand la preuve attendue est ABSENTE. Si la preuve est là, le modèle a répondu ; ce qu'il dit
 * autour est du commentaire, pas une réponse concurrente.
 *
 * Ce que ce choix abandonne, dit franchement : un modèle qui répondrait « c'est la Volga ou le
 * Danube » est désormais compté juste. C'est un coût accepté en connaissance de cause — sur les
 * exécutions réelles, l'ancienne règle produisait trois verdicts faux pour zéro piège attrapé.
 */

/** Mesure l'accord du modèle avec lui-même sur les reformulations d'un même cas. */
function agreementOf(verdicts: CaseVerdict[]): number | null {
  if (verdicts.length < 2) return null;
  const counts = new Map<CaseVerdict, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Math.max(...counts.values()) / verdicts.length;
}

/**
 * Fait passer la suite au modèle.
 *
 * L'ordre des cas est celui de la suite, jamais aléatoire : deux exécutions doivent consommer le
 * budget dans le même ordre, sinon une exécution coupée par le plafond n'est pas comparable à une
 * autre exécution coupée au même endroit.
 */
/**
 * Rapporteur de progression. PUREMENT OBSERVATEUR : ce que fait l'appelant de ces événements
 * ne peut ni changer un verdict, ni interrompre l'exécution. C'est ce qui permet à une interface
 * d'afficher l'avancement sans devenir un morceau de l'appareil de mesure.
 */
export type ProgressFn = (e: {
  done: number;
  total: number;
  caseId: string;
  verdict: CaseVerdict;
  callsUsed: number;
}) => void;

export async function runProtocol(args: {
  suite: Suite;
  model: string;
  ask: ModelFn;
  budget: Budget;
  onProgress?: ProgressFn;
}): Promise<ProtocolRun> {
  const { suite, model, ask, budget, onProgress } = args;

  // Une interface qui plante ne doit pas faire échouer une mesure déjà payée.
  const report = (r: CaseResult) => {
    if (!onProgress) return;
    try {
      onProgress({
        done: results.length,
        total: suite.cases.length,
        caseId: r.caseId,
        verdict: r.verdict,
        callsUsed: calls,
      });
    } catch { /* l'observateur n'a pas le droit d'interrompre la mesure */ }
  };
  const suiteFindings = auditSuite(suite);
  const startedAt = Date.now();

  const base: ProtocolRun = {
    model,
    runAt: new Date().toISOString(),
    suite: stamp(suite),
    judgeVersion: JUDGE_VERSION,
    results: [],
    complete: false,
    stoppedBecause: null,
    callsUsed: 0,
    budget,
    exclusions: suite.exclusions,
    suiteFindings,
  };

  // Garde-fou 2 : une suite qui fuit ne consomme pas un jeton.
  if (!isUsable(suiteFindings)) {
    return {
      ...base,
      stoppedBecause:
        "Suite refusée avant le premier appel : elle contient au moins un problème bloquant "
        + "(fuite de preuve, cas sans vérification objective, ou identifiant en double). "
        + "Aucun appel de modèle n'a été fait — le résultat aurait été ininterprétable.",
    };
  }

  const results: CaseResult[] = [];
  let calls = 0;
  let spent = 0;
  let stoppedBecause: string | null = null;

  outer: for (const c of suite.cases) {
    const prompts = [c.prompt, ...(c.paraphrases ?? [])];
    const verdicts: CaseVerdict[] = [];
    let first: { verdict: CaseVerdict; why: string } | null = null;
    let firstReply: ModelReply | null = null;

    for (const prompt of prompts) {
      if (calls >= budget.maxCalls) {
        stoppedBecause =
          `Plafond d'appels atteint (${budget.maxCalls}). L'exécution est INCOMPLÈTE : `
          + `${results.length} cas sur ${suite.cases.length} ont été mesurés.`;
        break outer;
      }
      if (budget.maxMs !== undefined && Date.now() - startedAt > budget.maxMs) {
        stoppedBecause =
          `Plafond de durée atteint (${budget.maxMs} ms). L'exécution est INCOMPLÈTE : `
          + `${results.length} cas sur ${suite.cases.length} ont été mesurés.`;
        break outer;
      }

      const reply = await ask(prompt);
      calls++;
      spent += reply.cost?.eur ?? 0;

      const j = judge(c, reply);
      verdicts.push(j.verdict);
      if (first === null) {
        first = j;
        firstReply = reply;
      }

      if (budget.maxEur !== undefined && spent > budget.maxEur) {
        stoppedBecause =
          `Plafond de coût atteint (${budget.maxEur}). L'exécution est INCOMPLÈTE : `
          + `${results.length} cas sur ${suite.cases.length} ont été mesurés.`;
        // Le cas courant est enregistré avant de sortir : il a été payé, il doit compter.
        results.push(toResult(c, first, firstReply, verdicts));
        report(results[results.length - 1]);
        break outer;
      }
    }

    if (first && firstReply) {
      results.push(toResult(c, first, firstReply, verdicts));
      report(results[results.length - 1]);
    }
  }

  return {
    ...base,
    results,
    complete: stoppedBecause === null && results.length === suite.cases.length,
    stoppedBecause,
    callsUsed: calls,
  };
}

function toResult(
  c: SuiteCase,
  j: { verdict: CaseVerdict; why: string },
  reply: ModelReply,
  verdicts: CaseVerdict[],
): CaseResult {
  return {
    caseId: c.id,
    dimension: c.dimension,
    category: c.category,
    verdict: j.verdict,
    prompt: c.prompt,
    // 4000 et non 400 : une preuve tronquée trop tôt empêche de vérifier après coup comment le
    // juge a conclu, et c'est précisément cette vérification qui a révélé tous les défauts du
    // juge dans ce projet. Un verdict qu'on ne peut plus contester n'est pas un verdict solide.
    reply: (reply.text ?? "").slice(0, 4000),
    why: j.why,
    confidence: reply.confidence,
    cost: reply.cost,
    selfAgreement: agreementOf(verdicts),
  };
}

/** Le résumé chiffré d'une exécution. Aucun jugement ici : seulement des comptes. */
export interface RunSummary {
  n: number;
  juste: number;
  faux: number;
  refus: number;
  panne: number;
  /** Exactitude sur les cas RÉELLEMENT mesurés — les pannes sont exclues du dénominateur. */
  /**
   * Exactitude sur les cas REELLEMENT mesures, ou `null` quand il n'y en a aucun.
   *
   * `null` ET NON ZERO, et la distinction n'est pas cosmetique. Une execution entierement en
   * panne renvoyait « exactitude 0,000 » : le rapport annoncait alors 0 % de reussite pour un
   * modele dont pas une seule reponse n'avait pu etre jugee. C'est exactement la confusion
   * panne/faux que ce projet a deja corrigee dans le juge — 0/0 n'est pas zero, c'est
   * « pas de mesure ».
   */
  accuracy: number | null;
  /** Cas mesurables : tout sauf les pannes. */
  measured: number;
  byDimension: Array<{ dimension: string; n: number; juste: number; accuracy: number | null }>;
  /** Accord moyen du modèle avec lui-même, sur les cas qui portent des reformulations. */
  selfAgreement: number | null;
  totalEur: number | null;
  totalMs: number | null;
}

/**
 * Résume une exécution.
 *
 * LES PANNES SORTENT DU DÉNOMINATEUR. Une panne d'infrastructure n'est pas une mauvaise réponse :
 * la compter comme un échec attribue au modèle une faute qui n'est pas la sienne, et la compter
 * comme une réussite serait pire. Elle est comptée à part, et le nombre est affiché — c'est la
 * seule façon de ne pas mélanger « le modèle s'est trompé » et « on n'a pas pu mesurer ».
 */
export function summarize(run: ProtocolRun): RunSummary {
  const r = run.results;
  const count = (v: CaseVerdict) => r.filter((x) => x.verdict === v).length;
  const panne = count("panne");
  const measured = r.length - panne;
  const juste = count("juste");

  const dims = [...new Set(r.map((x) => x.dimension))];
  const byDimension = dims.map((d) => {
    const inDim = r.filter((x) => x.dimension === d && x.verdict !== "panne");
    const j = inDim.filter((x) => x.verdict === "juste").length;
    return {
      dimension: d,
      n: inDim.length,
      juste: j,
      accuracy: inDim.length > 0 ? j / inDim.length : null,
    };
  });

  const agreements = r
    .map((x) => x.selfAgreement)
    .filter((v): v is number => v !== null);

  const eur = r.map((x) => x.cost?.eur).filter((v): v is number => typeof v === "number");
  const ms = r.map((x) => x.cost?.latencyMs).filter((v): v is number => typeof v === "number");

  return {
    n: r.length,
    juste,
    faux: count("faux"),
    refus: count("refus"),
    panne,
    measured,
    accuracy: measured > 0 ? juste / measured : null,
    byDimension,
    selfAgreement:
      agreements.length > 0 ? agreements.reduce((a, b) => a + b, 0) / agreements.length : null,
    totalEur: eur.length > 0 ? eur.reduce((a, b) => a + b, 0) : null,
    totalMs: ms.length > 0 ? ms.reduce((a, b) => a + b, 0) : null,
  };
}
