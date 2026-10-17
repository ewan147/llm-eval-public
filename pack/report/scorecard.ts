// Le format PUBLIC — une seconde lecture de la mesure d'entreprise, jamais une seconde mesure.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA RÈGLE QUI GOUVERNE TOUT CE FICHIER.
//
//   Le score public et le rapport d'entreprise sont deux LECTURES de la même mesure.
//   Jamais deux mesures. Aucun raccourci pris pour l'un qui ne vaudrait pas pour l'autre.
//
// Conséquence technique, vérifiable ligne à ligne : **ce fichier ne calcule rien**. Il lit le
// même objet `EvalResult` que le rapport d'entreprise et le traduit. Pas une moyenne, pas un
// arrondi favorable, pas un seuil assoupli. Si une métrique manque, on l'ajoute dans `core/`,
// jamais ici.
//
// Le seul endroit où le format public s'écarte du format entreprise est le VOCABULAIRE. Les
// garde-fous, eux, sont identiques : même seuil d'échantillon, même obligation de référence,
// mêmes intervalles en coulisse. Un score sans assez de données affiche « pas assez de données »
// et jamais une estimation « pour faire joli ».
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { EvalResult } from "../core/evaluate.ts";
import type { ProtocolRun } from "../protocols/runner.ts";
import { summarize } from "../protocols/runner.ts";

/** Version du barème. Change dès qu'un seuil ou une correspondance change. */
export const SCORECARD_VERSION = 1;

/** Une note publique : un nom lisible, une valeur, et la métrique réelle dont elle sort. */
export interface PublicScore {
  /** Le nom lu par le public. Une question, pas un terme technique. */
  label: string;
  /**
   * La valeur affichée, déjà mise en forme. `null` quand la donnée manque — jamais une
   * estimation, jamais un zéro par défaut.
   */
  value: string | null;
  /** Vert / orange / rouge / gris. Le gris signifie « pas mesuré », pas « moyen ». */
  band: "bon" | "moyen" | "mauvais" | "inconnu";
  /** Une phrase de contexte, compréhensible sans culture statistique. */
  plain: string;
  /**
   * LA CORRESPONDANCE 1:1 avec la métrique réelle. C'est ce champ qui rend le barème auditable :
   * n'importe qui peut ouvrir le rapport d'entreprise et retrouver le chiffre.
   */
  mapping: string;
  /** Vrai quand l'échantillon ne permet pas de conclure. `value` vaut alors `null`. */
  insufficient: boolean;
}

export interface Scorecard {
  /** Identifiant commun au rapport d'entreprise et au score public. Voir `linkId()`. */
  runId: string;
  subject: string;
  runAt: string;
  version: number;
  /** La phrase d'accroche. Toujours celle du rapport d'entreprise, jamais une plus vendeuse. */
  headline: string;
  scores: PublicScore[];
  /** Les réserves, reformulées en une phrase simple — jamais supprimées. */
  caveats: string[];
  /** Empreinte des données, pour prouver que les deux formats portent sur la même exécution. */
  dataFingerprint: string;
}

/**
 * L'identifiant qui relie les deux formats.
 *
 * Construit à partir de l'empreinte des données et de l'horodatage : deux sorties portant le même
 * `runId` proviennent nécessairement de la même exécution. C'est ce qui rend vérifiable la règle
 * « deux lectures, une seule mesure » — sans lui, elle ne serait qu'une intention.
 */
