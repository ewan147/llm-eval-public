// Le comparateur de migration — « je remplace A par B, qu'est-ce qui casse ? »
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// C'EST LA PARTIE QUI SE VEND, ET LA RAISON EST SIMPLE.
//
// « Le modèle B est-il plus intelligent que A ? » n'intéresse personne qui paie. « J'ai remplacé A
// par B dans mon système, voici les six cas qui marchaient et qui ne marchent plus » intéresse
// immédiatement quelqu'un qui a un agent en production et un doute.
//
// La différence entre les deux questions n'est pas de ton, elle est de méthode : la seconde exige
// des cas APPARIÉS et NOMMÉS. C'est ce que ce module produit.
//
// TROIS RÈGLES REPRISES DU CŒUR, ET UNE QUATRIÈME PROPRE À LA MIGRATION :
//
//   1. Comparaison APPARIÉE — seuls les cas discordants portent de l'information (McNemar).
//   2. REFUS de comparer deux suites d'empreintes différentes (voir `suite.ts`).
//   3. Le seuil d'échantillon ne bloque QUE les conclusions négatives.
//   4. **Une régression nommée vaut plus qu'un score.** Le verdict peut être « MIGRER » alors que
//      trois cas régressent : c'est à celui qui déploie de décider si ces trois-là sont critiques.
//      L'outil les nomme, il ne les noie pas dans une moyenne.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { mcNemar, wilson } from "../core/binary.ts";
import { compareCost, computeCost, type CostComparison } from "../core/cost.ts";
import { DEFAULT_MIN_PAIRED } from "../core/guards.ts";
import { requiredForPairedProportion, type SampleSizePlan } from "../core/power.ts";
import type { CaseRecord, Interval, Trial } from "../core/types.ts";
import { assertComparable, type Comparability } from "./suite.ts";
import { summarize, type CaseResult, type ProtocolRun, type RunSummary } from "./runner.ts";

export type MigrationVerdict = "MIGRER" | "ATTENDRE" | "NE PAS MIGRER" | "COMPARAISON REFUSÉE";

/** Un cas qui change d'état entre les deux modèles. C'est le livrable le plus utile du rapport. */
export interface CaseChange {
  caseId: string;
  dimension: string;
  category: string;
  prompt: string;
  before: { verdict: string; reply: string };
  after: { verdict: string; reply: string };
}

export interface MigrationReport {
  from: string;
  to: string;
  comparability: Comparability;
  verdict: MigrationVerdict;
  /** La phrase à lire si l'on n'en lit qu'une. */
  statement: string;

  before: RunSummary;
  after: RunSummary;

  /** Cas appariés et mesurables des deux côtés. Les seuls comparables. */
  paired: number;
  /** Exactitude, avec intervalle, de chaque côté. */
  accuracyBefore: Interval | null;
  accuracyAfter: Interval | null;
  /** Écart d'exactitude, et son test apparié. */
  accuracyDelta: number;
  pValue: number | null;
  significant: boolean;

  /** Ce qui casse. Nommé, avec la réponse exacte des deux côtés. */
  regressions: CaseChange[];
  /** Ce qui se répare. */
  fixes: CaseChange[];
  /** Ce qui ne change pas, compté seulement. */
  unchanged: number;

  /** Combien de cas il faudrait pour trancher, quand on n'a pas pu. */
  power: SampleSizePlan | null;
  cost: CostComparison;
  /** Jamais vide. */
  reservations: string[];
}

/**
 * Compare deux exécutions du protocole.
 *
 * `minPaired` gouverne uniquement la distinction entre « pas de différence » et « on ne sait
 * pas » — jamais le refus d'une différence démontrée.
 */
