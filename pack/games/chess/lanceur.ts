// Faire passer l'épreuve d'échecs à un modèle, et faire s'affronter deux modèles.
//
// Ce fichier joue pour les échecs le rôle que `protocols/runner.ts` joue pour la suite textuelle :
// il dépense des appels sous plafond, il audite avant de dépenser, et il ne juge rien lui-même —
// c'est le moteur qui tranche.

import type { ModelFn } from "../../protocols/runner.ts";
import {
  auditerEchecs,
  CAS,
  jouerPartie,
  jugerEchecs,
  resumerEchecs,
  type CasEchecs,
  type DefautEchecs,
  type Partie,
  type ResultatEchecs,
  type ResumeEchecs,
} from "./epreuve.ts";

/**
 * Version du juge d'échecs. Même rôle que `JUDGE_VERSION` : il fait partie de l'instrument, et
 * deux exécutions jugées par des versions différentes ne sont pas comparables.
 *
 * v2 : le coup n'est plus cherché n'importe où dans la réponse, mais uniquement là où un modèle
 * place la sienne — réponse entière si brève, dernière ligne, première ligne, gras, marqueur
 * explicite. La v1 balayait toute la prose et retenait le premier mot formant un coup légal :
 * un modèle ayant écrit une page d'analyse s'est vu créditer d'un « e3 » trouvé dans une phrase
 * sur les pions adverses, alors qu'il proposait tout autre chose. Faux ACCEPT — celui qui gonfle
 * un score, et que relire les réponses fausses ne révèle jamais.
 *
 * Effet mesuré sur gemma3:4b : taux de légalité 46,2 % en v1, 30,8 % en v2. L'écart est
 * entièrement fait de coups qu'il n'avait pas proposés.
 */
/**
 * v3 : le gras n'est retenu que s'il est UNIQUE, la première ligne n'est plus un emplacement de
 * réponse, et un texte de plus de quarante caractères n'est plus fouillé.
 *
 * La v2 restait trompée par deux formes très courantes chez les modèles bavards :
 *   · l'ÉNUMÉRATION — « les coups légaux incluent : **e4** : le pion e2 peut avancer… ». Retenir
 *     « e4 » revenait à choisir à sa place dans une liste d'exemples.
 *   · la POSITION INVENTÉE — « la position que tu décris est incomplète, je vais supposer que le
 *     roi blanc est en **e1**… ». Le modèle annonce qu'il ne lit pas la position, en invente une
 *     autre, et se voyait créditer d'un coup juste.
 *
 * Un modèle qui n'écrit pas son coup sous une forme identifiable compte désormais « illisible » :
 * il n'a pas suivi une consigne qui disait « réponds UNIQUEMENT par le coup ». C'est un défaut
 * réel et mesurable, à ne pas confondre avec « ne connaît pas les règles ».
 */
export const VERSION_JUGE_ECHECS = 3;

export interface ExecutionEchecs {
  modele: string;
  executeLe: string;
  versionJuge: number;
  resultats: ResultatEchecs[];
  resume: ResumeEchecs;
  complete: boolean;
  arreteParce: string | null;
  appels: number;
  defauts: DefautEchecs[];
}

export async function lancerEchecs(args: {
  modele: string;
  demander: ModelFn;
  cas?: CasEchecs[];
  maxAppels?: number;
  maxMs?: number;
  surAvancee?: (e: { fait: number; total: number; casId: string; verdict: string }) => void;
}): Promise<ExecutionEchecs> {
  const cas = args.cas ?? CAS;
  const maxAppels = args.maxAppels ?? 100;
  const defauts = auditerEchecs(cas);
  const debut = Date.now();

  const base: ExecutionEchecs = {
    modele: args.modele,
    executeLe: new Date().toISOString(),
    versionJuge: VERSION_JUGE_ECHECS,
    resultats: [],
    resume: resumerEchecs([]),
    complete: false,
    arreteParce: null,
    appels: 0,
    defauts,
  };

  // Une position fausse ne consomme pas un jeton : le résultat serait ininterprétable.
  if (defauts.length > 0) {
    return {
      ...base,
      arreteParce:
        "Positions refusées avant le premier appel : au moins une ne tient pas ce qu'elle "
        + "annonce. Aucun appel n'a été fait.",
    };
  }

  const resultats: ResultatEchecs[] = [];
  let appels = 0;
  let arreteParce: string | null = null;

  for (const c of cas) {
    if (appels >= maxAppels) {
      arreteParce = `Plafond d'appels atteint (${maxAppels}). Exécution INCOMPLÈTE : `
        + `${resultats.length} positions sur ${cas.length}.`;
      break;
    }
    if (args.maxMs !== undefined && Date.now() - debut > args.maxMs) {
      arreteParce = `Plafond de durée atteint. Exécution INCOMPLÈTE : ${resultats.length} `
        + `positions sur ${cas.length}.`;
      break;
    }

    const r = await args.demander(prompt(c));
    appels++;
    const juge = jugerEchecs(c, r.text ?? "", r.failure);
    resultats.push(juge);
    try {
      args.surAvancee?.({
        fait: resultats.length, total: cas.length, casId: c.id, verdict: juge.verdict,
      });
    } catch { /* l'observateur n'interrompt jamais une mesure déjà payée */ }
  }

  return {
    ...base,
    resultats,
    resume: resumerEchecs(resultats),
    complete: arreteParce === null && resultats.length === cas.length,
    arreteParce,
    appels,
  };
}