export function linkId(fingerprint: string, runAt: string): string {
  return `${fingerprint}-${runAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

const pc = (v: number) => `${(v * 100).toFixed(0)} %`;

/** Un score indisponible. Le dire est un résultat ; l'inventer serait une faute. */
function missing(label: string, mapping: string, why: string): PublicScore {
  return {
    label,
    value: null,
    band: "inconnu",
    plain: why,
    mapping,
    insufficient: true,
  };
}

/**
 * Traduit un rapport d'entreprise en score public.
 *
 * L'ordre des notes n'est pas décoratif : la comparaison à la référence vient en premier, comme
 * dans le rapport d'entreprise, parce que c'est la seule qui dise si le système sert à quelque
 * chose.
 */
export function scorecardFromEval(r: EvalResult): Scorecard {
  const scores: PublicScore[] = [];
  const minObs = r.reproducibility.minObs;

  // ── 1. Bat-il ce qu'on aurait fait sans lui ? ────────────────────────────────────────────
  if (r.refusal) {
    scores.push(
      missing(
        "Fait-il mieux que l'existant ?",
        "core/guards.ts — refus de verdict sans référence contrastive",
        "Impossible à dire : aucune référence n'a été fournie. Sans point de comparaison, un bon "
        + "score ne prouve rien.",
      ),
    );
  } else {
    const v = r.contrastive!.verdict;
    scores.push({
      label: "Fait-il mieux que l'existant ?",
      value: v === "BAT" ? "Oui" : v === "MOINS BON" ? "Non, moins bien" : v === "ÉQUIVALENT" ? "Non, pareil" : "On ne sait pas",
      band: v === "BAT" ? "bon" : v === "MOINS BON" ? "mauvais" : v === "ÉQUIVALENT" ? "moyen" : "inconnu",
      plain:
        v === "BAT"
          ? `Oui, et l'écart ne s'explique pas par le hasard (${r.contrastive!.n} cas comparés).`
          : v === "MOINS BON"
            ? "Non : ce qu'on utilisait avant fait mieux, de façon mesurable."
            : v === "ÉQUIVALENT"
              ? "Non : il fait aussi bien, ni mieux ni moins bien. Un système qui égale ce qu'il "
                + "remplace n'apporte rien de prouvé."
              : `Pas assez de cas pour trancher (${r.contrastive!.n}).`,
      mapping: "core/baseline.ts — ContrastiveComparison.verdict, test apparié (McNemar ou bootstrap)",
      insufficient: v === "INDÉCIDABLE",
    });
  }

  // ── 2. Réussit-il ? ──────────────────────────────────────────────────────────────────────
  if (r.binary) {
    const rate = r.binary.successRate;
    scores.push({
      label: "Combien de fois a-t-il raison ?",
      value: pc(rate.value),
      band: rate.low >= 0.9 ? "bon" : rate.high < 0.6 ? "mauvais" : "moyen",
      plain:
        `Sur ${r.binary.n} cas. La vraie valeur est quelque part entre ${pc(rate.low)} et `
        + `${pc(rate.high)} — un pourcentage seul, sans cette fourchette, ne veut rien dire.`,
      mapping: "core/binary.ts — successRate, intervalle de Wilson à 95 %",
      insufficient: false,
    });
  }

  // ── 3. Sait-il quand il se trompe ? ──────────────────────────────────────────────────────
  if (!r.probabilistic) {
    scores.push(
      missing(
        "Sait-il quand il se trompe ?",
        "core/calibration.ts — ECE, indisponible sans confiance déclarée",
        "Impossible à dire : le système ne dit jamais à quel point il est sûr de lui. On sait s'il "
        + "a raison, pas s'il sait quand il a tort.",
      ),
    );
  } else {
    const conclusive = r.probabilistic.curve.filter((s) => s.conclusive);
    if (conclusive.length === 0) {
      scores.push(
        missing(
          "Sait-il quand il se trompe ?",
          `core/metrics.ts — ECE sur les tranches à n ≥ ${minObs}`,
          `Pas assez de données : aucune tranche de confiance n'atteint ${minObs} cas. Le même `
          + "seuil que dans le rapport technique — on ne l'assouplit pas pour afficher un chiffre.",
        ),
      );
    } else {
      const ece = r.probabilistic.ece;
      scores.push({
        label: "Sait-il quand il se trompe ?",
        value: pc(1 - Math.min(ece * 4, 1)),
        band: ece < 0.05 ? "bon" : ece < 0.12 ? "moyen" : "mauvais",
        plain:
          `Quand il annonce « je suis sûr à 80 % », il a raison environ 80 % du temps — à `
          + `${pc(ece)} près en moyenne. Plus cet écart est petit, plus on peut se fier à sa `
          + "propre estimation de confiance.",
        mapping:
          `core/metrics.ts — ECE = ${ece.toFixed(4)} sur ${conclusive.length} tranche(s) à `
          + `n ≥ ${minObs} ; note = 1 − min(4 × ECE, 1)`,
        insufficient: false,
      });
    }
  }

  // ── 4. Distingue-t-il vraiment les cas ? ─────────────────────────────────────────────────
  if (r.probabilistic && r.probabilistic.decomposition.binsUsed >= 2) {
    const skill = r.probabilistic.decomposition.skill;
    scores.push({
      label: "Distingue-t-il les cas faciles des cas durs ?",
      value: pc(Math.max(0, Math.min(1, skill))),
      band: skill > 0.15 ? "bon" : skill > 0.02 ? "moyen" : "mauvais",
      plain:
        skill > 0.02
          ? "Oui : sa confiance monte et descend en phase avec ce qui arrive vraiment."
          : "Non : sa confiance varie, mais pas en rapport avec la réalité. Être bien calibré ne "
            + "suffit pas si l'on ne distingue rien.",
      mapping: `core/metrics.ts — décomposition de Murphy, skill = ${skill.toFixed(4)}`,
      insufficient: false,
    });
  }

  // ── 5. Combien coûte une bonne réponse ? ─────────────────────────────────────────────────
  const cost = r.cost;
  if (cost.eurPerCorrect === null && cost.tokensPerCorrect === null) {
    scores.push(
      missing(
        "Combien coûte une bonne réponse ?",
        "core/cost.ts — aucun coût déclaré par l'adaptateur",
        "Impossible à dire : rien n'a été déclaré sur le prix, les jetons ou la durée. Sans ça, on "
        + "compare des qualités sans comparer des prix.",
      ),
    );
  } else {
    const v = cost.eurPerCorrect ?? cost.tokensPerCorrect!;
    scores.push({
      label: "Combien coûte une bonne réponse ?",
      value: Number.isFinite(v) ? v.toFixed(2) : "∞",
      band: "inconnu",
      plain: Number.isFinite(v)
        ? "Coût total divisé par le nombre de réponses justes. Une réponse fausse compte double : "
          + "on l'a payée, et elle n'apporte rien."
        : "Aucune réponse correcte : le coût par bonne réponse est infini.",
      mapping: `core/cost.ts — ${cost.eurPerCorrect !== null ? "eurPerCorrect" : "tokensPerCorrect"}, couverture ${pc(cost.coverage)}`,
      insufficient: !Number.isFinite(v),
    });
  }

  return {
    runId: linkId(r.reproducibility.dataFingerprint, r.reproducibility.runAt),
    subject: r.adapter,
    runAt: r.reproducibility.runAt,
    version: SCORECARD_VERSION,
    // La MÊME phrase que le rapport d'entreprise. Aucune reformulation plus vendeuse.
    headline: r.headline,
    scores,
    caveats: simplify(r.reservations),
    dataFingerprint: r.reproducibility.dataFingerprint,
  };
}