export function compareMigration(
  before: ProtocolRun,
  after: ProtocolRun,
  minPaired: number = DEFAULT_MIN_PAIRED,
): MigrationReport {
  // Deux garde-fous d'un coup : la suite ET le juge. Changer la façon de juger modifie les
  // verdicts sans toucher un énoncé — l'empreinte de suite ne le verrait pas passer.
  const suiteCheck = assertComparable(before.suite, after.suite);
  const comparability: Comparability =
    suiteCheck.verdict === "COMPARABLE" && before.judgeVersion !== after.judgeVersion
      ? {
          verdict: "REFUSÉ",
          reason:
            `Même suite, mais versions de juge différentes (v${before.judgeVersion} contre `
            + `v${after.judgeVersion}). Les critères de jugement ont changé entre les deux `
            + "exécutions : l'écart mesuré mélangerait un changement de modèle et un changement de "
            + "règle. Rejouer l'ancienne exécution avec le juge courant.",
        }
      : suiteCheck;
  const sBefore = summarize(before);
  const sAfter = summarize(after);
  const costBefore = computeCost(toCaseRecords(before.results));
  const costAfter = computeCost(toCaseRecords(after.results));

  const empty: MigrationReport = {
    from: before.model,
    to: after.model,
    comparability,
    verdict: "COMPARAISON REFUSÉE",
    statement: comparability.reason,
    before: sBefore,
    after: sAfter,
    paired: 0,
    accuracyBefore: null,
    accuracyAfter: null,
    accuracyDelta: 0,
    pValue: null,
    significant: false,
    regressions: [],
    fixes: [],
    unchanged: 0,
    power: null,
    cost: compareCost({
      before: costBefore,
      after: costAfter,
      qualityDelta: 0,
      qualitySignificant: false,
    }),
    reservations: [comparability.reason],
  };

  // Règle 2 : on refuse, on n'avertit pas.
  if (comparability.verdict === "REFUSÉ") return empty;

  // ── Appariement par identifiant de cas ────────────────────────────────────────────────────
  const beforeById = new Map(before.results.map((r) => [r.caseId, r]));
  const pairs: Array<{ a: CaseResult; b: CaseResult }> = [];
  for (const b of after.results) {
    const a = beforeById.get(b.caseId);
    if (!a) continue;
    // Une panne d'un côté rend le cas non mesurable : l'exclure plutôt que de l'attribuer au modèle.
    if (a.verdict === "panne" || b.verdict === "panne") continue;
    pairs.push({ a, b });
  }

  const ok = (v: string) => v === "juste";
  const regressions: CaseChange[] = [];
  const fixes: CaseChange[] = [];
  let unchanged = 0;

  for (const { a, b } of pairs) {
    if (ok(a.verdict) && !ok(b.verdict)) regressions.push(toChange(a, b));
    else if (!ok(a.verdict) && ok(b.verdict)) fixes.push(toChange(a, b));
    else unchanged++;
  }

  const trialsBefore: Trial[] = pairs.map(({ a }) => ({
    itemId: a.caseId,
    category: a.category,
    pass: ok(a.verdict),
  }));
  const trialsAfter: Trial[] = pairs.map(({ b }) => ({
    itemId: b.caseId,
    category: b.category,
    pass: ok(b.verdict),
  }));

  const n = pairs.length;
  const test = n > 0 ? mcNemar(trialsAfter, trialsBefore) : null;
  const accuracyDelta = n > 0 ? (fixes.length - regressions.length) / n : 0;
  const significant = !!test?.significant;

  const accuracyBefore = n > 0 ? wilson(trialsBefore.filter((t) => t.pass).length, n) : null;
  const accuracyAfter = n > 0 ? wilson(trialsAfter.filter((t) => t.pass).length, n) : null;

  const cost = compareCost({
    before: costBefore,
    after: costAfter,
    qualityDelta: accuracyDelta,
    qualitySignificant: significant,
  });

  // Quand on n'a pas tranché, dire combien il en faudrait.
  const power =
    !significant && test && n > 0
      ? requiredForPairedProportion({
          discordantRate: (test.systemOnly + test.baselineOnly) / Math.max(n, 1),
          difference: accuracyDelta,
          available: n,
        })
      : null;

  const decided = decide({
    n,
    minPaired,
    significant,
    accuracyDelta,
    regressions: regressions.length,
    cost,
    from: before.model,
    to: after.model,
  });

  return {
    from: before.model,
    to: after.model,
    comparability,
    verdict: decided.verdict,
    statement: decided.statement,
    before: sBefore,
    after: sAfter,
    paired: n,
    accuracyBefore,
    accuracyAfter,
    accuracyDelta,
    pValue: test?.pValue ?? null,
    significant,
    regressions,
    fixes,
    unchanged,
    power,
    cost,
    reservations: buildReservations({
      before,
      after,
      n,
      minPaired,
      significant,
      regressions: regressions.length,
      cost,
    }),
  };
}

