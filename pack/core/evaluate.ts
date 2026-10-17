// L'orchestrateur : d'un adaptateur à un résultat d'évaluation complet.
//
// Ce fichier n'appelle aucune API, ne lit aucun fichier et ne connaît aucun domaine. Il exécute
// l'adaptateur, normalise, mesure, et assemble. Toute la politique — quand refuser, quand ne pas
// conclure — vit dans `guards.ts` et `baseline.ts`.

import { createHash } from "node:crypto";

import { t, tf } from "./i18n.ts";

import {
  compareToBaseline,
  trivialBaselines,
  type ContrastiveComparison,
  type TrivialBaselines,
} from "./baseline.ts";
import { successByCategory, successRate, wilson } from "./binary.ts";
import { computeCost, type CostReport } from "./cost.ts";
import { bootstrapCI } from "./bootstrap.ts";
import {
  DECILES,
  brier,
  calibrationCurve,
  confidenceSpread,
  decompose,
  expectedCalibrationError,
  logLoss,
  maximumCalibrationError,
  slice,
  type Decomposition,
} from "./metrics.ts";
import {
  DEFAULT_MIN_OBS,
  DEFAULT_MIN_PAIRED,
  refusalForMissingBaseline,
  underpoweredSlices,
  type Refusal,
  type Underpowered,
} from "./guards.ts";
import {
  requiredForMeanDifference,
  requiredForPairedProportion,
  achievedPower,
  type SampleSizePlan,
} from "./power.ts";
import {
  rankingDiagnosis,
  rankingScores,
  type RankedCase,
  type RankingScores,
} from "./ranking.ts";
import { normLabel, resolve, toObservation, toTrial, type ResolutionMode } from "./resolve.ts";
import type {
  Adapter,
  CaseRecord,
  EvalOptions,
  Interval,
  Observation,
  Slice,
  Trial,
} from "./types.ts";

/** Un défaut trouvé, reproductible tel quel. Alimente le rapport d'audit. */
export interface Defect {
  severity: "critique" | "majeur" | "mineur";
  kind: string;
  itemId: string;
  category: string;
  /** L'entrée exacte. */
  input: unknown;
  /** Ce que le système a répondu. */
  got: unknown;
  /** Ce qu'il fallait répondre. */
  expected: unknown;
  confidence?: number;
  /** Pourquoi ce défaut est classé ainsi. */
  why: string;
}

export interface ProbabilisticBlock {
  n: number;
  brier: Interval;
  logLoss: number;
  ece: number;
  mce: number;
  curve: Slice[];
  decomposition: Decomposition;
  overall: Slice;
  spread: { distinct: number; min: number; max: number };
}

export interface BinaryBlock {
  n: number;
  successRate: Interval;
  byCategory: Array<{ category: string; n: number; rate: Interval; conclusive: boolean }>;
}

/** Métriques de rang, présentes seulement en mode récupération@k. */
export interface RankingBlock {
  system: RankingScores;
  baseline: RankingScores | null;
  diagnosis: string;
}

/** Ce qu'il faudrait comme échantillon pour trancher. Présent quand le verdict est INDÉCIDABLE. */
export interface PowerBlock {
  plan: SampleSizePlan;
  /** Chance qu'avait l'échantillon courant de détecter l'écart observé, s'il est réel. */
  achieved: number;
}

export interface Reproducibility {
  command: string;
  runAt: string;
  packVersion: string;
  nodeVersion: string;
  /**
   * Empreinte du JEU DE TEST : identifiants, entrées, vérités terrain.
   *
   * Les PRÉDICTIONS en sont volontairement exclues. C'est ce qui rend la détection de dérive
   * possible : deux versions d'un système produisent des prédictions différentes sur le même jeu,
   * et doivent donc partager la même empreinte. Y inclure les prédictions ferait déclarer « jeux
   * de test différents » à chaque comparaison de versions, c'est-à-dire précisément dans le seul
   * cas où la comparaison a un sens.
   */
  dataFingerprint: string;
  seed: number;
  bootstrapSamples: number;
  minObs: number;
  minPaired: number;
  bins: number[];
  k: number;
}

export interface EvalResult {
  adapter: string;
  /** La phrase à lire si l'on n'en lit qu'une. Compréhensible sans culture statistique. */
  headline: string;
  /** Le refus, s'il y en a un. Non nul = aucun verdict de compétence n'a été rendu. */
  refusal: Refusal | null;
  n: number;
  errors: number;
  modes: ResolutionMode[];
  trivial: TrivialBaselines;
  contrastive: ContrastiveComparison | null;
  probabilistic: ProbabilisticBlock | null;
  /** `null` en mode « événement » : la réussite binaire n'y mesure pas le système. */
  binary: BinaryBlock | null;
  /** `null` hors du mode récupération@k. */
  ranking: RankingBlock | null;
  /** `null` quand le verdict ne dépend pas de la taille d'échantillon. */
  power: PowerBlock | null;
  /** Coût déclaré par l'adaptateur. Toujours présent ; ses champs valent `null` si rien n'est déclaré. */
  cost: CostReport;
  underpowered: Underpowered[];
  /** Jamais vide. Un rapport qui ne dit pas ses limites est un rapport qui ment. */
  reservations: string[];
  defects: Defect[];
  cases: CaseRecord[];
  reproducibility: Reproducibility;
}

export const PACK_VERSION = "0.1.0";