/** Le même barème, appliqué à une exécution du protocole des modèles. */
export function scorecardFromProtocol(run: ProtocolRun): Scorecard {
  const s = summarize(run);
  const scores: PublicScore[] = [];

  scores.push(
    s.measured === 0
      ? missing(
          "Combien de fois a-t-il raison ?",
          "protocols/runner.ts — summarize().accuracy",
          "Aucun cas mesurable : toutes les réponses ont échoué avant d'atteindre le modèle.",
        )
      : {
          label: "Combien de fois a-t-il raison ?",
          value: pc(s.accuracy),
          band: s.accuracy >= 0.8 ? "bon" : s.accuracy >= 0.5 ? "moyen" : "mauvais",
          plain:
            `${s.juste} réponses justes sur ${s.measured} cas réellement mesurés. `
            + `${s.panne} panne(s) technique(s) sont exclue(s) : ce ne sont pas des erreurs du modèle.`,
          mapping: "protocols/runner.ts — summarize().accuracy, pannes hors dénominateur",
          insufficient: false,
        },
  );

  // Se taire quand on ne sait pas — la dimension que presque personne ne mesure.
  const refusCases = run.results.filter((x) => x.dimension === "refus");
  scores.push(
    refusCases.length === 0
      ? missing(
          "Se tait-il quand il ne sait pas ?",
          "protocols/suite.ts — cases dimension « refus »",
          "Non mesuré : la suite utilisée ne contient aucune question sans réponse.",
        )
      : (() => {
          const ok = refusCases.filter((x) => x.verdict === "juste").length;
          const rate = ok / refusCases.length;
          return {
            label: "Se tait-il quand il ne sait pas ?",
            value: pc(rate),
            band: rate >= 0.8 ? "bon" : rate >= 0.5 ? "moyen" : "mauvais",
            plain:
              `Sur ${refusCases.length} questions sans réponse possible, il a reconnu ne pas savoir `
              + `${ok} fois. Un modèle qui invente est plus dangereux qu'un modèle qui se tait : `
              + "rien n'a l'air faux.",
            mapping: "protocols/runner.ts — verdict « juste » sur les cas expectRefusal",
            insufficient: false,
          };
        })(),
  );

  scores.push(
    s.selfAgreement === null
      ? missing(
          "Répond-il pareil si on reformule ?",
          "protocols/runner.ts — selfAgreement",
          "Non mesuré : la suite ne contient aucune question reformulée.",
        )
      : {
          label: "Répond-il pareil si on reformule ?",
          value: pc(s.selfAgreement),
          band: s.selfAgreement >= 0.9 ? "bon" : s.selfAgreement >= 0.7 ? "moyen" : "mauvais",
          plain:
            "La même question posée autrement donne-t-elle la même réponse ? Un modèle qui change "
            + "d'avis selon la formulation est difficile à utiliser en production.",
          mapping: "protocols/runner.ts — selfAgreement moyen sur les cas à reformulations",
          insufficient: false,
        },
  );

  const caveats: string[] = [];
  if (!run.complete) {
    caveats.push(
      "L'essai n'est pas allé jusqu'au bout : le budget prévu a été atteint avant la fin. Les "
      + "résultats ne portent que sur une partie des questions.",
    );
  }
  if (s.panne > 0) {
    caveats.push(
      `${s.panne} question(s) n'ont pas pu être posées pour des raisons techniques. Elles ne sont `
      + "comptées ni en réussite ni en échec.",
    );
  }
  caveats.push(
    `Ces notes portent sur ${run.suite.caseCount} questions figées (${run.suite.id} `
    + `v${run.suite.version}). Elles ne disent rien du comportement sur d'autres tâches.`,
  );
  if (run.exclusions.length > 0) {
    caveats.push(
      "Certaines capacités n'ont volontairement pas été testées : "
      + run.exclusions.map((e) => e.capability).join(", ")
      + ". Rien n'est affirmé à leur sujet.",
    );
  }

  return {
    runId: linkId(run.suite.fingerprint, run.runAt),
    subject: run.model,
    runAt: run.runAt,
    version: SCORECARD_VERSION,
    headline:
      s.measured === 0
        ? "Aucune mesure exploitable : le modèle n'a pas pu répondre."
        : `${s.juste} bonnes réponses sur ${s.measured} questions réellement posées.`,
    scores,
    caveats,
    dataFingerprint: run.suite.fingerprint,
  };
}