/**
 * Le verdict de migration.
 *
 * NOTE SUR « MIGRER » AVEC DES RÉGRESSIONS. Le verdict porte sur l'agrégat ; les régressions sont
 * nommées à part et ne sont jamais absorbées par lui. Un gain global de 8 points qui casse le seul
 * cas critique d'un client est une mauvaise migration pour ce client, et l'outil n'a pas à en
 * décider à sa place — il lui donne les deux informations séparément.
 */
function decide(a: {
  n: number;
  minPaired: number;
  significant: boolean;
  accuracyDelta: number;
  regressions: number;
  cost: CostComparison;
  from: string;
  to: string;
}): { verdict: MigrationVerdict; statement: string } {
  const pct = (v: number) => `${(v * 100).toFixed(1)} pt`;
  const reg =
    a.regressions > 0
      ? ` ${a.regressions} cas qui passaient échouent désormais — ils sont nommés dans le rapport, `
        + "et c'est à celui qui déploie de dire s'ils sont critiques."
      : "";

  if (a.n === 0) {
    return {
      verdict: "ATTENDRE",
      statement:
        "Aucun cas apparié mesurable des deux côtés : la comparaison n'a pas eu lieu. Vérifier "
        + "que les deux exécutions ont bien tourné.",
    };
  }

  if (a.significant && a.accuracyDelta < 0) {
    return {
      verdict: "NE PAS MIGRER",
      statement:
        `Dégradation démontrée : ${pct(a.accuracyDelta)} d'exactitude en moins sur ${a.n} cas `
        + `appariés.${reg}`,
    };
  }

  if (a.significant && a.accuracyDelta > 0) {
    // Le gain est établi ; reste à savoir ce qu'il coûte.
    if (a.cost.verdict === "PLUS CHER MAIS MEILLEUR") {
      return {
        verdict: "MIGRER",
        statement:
          `Gain démontré de ${pct(a.accuracyDelta)} sur ${a.n} cas appariés, au prix d'un coût par `
          + `réponse correcte multiplié par ${a.cost.ratio?.toFixed(2)}. L'arbitrage appartient à `
          + `celui qui paie.${reg}`,
      };
    }
    return {
      verdict: "MIGRER",
      statement: `Gain démontré de ${pct(a.accuracyDelta)} sur ${a.n} cas appariés.${reg}`,
    };
  }

  // Pas de différence DÉMONTRÉE. Le coût peut suffire à décider.
  if (a.n < a.minPaired) {
    // « Aucune différence » et « une différence qu'on n'a pas pu démontrer » ne sont pas la même
    // phrase, et la confusion penche toujours du même côté : elle fait passer un écart réel pour
    // une égalité. Quand un écart a été OBSERVÉ, on le dit, et on dit qu'il n'est pas établi.
    const observe = Math.abs(a.accuracyDelta) >= 0.005;
    const constat = observe
      ? `écart observé de ${pct(a.accuracyDelta)}, non significatif (le test n'avait pas la `
        + "puissance de l'établir)"
      : "aucun écart observé, et le test n'avait pas la puissance d'en détecter un";
    return {
      verdict: "ATTENDRE",
      statement:
        `${a.n} cas appariés, seuil de ${a.minPaired} : ${constat}. On ne peut PAS conclure que `
        + `les deux modèles se valent, ni que l'un dépasse l'autre — seulement qu'on n'en sait `
        + `rien.${reg}`,
    };
  }

  if (a.cost.verdict === "MOINS CHER, QUALITÉ ÉQUIVALENTE" && (a.cost.ratio ?? 1) < 0.95) {
    return {
      verdict: "MIGRER",
      statement:
        `Aucun écart de qualité démontré sur ${a.n} cas appariés, et le coût par réponse correcte `
        + `baisse (${a.cost.ratio?.toFixed(2)} ×). Migrer pour l'économie, pas pour la qualité.${reg}`,
    };
  }

  if (a.cost.verdict === "PLUS CHER SANS GAIN") {
    return {
      verdict: "NE PAS MIGRER",
      statement:
        `Aucun écart de qualité démontré sur ${a.n} cas appariés, et le coût par réponse correcte `
        + `augmente (${a.cost.ratio?.toFixed(2)} ×). On paierait une différence non prouvée.${reg}`,
    };
  }

  return {
    verdict: "ATTENDRE",
    statement:
      `Aucun écart de qualité ni de coût démontré sur ${a.n} cas appariés. Rien ne justifie la `
      + `migration, rien ne l'interdit non plus.${reg}`,
  };
}