/** Exécute un adaptateur et rend le résultat complet. Aucune écriture, aucun affichage. */
export async function evaluate<TItem>(
  adapter: Adapter<TItem>,
  options: EvalOptions = {},
): Promise<EvalResult> {
  const bins = options.bins ?? DECILES;
  const minObs = options.minObs ?? DEFAULT_MIN_OBS;
  const minPaired = Math.max(options.minObs ?? 0, DEFAULT_MIN_PAIRED);
  const bootstrapSamples = options.bootstrapSamples ?? 2000;
  const seed = options.seed ?? 20260905;
  const k = options.k ?? 5;
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const level = 0.95;

  const items = await adapter.loadItems();

  const cases: CaseRecord[] = new Array(items.length);
  const modes = new Set<ResolutionMode>();
  /** Premier message d'erreur venu de `baseline()`, et le nombre de cas concernés. */
  let baselineError: string | undefined;
  let baselineErrors = 0;

  await mapWithConcurrency(items, concurrency, async (item, index) => {
    const itemId = `case_${String(index + 1).padStart(4, "0")}`;
    const category = safeCategory(adapter, item);
    const grappe = safeCluster(adapter, item);
    try {
      const [prediction, truth] = await Promise.all([adapter.predict(item), adapter.truth(item)]);
      const r = resolve(prediction, truth, k);
      // Validation ICI, dans la passe protégée : une confiance hors bornes doit devenir une erreur
      // COMPTÉE sur ce cas, pas interrompre toute l'évaluation. Valider plus tard, dans la passe
      // de normalisation, ferait perdre les 3 670 autres cas à cause d'un seul.
      toObservation(itemId, category, r);
      modes.add(r.mode);

      // La référence a le droit de ne pas répondre : `baseline()` peut rendre `{}` quand elle
      // n'a rien à dire sur ce cas. Le cas est alors compté comme NON APPARIÉ, jamais comme une
      // erreur — et le nombre de non-appariés est remonté comme une réserve, parce qu'un cas sans
      // référence n'est presque jamais absent au hasard.
      let baselinePrediction: CaseRecord["baselinePrediction"];
      let baselineCorrect: boolean | undefined;
      if (adapter.baseline) {
        // L'APPEL LUI-MÊME EST PROTÉGÉ, et séparément.
        //
        // Il était hors du `try`, donc une exception dans `baseline()` faisait basculer le cas
        // ENTIER dans la branche d'erreur. Une référence cassée détruisait alors toute
        // l'évaluation — 60 cas sur 60 en échec — et le rapport annonçait « 60 cas ont échoué »
        // sans dire lequel des deux camps était fautif. On part chercher un bogue dans son
        // `predict()` pendant que le vrai coupable est trois lignes plus bas.
        try {
          const bp = await adapter.baseline(item);
          baselineCorrect = resolve(bp, truth, k).correct;
          baselinePrediction = bp;
        } catch (err) {
          baselinePrediction = undefined;
          baselineCorrect = undefined;
          baselineError = err instanceof Error ? err.message : String(err);
        }
      }

      if (baselineError !== undefined) baselineErrors++;
      cases[index] = {
        itemId,
        category,
        cluster: grappe,
        input: item,
        prediction,
        truth,
        correct: r.correct,
        baselineCorrect,
        baselinePrediction,
      };
    } catch (err) {
      cases[index] = {
        itemId,
        category,
        cluster: grappe,
        input: item,
        prediction: {},
        truth: {},
        correct: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const ok = cases.filter((c) => !c.error);
  const errors = cases.length - ok.length;

  // ── Normalisation ────────────────────────────────────────────────────────────────────────
  const systemObs: Observation[] = [];
  const systemTrials: Trial[] = [];
  const baselineObs: Observation[] = [];
  const baselineTrials: Trial[] = [];

  for (const c of ok) {
    const r = resolve(c.prediction, c.truth, k);
    const t = toTrial(c.itemId, c.category, r);
    if (t) systemTrials.push(t);
    const o = toObservation(c.itemId, c.category, r);
    if (o) systemObs.push(o);

    if (c.baselinePrediction) {
      const rb = resolve(c.baselinePrediction, c.truth, k);
      const tb = toTrial(c.itemId, c.category, rb);
      if (tb) baselineTrials.push(tb);
      const ob = toObservation(c.itemId, c.category, rb);
      if (ob) baselineObs.push(ob);
    }
  }

  // ── Blocs de mesure ──────────────────────────────────────────────────────────────────────
  const probabilistic: ProbabilisticBlock | null =
    systemObs.length > 0
      ? {
          n: systemObs.length,
          brier: bootstrapCI(systemObs, brier, { samples: bootstrapSamples, level, seed }),
          logLoss: logLoss(systemObs),
          ece: expectedCalibrationError(calibrationCurve(systemObs, bins, minObs)),
          mce: maximumCalibrationError(calibrationCurve(systemObs, bins, minObs)),
          curve: calibrationCurve(systemObs, bins, minObs),
          decomposition: decompose(systemObs, bins),
          overall: slice("global", systemObs, minObs),
          spread: confidenceSpread(systemObs),
        }
      : null;

  // `null` en mode « événement » : voir toTrial(). Un taux de réussite y serait le taux de
  // survenue de l'événement, pas une mesure du système.
  const binary: BinaryBlock | null =
    systemTrials.length > 0
      ? {
          n: systemTrials.length,
          successRate: wilson(systemTrials.filter((t) => t.pass).length, systemTrials.length, level),
          byCategory: successByCategory(systemTrials, minObs, level),
        }
      : null;

  // Les étiquettes vraies, quand elles existent : c'est la seule base honnête pour le plancher
  // « classe majoritaire ». Sans elles, ce plancher n'est pas calculé (et vaut null).
  const truthLabels = ok.map((c) => c.truth.label).filter((l): l is string => typeof l === "string");
  const trivial = trivialBaselines(systemObs, systemTrials, truthLabels);

  const contrastive =
    adapter.baseline && (baselineTrials.length > 0 || baselineObs.length > 0)
      ? compareToBaseline({
          systemObs,
          baselineObs,
          systemTrials,
          baselineTrials,
          minPaired,
          level,
          bootstrapSamples,
          seed,
        })
      : null;

  const refusal = contrastive ? null : refusalForMissingBaseline();

  // ── Tranches et segments écartés, nommés ─────────────────────────────────────────────────
  const underpowered: Underpowered[] = [
    ...(probabilistic ? underpoweredSlices("tranche de confiance", probabilistic.curve, minObs) : []),
    ...(binary?.byCategory ?? [])
      .filter((c) => !c.conclusive)
      .map((c) => ({ scope: "catégorie", label: c.category || "(sans catégorie)", n: c.n, required: minObs })),
  ];

  // ── Métriques de rang : seulement là où elles ont un sens ────────────────────────────────
  const toRanked = (
    pick: (c: CaseRecord) => { ranking?: string[] } | undefined,
  ): RankedCase[] =>
    ok
      .filter((c) => pick(c)?.ranking && c.truth.relevant)
      .map((c) => ({
        itemId: c.itemId,
        category: c.category,
        ranking: pick(c)!.ranking!.map(normLabel),
        relevant: new Set(c.truth.relevant!.map(normLabel)),
      }));

  const systemRanked = toRanked((c) => c.prediction);
  const baselineRanked = toRanked((c) => c.baselinePrediction);
  const ranking: RankingBlock | null =
    systemRanked.length > 0
      ? {
          system: rankingScores(systemRanked, k),
          baseline: baselineRanked.length > 0 ? rankingScores(baselineRanked, k) : null,
          diagnosis: rankingDiagnosis(rankingScores(systemRanked, k)),
        }
      : null;

  // ── Puissance : que faire quand on n'a pas pu trancher ────────────────────────────────────
  const power = buildPower(contrastive, systemObs, baselineObs, systemTrials, baselineTrials);

  // Le coût est agrégé sur TOUS les cas non erronés, couverts ou non : c'est la couverture qui
  // dit à quel point le total est complet, et elle est remontée avec lui.
  const cost = computeCost(cases);

  const defects = collectDefects(ok, minObs);
  const reservations = buildReservations({
    n: ok.length,
    errors,
    minObs,
    minPaired,
    probabilistic,
    contrastive,
    refusal,
    underpowered,
    trivial,
    modes: [...modes],
    hasBaseline: !!adapter.baseline,
    cost,
    ok,
    binary,
    baselineError,
    baselineErrors,
  });

  const headline = buildHeadline({
    adapter, refusal, contrastive, probabilistic, binary, trivial, n: ok.length, minObs,
  });

  return {
    adapter: adapter.name,
    headline,
    refusal,
    n: ok.length,
    errors,
    modes: [...modes],
    trivial,
    contrastive,
    probabilistic,
    binary,
    ranking,
    power,
    cost,
    underpowered,
    reservations,
    defects,
    cases,
    reproducibility: {
      command: process.argv.slice(1).join(" ") || "(appel programmatique)",
      runAt: new Date().toISOString(),
      packVersion: PACK_VERSION,
      nodeVersion: process.version,
      dataFingerprint: fingerprint(cases),
      seed,
      bootstrapSamples,
      minObs,
      minPaired,
      bins,
      k,
    },
  };
}

/**
 * Combien de cas il faudrait pour trancher — calculé UNIQUEMENT quand on n'a pas pu trancher.
 *
 * C'est ce qui transforme « INDÉCIDABLE : 40 cas, seuil de 100 » en « il t'en faut environ 320 ».
 * Le seuil disait qu'on n'en avait pas assez ; celui-ci dit combien, à partir de la variance
 * réellement observée sur cet échantillon.
 */
function buildPower(
  contrastive: ContrastiveComparison | null,
  systemObs: Observation[],
  baselineObs: Observation[],
  systemTrials: Trial[],
  baselineTrials: Trial[],
): PowerBlock | null {
  if (!contrastive || contrastive.verdict !== "INDÉCIDABLE" || contrastive.n === 0) return null;

  // Volet probabiliste : on dispose de l'écart-type des différences appariées de Brier.
  if (contrastive.probabilistic && systemObs.length > 0 && baselineObs.length > 0) {
    const byId = new Map(baselineObs.map((o) => [o.itemId, o]));
    const diffs: number[] = [];
    for (const s of systemObs) {
      const b = byId.get(s.itemId);
      if (!b) continue;
      const y = s.outcome ? 1 : 0;
      diffs.push((s.prob - y) ** 2 - (b.prob - y) ** 2);
    }
    if (diffs.length > 1) {
      const mean = diffs.reduce((a, d) => a + d, 0) / diffs.length;
      const variance = diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / (diffs.length - 1);
      const sd = Math.sqrt(variance);
      return {
        plan: requiredForMeanDifference({ sd, effect: mean, available: diffs.length }),
        achieved: achievedPower({ n: diffs.length, sd, effect: mean }),
      };
    }
  }

  // Volet binaire : la taille dépend des cas DISCORDANTS, pas de l'effectif total.
  if (contrastive.binary && systemTrials.length > 0) {
    const m = contrastive.binary.mcnemar;
    const discordantRate = m.n > 0 ? (m.systemOnly + m.baselineOnly) / m.n : 0;
    const plan = requiredForPairedProportion({
      discordantRate,
      difference: m.difference,
      available: m.n,
    });
    // Puissance approchée : écart-type d'une différence appariée de proportions.
    const sd = Math.sqrt(Math.max(discordantRate - m.difference ** 2, 0));
    return { plan, achieved: achievedPower({ n: m.n, sd, effect: m.difference }) };
  }

  return null;
}

/**
 * Le verdict en une phrase, lisible par quelqu'un qui ne connaît pas le score de Brier.
 *
 * Règle : le verdict le plus défavorable l'emporte. Un système bien calibré, indiscernable de sa
 * référence, est SANS VALEUR DÉMONTRÉE — pas « bien calibré, à améliorer ».
 */
function buildHeadline(args: {
  adapter: { name: string };
  refusal: Refusal | null;
  contrastive: ContrastiveComparison | null;
  probabilistic: ProbabilisticBlock | null;
  /** `null` en mode « événement » : la réussite binaire n'y mesure pas le système. */
  binary: BinaryBlock | null;
  /** `null` hors du mode récupération@k. */
  ranking: RankingBlock | null;
  /** `null` quand le verdict ne dépend pas de la taille d'échantillon. */
  power: PowerBlock | null;
  /** Coût déclaré par l'adaptateur. Toujours présent ; ses champs valent `null` si rien n'est déclaré. */
  cost: CostReport;
  trivial: TrivialBaselines;
  n: number;
  minObs: number;
}): string {
  const { refusal, contrastive, probabilistic, binary, trivial, n, minObs } = args;
  const pc = (v: number) => `${(v * 100).toFixed(1)} %`;

  if (n === 0) {
    return t({
      fr: "Aucun cas évaluable : l'adaptateur n'a rendu aucune donnée exploitable.",
      en: "No evaluable case: the adapter returned no usable data.",
    });
  }
  if (n < minObs) {
    return tf({
      fr: (n: number, m: number) =>
        `Pas encore mesurable : ${n} cas, il en faut au moins ${m}. Ce n'est pas un mauvais `
        + "résultat, c'est une absence de résultat.",
      en: (n: number, m: number) =>
        `Not measurable yet: ${n} cases, at least ${m} are needed. This is not a bad result, it is `
        + "an absence of result.",
    })(n, minObs);
  }

  // Comment décrire le système en quelques mots dépend de ce qu'il produit. En mode « événement »
  // il n'existe pas de taux de réussite : la qualité tient entièrement dans la probabilité annoncée.
  const description = binary
    ? tf({
        fr: (v: string, lo: string, hi: string) => `réussit ${v} des cas (intervalle ${lo} – ${hi})`,
        en: (v: string, lo: string, hi: string) => `succeeds on ${v} of cases (interval ${lo} – ${hi})`,
      })(pc(binary.successRate.value), pc(binary.successRate.low), pc(binary.successRate.high))
    : probabilistic
      ? tf({
          fr: (b: string) => `annonce des probabilités dont l'erreur quadratique moyenne est de ${b}`,
          en: (b: string) => `announces probabilities whose mean squared error is ${b}`,
        })(probabilistic.brier.value.toFixed(4))
      : t({ fr: "ne produit aucune mesure exploitable", en: "produces no usable measurement" });

  if (refusal) {
    const floor =
      trivial.beatsMajorityLabel === false
        ? t({
            fr: " Il ne bat même pas « répondre toujours la réponse la plus fréquente ».",
            en: " It does not even beat « always answer the most frequent response ».",
          })
        : trivial.beatsClimatology === false
          ? t({
              fr: " Il ne bat même pas « annoncer toujours le taux de base ».",
              en: " It does not even beat « always announce the base rate ».",
            })
          : trivial.beatsMajorityLabel === true || trivial.beatsClimatology === true
            ? t({
                fr: " Il bat les planchers gratuits, ce qui est le minimum exigible, pas un résultat.",
                en: " It beats the free floors, which is the minimum expected, not a result.",
              })
            : "";
    return tf({
      fr: (h: string, d: string, f: string) => `${h} Le système ${d}.${f}`,
      en: (h: string, d: string, f: string) => `${h} The system ${d}.${f}`,
    })(refusal.headline, description, floor);
  }
  const c = contrastive!;
  switch (c.verdict) {
    case "BAT":
      return tf({
        fr: (d: string, n: number) =>
          `Le système bat sa référence : il ${d}, et l'écart avec la référence ne s'explique pas `
          + `par le hasard (${n} cas comparés).`,
        en: (d: string, n: number) =>
          `The system beats its baseline: it ${d}, and the gap with the baseline is not explained `
          + `by chance (${n} cases compared).`,
      })(description, c.n);
    case "MOINS BON":
      return tf({
        fr: (d: string, n: number) =>
          `Le système fait MOINS BIEN que sa référence : il ${d}, et la référence fait mieux de `
          + `façon mesurable (${n} cas comparés). Déployer la référence serait préférable.`,
        en: (d: string, n: number) =>
          `The system does WORSE than its baseline: it ${d}, and the baseline does measurably `
          + `better (${n} cases compared). Deploying the baseline would be preferable.`,
      })(description, c.n);
    case "ÉQUIVALENT":
      return tf({
        fr: (d: string, n: number) =>
          `Sans valeur démontrée : le système ${d}, mais il est indiscernable de sa référence sur `
          + `${n} cas comparés. Un système qui égale sa référence n'apporte rien de prouvé.`,
        en: (d: string, n: number) =>
          `No demonstrated value: the system ${d}, but it is indistinguishable from its baseline on `
          + `${n} compared cases. A system that equals its baseline proves nothing.`,
      })(description, c.n);
    default:
      return tf({
        fr: (d: string, n: number, st: string) =>
          `Indécidable : le système ${d}, mais la comparaison à la référence n'a pas pu aboutir `
          + `(${n} cas appariés). ${st}`,
        en: (d: string, n: number, st: string) =>
          `Undecidable: the system ${d}, but the comparison to the baseline could not conclude `
          + `(${n} paired cases). ${st}`,
      })(description, c.n, c.statement);
  }
}

/**
 * Les réserves. Cette liste n'est JAMAIS vide.
 *
 * Un rapport d'évaluation qui ne dit pas ses limites est un rapport qui ment — et devant un client
 * payant, c'est aussi ce qui inspire le plus de confiance : personne ne croit un rapport sans
 * réserve, tout le monde croit un rapport qui sait où il s'arrête.
 */
function buildReservations(a: {
  n: number;
  errors: number;
  minObs: number;
  minPaired: number;
  probabilistic: ProbabilisticBlock | null;
  contrastive: ContrastiveComparison | null;
  refusal: Refusal | null;
  underpowered: Underpowered[];
  trivial: TrivialBaselines;
  modes: ResolutionMode[];
  hasBaseline: boolean;
  cost: CostReport;
  /** Les cas mesurables, pour les contrôles de dégénérescence. */
  ok: CaseRecord[];
  binary: BinaryBlock | null;
  /** Message d'erreur venu de `baseline()`, s'il y en a eu un. */
  baselineError?: string;
  baselineErrors: number;
}): string[] {

  const r: string[] = [];

  // Référence sans nuance : l'écart de Brier est alors gagné d'avance par le système.
  if (a.contrastive?.probabilistic?.referenceSansNuance) {
    r.push(t({
      fr: "La référence ne produit que des probabilités de 0 ou 1, alors que le système nuance. "
        + "L'écart de score probabiliste lui est donc structurellement favorable : chaque erreur "
        + "de la référence coûte le maximum. Ce que mesure cet écart est d'abord l'absence de "
        + "nuance de la référence, pas la justesse du système — c'est le taux de réussite qu'il "
        + "faut regarder ici.",
      en: "The baseline emits only 0 or 1 probabilities while the system hedges. The probabilistic "
        + "gap is therefore structurally in the system's favour: every baseline error costs the "
        + "maximum. Read the success rate instead.",
    }));
  }

  if (a.refusal) {
    r.push(t({
      fr: "AUCUNE RÉFÉRENCE CONTRASTIVE. Les chiffres décrivent le système ; ils ne disent pas s'il "
        + "vaut mieux que ce qu'on aurait déployé sans lui. C'est la réserve la plus lourde de ce "
        + "rapport, et la seule que l'utilisateur peut lever lui-même.",
      en: "NO CONTRASTIVE BASELINE. The numbers describe the system; they do not say whether it is "
        + "better than what would have been deployed without it. This is the heaviest reservation "
        + "in this report, and the only one the user can lift on their own.",
    }));
  }

  // ===========================================================================================
  // CONTRÔLES DE DÉGÉNÉRESCENCE
  //
  // Ce qui suit ne mesure pas le système : cela vérifie que la MESURE veut dire quelque chose.
  // Chacun de ces cas produit un chiffre d'aspect parfaitement normal et complètement vide de
  // sens. Ils ont tous été trouvés en soumettant le pack à des adaptateurs hostiles.
  // ===========================================================================================

  // ── La référence a planté. ──
  //
  // Sans cette phrase, le rapport dit seulement « aucune référence » et l'utilisateur croit avoir
  // oublié de l'écrire, alors qu'elle existe et qu'elle lève une exception.
  if (a.baselineError !== undefined) {
    r.push(tf({
      fr: (n: number) =>
        `La méthode baseline() a échoué sur ${n} cas : « ${a.baselineError} ». La référence est `
        + "donc absente, et toute conclusion de compétence est refusée : non pas parce qu'il n'y "
        + "a pas de référence, mais parce que la vôtre est cassée. Le système, lui, a bien été "
        + "mesuré.",
      en: (n: number) =>
        `baseline() threw on ${n} cases: "${a.baselineError}". The baseline is therefore missing, `
        + "and any competence claim is refused - not because there is no baseline, but because "
        + "yours is broken.",
    })(a.baselineErrors));
  }

  // ── Score trop beau. ──
  //
  // C'EST LE CONTRÔLE LE PLUS IMPORTANT DE CE BLOC. Un système qui frôle 100 % sur des données
  // réelles a presque toujours accès à la réponse : la vérité passée par mégarde dans l'entrée,
  // un identifiant qui encode la classe, des cas de test ayant servi au réglage. Sans cette
  // réserve, le pack couronnait « BAT LA RÉFÉRENCE » un adaptateur dont predict() renvoyait
  // littéralement truth() — vérifié sur une sonde.
  const tauxSysteme = a.binary?.successRate.value;
  if (tauxSysteme !== undefined && tauxSysteme >= 0.98 && a.n >= 30) {
    r.push(tf({
      fr: (x: number) =>
        `Taux de réussite de ${(x * 100).toFixed(1)} % : ce résultat doit être traité comme `
        + "SUSPECT avant d'être traité comme bon. Sur des données réelles, un score aussi élevé "
        + "vient presque toujours d'une fuite : la vérité présente dans l'entrée, un identifiant "
        + "qui encode la réponse, ou des cas de test ayant servi à régler le système. Trois "
        + "vérifications : le système voit-il quelque chose qu'il n'aurait pas en production ? "
        + "ces cas ont-ils servi à le mettre au point ? la tâche est-elle réellement difficile ?",
      en: (x: number) =>
        `Success rate of ${(x * 100).toFixed(1)} %: treat this as SUSPECT before treating it as `
        + "good. On real data such a score almost always comes from a leak.",
    })(tauxSysteme));
  }

  // ── Vérité terrain dégénérée. ──
  //
  // Si presque tous les cas portent la même réponse, « répondre toujours pareil » est excellent
  // et ne prouve rien. Le jeu de test ne peut alors distinguer aucun système d'aucun autre.
  const verites = a.ok.map((c) => etiquette(c.truth)).filter((v): v is string => v !== null);
  if (verites.length >= 10) {
    const comptes = new Map<string, number>();
    for (const v of verites) comptes.set(v, (comptes.get(v) ?? 0) + 1);
    const part = Math.max(...comptes.values()) / verites.length;
    if (part >= 0.95) {
      r.push(t({
        fr: comptes.size === 1
          ? "Tous les cas portent la MÊME vérité terrain. Ce jeu de test ne peut distinguer aucun "
            + "système d'aucun autre : « répondre toujours la même chose » y obtient 100 %. Le "
            + "chiffre produit ici ne mesure rien."
          : `${(part * 100).toFixed(0)} % des cas portent la même vérité terrain. « Répondre `
            + "toujours cette réponse » obtient donc presque tout juste sans rien savoir. Le taux "
            + "global est ininterprétable tel quel : c'est la performance sur la classe "
            + "MINORITAIRE qui décide, et elle repose sur très peu de cas.",
        en: "The ground truth is nearly constant: answering the same thing every time scores "
          + "almost perfectly. The overall success rate is uninterpretable as such.",
      }));
    }
  }

  // ── Système dégénéré. ──
  const sorties = a.ok.map((c) => etiquette(c.prediction)).filter((v): v is string => v !== null);
  if (sorties.length >= 10 && new Set(sorties).size === 1) {
    r.push(t({
      fr: "Le système répond TOUJOURS la même chose, sur tous les cas. Son taux de réussite est "
        + "donc exactement la fréquence de cette réponse dans la vérité terrain : il ne mesure "
        + "aucune capacité à distinguer. Vérifier que l'adaptateur appelle bien le système, et "
        + "que celui-ci reçoit bien l'entrée.",
      en: "The system always returns the same answer. Its success rate is exactly the frequency "
        + "of that answer in the ground truth, and measures no discrimination at all.",
    }));
  }

  // ── Observations groupées : l'intervalle de confiance est alors trop étroit. ──
  //
  // TROUVÉ SUR UNE MESURE RÉELLE. Un système de sélection d'actions produisait 170 prédictions
  // réparties sur 10 séances de bourse. Tous les paris d'un même jour subissent le même marché :
  // ils gagnent ou perdent largement ensemble. Les compter comme 170 tirages indépendants donne
  // des intervalles beaucoup trop étroits, et fait conclure là où il n'y a rien à conclure.
  //
  // Le pack ne peut pas deviner ce lien : seul l'adaptateur le connaît, via `cluster()`. Quand il
  // le déclare, on le dit — et on donne l'ordre de grandeur de l'effectif réellement disponible.
  const grappes = new Set(
    a.ok.map((c) => c.cluster).filter((v): v is string => typeof v === "string"),
  );
  if (grappes.size > 0 && grappes.size * 3 <= a.n) {
    r.push(tf({
      fr: (k: number) =>
        `Les ${a.n} cas se répartissent sur ${k} grappes seulement `
        + `(environ ${(a.n / k).toFixed(0)} cas par grappe), et l'adaptateur déclare que les cas `
        + "d'une même grappe ne sont pas indépendants. Les intervalles de confiance et les tests "
        + `de ce rapport supposent ${a.n} observations indépendantes : ils sont donc TROP ÉTROITS, `
        + `et l'effectif réellement disponible est plus proche de ${k} que de ${a.n}. Un écart qui `
        + "paraît significatif ici peut ne rien être. Pour conclure, il faut soit agréger par "
        + "grappe avant de comparer, soit recueillir davantage de grappes — pas davantage de cas "
        + "dans les mêmes.",
      en: (k: number) =>
        `The ${a.n} cases fall into only ${k} clusters, and the adapter declares cases within a `
        + `cluster to be dependent. The intervals in this report assume ${a.n} independent `
        + `observations and are therefore TOO NARROW; the usable sample is closer to ${k}.`,
    })(grappes.size));
  }

  // ── Multiplicité. ──
  //
  // Vingt tranches examinées à 95 %, c'est une tranche « remarquable » attendue par pur hasard.
  // Le rapport trie du pire au meilleur et invite à regarder la première : sans cette réserve,
  // c'est une fabrique à fausses découvertes.
  const tranches = a.binary?.byCategory.filter((c) => c.conclusive).length ?? 0;
  if (tranches >= 5) {
    r.push(tf({
      fr: (k: number) =>
        `${k} tranches sont examinées simultanément. À 95 % de confiance, environ `
        + `${(k * 0.05).toFixed(1)} d'entre elles paraîtront anormales par le seul effet du `
        + "hasard. La tranche la plus mauvaise du tableau n'est donc pas une découverte : pour "
        + "conclure sur une tranche précise, il faut la choisir AVANT de regarder, ou exiger un "
        + "écart bien plus net que sur la mesure globale.",
      en: (k: number) =>
        `${k} slices are examined at once. At 95 % confidence roughly ${(k * 0.05).toFixed(1)} of `
        + "them will look abnormal by chance alone. The worst row is not a finding.",
    })(tranches));
  }


  if (a.errors > 0) {
    r.push(tf({
      fr: (e: number) =>
        `${e} cas ont échoué pendant l'évaluation et sont EXCLUS des mesures. Des cas perdus ne le `
        + "sont jamais au hasard : ce sont souvent les plus difficiles. Les scores portent donc sur "
        + "un échantillon plus facile que le vrai.",
      en: (e: number) =>
        `${e} cases failed during evaluation and are EXCLUDED from the measurements. Lost cases are `
        + "never lost at random: they are often the hardest. The scores therefore cover an easier "
        + "sample than the real one.",
    })(a.errors));
  }

  if (a.n < a.minPaired) {
    r.push(tf({
      fr: (n: number, m: number) =>
        `${n} cas évalués : assez pour décrire, pas pour distinguer finement deux systèmes proches `
        + `(il en faudrait ${m}). Un écart faible restera indécidable à ce volume.`,
      en: (n: number, m: number) =>
        `${n} cases evaluated: enough to describe, not to finely separate two close systems `
        + `(${m} would be needed). A small gap will stay undecidable at this volume.`,
    })(a.n, a.minPaired));
  }

  if (a.underpowered.length > 0) {
    r.push(tf({
      fr: (u: number, m: number) =>
        `${u} tranche(s) ou segment(s) sont sous le seuil de ${m} observations : ils sont affichés `
        + "mais aucune conclusion n'en est tirée. Les lire comme des résultats serait l'erreur "
        + "exacte qui a lancé ce projet.",
      en: (u: number, m: number) =>
        `${u} bin(s) or segment(s) are below the threshold of ${m} observations: they are displayed `
        + "but no conclusion is drawn from them. Reading them as results would be the exact mistake "
        + "that started this project.",
    })(a.underpowered.length, a.minObs));
  }

  if (a.probabilistic) {
    if (a.probabilistic.decomposition.binsUsed < 2) {
      r.push(t({
        fr: "Le système n'utilise qu'une seule tranche de confiance : sa résolution est nulle PAR "
          + "CONSTRUCTION, pas par défaut de qualité. Il n'exprime pas de doute, il ne peut donc "
          + "rien discriminer.",
        en: "The system uses only one confidence bin: its resolution is zero BY CONSTRUCTION, not "
          + "for lack of quality. It expresses no doubt, so it cannot discriminate anything.",
      }));
    }
    if (a.probabilistic.spread.distinct <= 3) {
      r.push(tf({
        fr: (d: number) =>
          `Le système ne produit que ${d} valeur(s) de confiance distincte(s). La courbe de `
          + "calibration et l'ECE sont peu informatifs sur un éventail si étroit.",
        en: (d: number) =>
          `The system produces only ${d} distinct confidence value(s). The calibration curve and `
          + "the ECE carry little information on such a narrow range.",
      })(a.probabilistic.spread.distinct));
    }
    r.push(t({
      fr: "La décomposition fiabilité / résolution / incertitude suppose des probabilités discrètes. "
        + "Le regroupement par tranche laisse de la variance intra-tranche : les trois termes ne se "
        + "recomposent pas au centième près. Les ordres de grandeur sont justes.",
      en: "The reliability / resolution / uncertainty decomposition assumes discrete probabilities. "
        + "Binning leaves within-bin variance: the three terms do not recompose to the second "
        + "decimal. The orders of magnitude are correct.",
    }));
  } else {
    r.push(t({
      fr: "Le système ne produit aucune confiance chiffrée : calibration, ECE et décomposition sont "
        + "indisponibles. On sait s'il a raison, pas s'il sait quand il a tort — c'est-à-dire qu'on "
        + "ne peut pas décider quand lui faire confiance.",
      en: "The system produces no numeric confidence: calibration, ECE and decomposition are "
        + "unavailable. You know whether it is right, not whether it knows when it is wrong — that "
        + "is, you cannot decide when to trust it.",
    }));
  }

  if (a.contrastive?.anchoring?.anchored) {
    r.push(
      t({ fr: "ANCRAGE DÉTECTÉ. ", en: "ANCHORING DETECTED. " })
      + a.contrastive.anchoring.statement
      + t({
        fr: " Tant que cette dépendance existe, la comparaison des scores est ininterprétable.",
        en: " As long as this dependency exists, the score comparison is uninterpretable.",
      }),
    );
  }

  if (a.contrastive && a.contrastive.unmatched > 0) {
    r.push(tf({
      fr: (u: number) =>
        `${u} cas n'ont pas de réponse de la référence et sont exclus de la comparaison. `
        + "L'échantillon comparé n'est pas forcément représentatif de l'ensemble.",
      en: (u: number) =>
        `${u} cases have no baseline answer and are excluded from the comparison. The compared `
        + "sample is not necessarily representative of the whole.",
    })(a.contrastive.unmatched));
  }

  // Les réserves propres au coût, rendues par `computeCost` : elles disent si le total est
  // partiel, absent, ou si le dénominateur est nul.
  for (const res of a.cost.reservations) r.push(res);

  r.push(t({
    fr: "Cette mesure porte sur les cas fournis par l'adaptateur. Elle ne dit rien de la performance "
      + "sur des cas d'une autre distribution, ni de la robustesse aux entrées adverses, ni du "
      + "comportement en production.",
    en: "This measurement covers the cases provided by the adapter. It says nothing about "
      + "performance on cases from another distribution, nor about robustness to adversarial "
      + "inputs, nor about behaviour in production.",
  }));

  return r;
}

/**
 * Les défauts, classés par gravité, chacun reproductible.
 *
 * L'ordre de gravité n'est pas cosmétique : une erreur CONFIANTE est plus grave qu'une erreur
 * hésitante, parce qu'un système en aval traite une confiance haute comme un fait. Et une erreur
 * là où la référence avait raison est une régression — c'est le défaut qu'un client paie pour
 * connaître.
 */
function collectDefects(cases: CaseRecord[], minObs: number): Defect[] {
  const out: Defect[] = [];
  for (const c of cases) {
    const conf = c.prediction.prob;
    const base = { itemId: c.itemId, category: c.category, input: c.input, confidence: conf };
    const got = c.prediction.raw ?? c.prediction.label ?? c.prediction.pass ?? c.prediction.ranking ?? c.prediction;
    const expected = c.truth.raw ?? c.truth.label ?? c.truth.ok ?? c.truth.relevant ?? c.truth;

    if (c.correct && !(conf !== undefined && conf <= 0.3)) continue;

    if (!c.correct && c.baselineCorrect === true) {
      out.push({
        ...base,
        severity: "critique",
        kind: "régression vis-à-vis de la référence",
        got,
        expected,
        why: "La référence a répondu juste sur ce cas et le système s'est trompé. C'est un cas où "
          + "le système coûte quelque chose au lieu d'apporter.",
      });
    } else if (!c.correct && conf !== undefined && conf >= 0.8) {
      out.push({
        ...base,
        severity: "critique",
        kind: "erreur confiante",
        got,
        expected,
        why: `Le système s'est trompé en annonçant ${(conf * 100).toFixed(0)} % de confiance. Une `
          + "erreur confiante est plus grave qu'une erreur hésitante : elle sera traitée comme un fait.",
      });
    } else if (!c.correct) {
      out.push({
        ...base,
        severity: "majeur",
        kind: "erreur",
        got,
        expected,
        why: "Réponse incorrecte.",
      });
    } else {
      out.push({
        ...base,
        severity: "mineur",
        kind: "juste mais sans confiance",
        got,
        expected,
        why: `Réponse correcte annoncée à ${((conf ?? 0) * 100).toFixed(0)} % de confiance. Une `
          + "réponse juste que le système croit fausse ne sera pas utilisée en aval.",
      });
    }
  }

  const rank = { critique: 0, majeur: 1, mineur: 2 } as const;
  return out.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

function safeCategory<TItem>(adapter: Adapter<TItem>, item: TItem): string {
  if (!adapter.category) return "";
  try {
    return adapter.category(item) ?? "";
  } catch {
    return "";
  }
}

/**
 * Empreinte des données évaluées.
 *
 * Deux exécutions qui rendent la même empreinte ont vu exactement les mêmes entrées, les mêmes
 * prédictions et les mêmes vérités. C'est ce qui permet de dire, plus tard, si un écart de score
 * vient du système ou du jeu de test.
 */
/** L'étiquette d'une prédiction ou d'une vérité, sous forme comparable. `null` si absente. */
function etiquette(v: unknown): string | null {
  const o = v as { label?: unknown; prob?: unknown } | null | undefined;
  if (!o) return null;
  if (o.label !== undefined && o.label !== null) return String(o.label);
  if (typeof o.prob === "number") return o.prob.toFixed(6);
  return null;
}

/**
 * La cle de grappe d'un cas. Une exception y est traitee comme une absence : un adaptateur qui
 * plante sur `cluster()` ne doit pas faire perdre la mesure, il doit faire perdre la grappe.
 */
function safeCluster<T>(adapter: Adapter<T>, item: T): string | undefined {
  if (!adapter.cluster) return undefined;
  try {
    const v = adapter.cluster(item);
    return typeof v === "string" && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function fingerprint(cases: CaseRecord[]): string {
  const h = createHash("sha256");
  // Séparateurs explicites entre champs et entre cas : sans eux, deux découpages différents des
  // mêmes octets donneraient la même empreinte, et l'empreinte ne prouverait plus rien.
  const SEP = "␟";
  const END = "␞";
  for (const c of cases) {
    h.update(c.itemId);
    h.update(SEP);
    h.update(stableStringify(c.input));
    h.update(SEP);
    h.update(stableStringify(c.truth));
    h.update(END);
  }
  return h.digest("hex").slice(0, 16);
}



function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  }) ?? "null";
}

/** Exécute `fn` sur chaque élément, `limit` en parallèle, en préservant l'ordre des index. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}