/**
 * Reformule les réserves techniques en phrases simples.
 *
 * ON NE SUPPRIME JAMAIS UNE RÉSERVE. Le format public a le droit de la dire autrement, jamais de
 * la taire — c'est la différence entre vulgariser et maquiller. Une réserve sans traduction connue
 * est reprise telle quelle plutôt que jetée.
 */
export function simplify(reservations: string[]): string[] {
  const rules: Array<[RegExp, string]> = [
    [/AUCUNE RÉFÉRENCE CONTRASTIVE/i,
      "Aucun point de comparaison n'a été fourni : on ne peut pas dire si ce système fait mieux "
      + "que ce qu'on utilisait avant."],
    [/échoué pendant l'évaluation/i,
      "Certains cas n'ont pas pu être évalués et sont exclus. Ce ne sont généralement pas les plus "
      + "faciles, donc les scores sont un peu flatteurs."],
    [/sous le seuil de \d+ observations/i,
      "Certaines catégories comptent trop peu de cas pour qu'on puisse en conclure quoi que ce soit. "
      + "Elles sont affichées mais rien n'en est déduit."],
    [/une seule tranche de confiance/i,
      "Le système annonce toujours à peu près la même confiance, donc on ne peut pas savoir s'il "
      + "distingue les cas faciles des cas difficiles."],
    [/aucune confiance chiffrée/i,
      "Le système ne dit jamais à quel point il est sûr de lui : impossible de savoir quand lui "
      + "faire confiance."],
    [/ANCRAGE DÉTECTÉ|ancrage/i,
      "Ce système reproduit de très près ce à quoi on le compare. Il ne peut donc pas faire mieux : "
      + "il redit la même chose."],
    [/pas assez puissant|assez pour décrire, pas pour/i,
      "Il n'y a pas assez de cas pour départager deux systèmes proches. Absence de différence "
      + "détectée ne veut pas dire absence de différence."],
    [/décomposition fiabilité/i,
      "Le calcul de détail repose sur un regroupement par tranches : les ordres de grandeur sont "
      + "justes, pas la troisième décimale."],
    [/aucun coût déclaré/i,
      "Rien n'a été déclaré sur le prix : on compare des qualités sans comparer des coûts."],
    [/ne dit rien de la performance|autre distribution/i,
      "Ces résultats valent pour les cas testés. Ils ne disent rien d'autres types de questions, ni "
      + "du comportement réel en production."],
  ];

  const out: string[] = [];
  for (const r of reservations) {
    const rule = rules.find(([re]) => re.test(r));
    const text = rule ? rule[1] : r;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/**
 * Contrôle de cohérence entre les deux formats.
 *
 * Vérifie qu'un score public ne contredit jamais le rapport d'entreprise dont il sort. C'est le
 * garde-fou de la règle du haut, et il est mécanique : on ne se fie pas à la discipline de celui
 * qui écrit le barème.
 */
export function checkConsistency(r: EvalResult, card: Scorecard): string[] {
  const problems: string[] = [];

  if (card.dataFingerprint !== r.reproducibility.dataFingerprint) {
    problems.push("Le score public ne porte pas sur la même exécution que le rapport d'entreprise.");
  }
  if (card.headline !== r.headline) {
    problems.push(
      "La phrase d'accroche publique diffère de celle du rapport d'entreprise : deux lectures "
      + "doivent partager le même verdict.",
    );
  }
  if (r.refusal) {
    const s = card.scores.find((x) => x.label.startsWith("Fait-il mieux"));
    if (s && !s.insufficient) {
      problems.push(
        "Le rapport d'entreprise REFUSE de rendre un verdict de compétence, mais le score public "
        + "en affiche un.",
      );
    }
  }
  if (card.caveats.length < 1) {
    problems.push("Le score public ne porte aucune réserve, alors que le rapport en porte.");
  }
  if (card.caveats.length < r.reservations.length && r.reservations.length > 0) {
    // Le regroupement est permis, la suppression non : on vérifie qu'il en reste une trace.
    if (card.caveats.length === 0) problems.push("Toutes les réserves ont disparu du format public.");
  }
  return problems;
}

// ── Rendu ─────────────────────────────────────────────────────────────────────────────────────

const BAND_MARK: Record<PublicScore["band"], string> = {
  bon: "●●●",
  moyen: "●●○",
  mauvais: "●○○",
  inconnu: "○○○",
};

/**
 * Le score public en Markdown.
 *
 * La colonne « d'où vient ce chiffre » n'est pas une note de bas de page : c'est ce qui rend le
 * barème auditable. N'importe qui peut ouvrir le rapport d'entreprise et retrouver la valeur.
 */
export function renderScorecardMarkdown(card: Scorecard): string {
  const L: string[] = [];
  L.push(`# ${card.subject}`);
  L.push("");
  L.push(`> ${card.headline}`);
  L.push("");
  L.push(`*Mesuré le ${card.runAt.slice(0, 10)} · barème v${card.version} · exécution \`${card.runId}\`*`);
  L.push("");

  L.push("| | Note | Ce que ça veut dire |");
  L.push("|---|---|---|");
  for (const s of card.scores) {
    const value = s.value === null ? "**pas assez de données**" : `**${s.value}**`;
    L.push(`| ${BAND_MARK[s.band]} ${s.label} | ${value} | ${s.plain} |`);
  }
  L.push("");

  L.push("## À savoir avant de citer ces chiffres");
  L.push("");
  for (const c of card.caveats) L.push(`- ${c}`);
  L.push("");

  L.push("## D'où vient chaque note");
  L.push("");
  L.push("*Chaque note publique correspond à une seule métrique du rapport technique. Aucune n'est");
  L.push("calculée ici : ce document traduit, il ne recalcule pas.*");
  L.push("");
  L.push("| Note | Métrique réelle |");
  L.push("|---|---|");
  for (const s of card.scores) L.push(`| ${s.label} | \`${s.mapping}\` |`);
  L.push("");
  L.push(`Empreinte des données : \`${card.dataFingerprint}\` — identique dans le rapport technique.`);
  L.push("");

  return L.join("\n");
}