function prompt(c: CasEchecs): string {
  return (
    `Position d'échecs, notation FEN : ${c.fen}\n\n${c.consigne}\n\n`
    + "Réponds UNIQUEMENT par le coup en notation algébrique (exemples : e4, Nf3, O-O, "
    + "exd5, e8=Q). Aucune explication."
  );
}

// ── Duel ──────────────────────────────────────────────────────────────────────────────────────

export interface Duel {
  blancs: string;
  noirs: string;
  parties: Partie[];
  /** Points au sens des échecs : 1 pour un gain, 0,5 pour une nulle. */
  points: { a: number; b: number };
  /** Ce que le duel permet de dire. Souvent : rien. */
  verdict: string;
}

/**
 * Fait disputer `n` parties, couleurs alternées.
 *
 * LES COULEURS ALTERNENT, et ce n'est pas un détail : les blancs ont un avantage réel et bien
 * mesuré aux échecs. Faire jouer un modèle toujours en blancs lui offrirait des points qui ne
 * viennent pas de sa force. Avec un nombre impair de parties, l'un des deux a les blancs une fois
 * de plus — c'est dit dans le verdict.
 */
export async function duel(
  a: { nom: string; demander: ModelFn },
  b: { nom: string; demander: ModelFn },
  parties = 5,
  options: { maxDemiCoups?: number; essais?: number } = {},
): Promise<Duel> {
  const jouees: Partie[] = [];
  const points = { a: 0, b: 0 };

  for (let i = 0; i < parties; i++) {
    const aEstBlanc = i % 2 === 0;
    const blancs = aEstBlanc ? a : b;
    const noirs = aEstBlanc ? b : a;

    const p = await jouerPartie(
      { nom: blancs.nom, demander: blancs.demander },
      { nom: noirs.nom, demander: noirs.demander },
      options,
    );
    jouees.push(p);

    if (p.resultat === "1-0") { if (aEstBlanc) points.a++; else points.b++; }
    else if (p.resultat === "0-1") { if (aEstBlanc) points.b++; else points.a++; }
    else { points.a += 0.5; points.b += 0.5; }
  }

  return { blancs: a.nom, noirs: b.nom, parties: jouees, points, verdict: verdictDuel(a.nom, b.nom, points, jouees) };
}

/**
 * Ce qu'un duel de quelques parties autorise à dire.
 *
 * La réponse est presque toujours « pas grand-chose », et c'est le comportement voulu. Cinq
 * parties, c'est l'ordre de grandeur où un écart de deux points s'obtient par hasard une fois sur
 * cinq entre deux adversaires de force égale. Annoncer « A est plus fort que B » sur cette base
 * serait exactement le chiffre que ce projet refuse de produire.
 */
function verdictDuel(
  nomA: string, nomB: string, points: { a: number; b: number }, parties: Partie[],
): string {
  const n = parties.length;
  const ecart = Math.abs(points.a - points.b);
  const meneur = points.a > points.b ? nomA : nomB;

  const illegales = parties.filter((p) => /coup légal en/.test(p.cause)).length;
  const detail = illegales > 0
    ? ` ${illegales} partie(s) sur ${n} se sont terminées faute de coup légal, pas sur l'échiquier : `
      + "à ce niveau, le duel mesure surtout la connaissance des règles."
    : "";

  if (n < 10) {
    return (
      `${points.a}–${points.b} sur ${n} parties. INSUFFISANT POUR CLASSER : sur si peu de parties, `
      + `un écart de ${ecart} point(s) s'obtient couramment entre adversaires de force égale. `
      + `Le résultat est un fait, ce n'est pas un classement.${detail}`
    );
  }
  if (ecart === 0) return `Égalité ${points.a}–${points.b} sur ${n} parties.${detail}`;
  return (
    `${meneur} mène ${Math.max(points.a, points.b)}–${Math.min(points.a, points.b)} sur ${n} `
    + `parties. À interpréter avec prudence : un duel n'est pas un Elo.${detail}`
  );
}