function buildReservations(a: {
  before: ProtocolRun;
  after: ProtocolRun;
  n: number;
  minPaired: number;
  significant: boolean;
  regressions: number;
  cost: CostComparison;
}): string[] {
  const r: string[] = [];

  if (!a.before.complete || !a.after.complete) {
    const which = [
      !a.before.complete ? a.before.model : null,
      !a.after.complete ? a.after.model : null,
    ].filter(Boolean);
    r.push(
      `Exécution incomplète pour ${which.join(" et ")} : le plafond de budget a coupé la suite. `
      + "Les cas non atteints sont absents des deux côtés de la comparaison, et ce ne sont pas des "
      + "cas au hasard — ce sont les derniers de la suite.",
    );
  }

  if (a.n < a.minPaired) {
    r.push(
      `${a.n} cas appariés seulement : assez pour décrire, pas pour distinguer deux modèles `
      + `proches (il en faudrait ${a.minPaired}).`,
    );
  }

  const pannes = a.before.results.filter((x) => x.verdict === "panne").length
    + a.after.results.filter((x) => x.verdict === "panne").length;
  if (pannes > 0) {
    r.push(
      `${pannes} panne(s) d'infrastructure exclue(s) de la comparaison. Une panne n'est pas une `
      + "mauvaise réponse ; la compter comme un échec attribuerait au modèle une faute qui n'est "
      + "pas la sienne.",
    );
  }

  if (a.regressions > 0 && a.significant) {
    r.push(
      `Le verdict porte sur l'agrégat. ${a.regressions} cas régressent malgré tout : un gain global `
      + "peut masquer la perte du seul cas qui compte pour un usage donné.",
    );
  }

  for (const res of a.cost.after.reservations) r.push(res);

  const exclusions = a.after.exclusions;
  if (exclusions.length > 0) {
    r.push(
      `${exclusions.length} capacité(s) volontairement non testée(s) : `
      + exclusions.map((e) => e.capability).join(", ")
      + ". Rien n'est mesuré à leur sujet, dans un sens comme dans l'autre.",
    );
  }

  r.push(
    "Cette comparaison porte sur la suite figée. Elle ne dit rien du comportement sur d'autres "
    + "tâches, de la robustesse aux entrées adverses, ni du comportement en production.",
  );

  return r;
}

function toChange(a: CaseResult, b: CaseResult): CaseChange {
  return {
    caseId: a.caseId,
    dimension: a.dimension,
    category: a.category,
    prompt: a.prompt,
    before: { verdict: a.verdict, reply: a.reply },
    after: { verdict: b.verdict, reply: b.reply },
  };
}

/** Convertit des résultats de protocole en `CaseRecord`, pour réutiliser `computeCost` du cœur. */
function toCaseRecords(results: CaseResult[]): CaseRecord[] {
  return results.map((r) => ({
    itemId: r.caseId,
    category: r.category,
    input: r.prompt,
    prediction: { label: r.reply, prob: r.confidence, cost: r.cost },
    truth: {},
    correct: r.verdict === "juste",
    error: r.verdict === "panne" ? "panne d'infrastructure" : undefined,
  }));
}
