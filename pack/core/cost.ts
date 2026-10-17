// Le coût par réponse correcte — le chiffre qui tranche réellement une décision de migration.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CE MODULE MANQUAIT, ET POURQUOI C'EST GRAVE.
//
// Jusqu'ici le pack répondait à « lequel est le meilleur ? ». Ce n'est presque jamais la question
// qu'on se pose vraiment. La vraie question est « est-ce que ce qu'il apporte en plus vaut ce
// qu'il coûte en plus ? », et un outil qui l'ignore laisse **systématiquement gagner le modèle le
// plus cher** — puisqu'un modèle plus gros est presque toujours un peu meilleur.
//
// Le chiffre décisif n'est pas l'exactitude, c'est le COÛT PAR RÉPONSE CORRECTE :
//
//     coût total ÷ nombre de réponses correctes
//
// Il a une propriété que l'exactitude seule n'a pas : il PUNIT les réponses fausses deux fois —
// on a payé pour les produire, et elles ne comptent pas au dénominateur. Un modèle à 95 % de
// réussite qui coûte quatre fois plus qu'un modèle à 90 % a un coût par réponse correcte presque
// quatre fois pire. C'est exactement ce qu'un acheteur veut savoir, et c'est invisible dans
// n'importe quel tableau de scores.
//
// RÉSERVE, à énoncer et non à cacher : ce module additionne ce que l'adaptateur veut bien
// déclarer. Il ne mesure rien lui-même et ne devine rien. Un coût partiellement renseigné donne
// un total partiel, et la couverture est remontée avec le chiffre.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { t, tf } from "./i18n.ts";
import type { CaseRecord, RunCost } from "./types.ts";

/** Ce qu'un lot de réponses a coûté, et ce que ça fait par réponse correcte. */
export interface CostReport {
  /** Cas pour lesquels au moins une information de coût a été fournie. */
  n: number;
  /** Cas évalués au total. `n / covered` dit à quel point le total est complet. */
  total: number;
  /** Part des cas portant une information de coût. Sous 1, tous les totaux sont partiels. */
  coverage: number;

  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalEur: number | null;
  totalLatencyMs: number | null;

  /** Réponses correctes parmi les cas couverts. Le dénominateur qui compte. */
  correct: number;

  /** Coût monétaire par réponse correcte. `null` si aucun coût monétaire déclaré. */
  eurPerCorrect: number | null;
  /** Jetons (entrée + sortie) par réponse correcte. */
  tokensPerCorrect: number | null;
  /** Durée moyenne par réponse correcte, en millisecondes. */
  msPerCorrect: number | null;
  /** Durée médiane d'une réponse, correcte ou non. Plus robuste que la moyenne aux blocages. */
  medianLatencyMs: number | null;

  /** Ce que la mesure ne dit pas. Jamais vide quand la couverture est partielle. */
  reservations: string[];
}

function sum(values: Array<number | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Agrège les coûts déclarés par l'adaptateur.
 *
 * ATTENTION AU DÉNOMINATEUR. On divise par le nombre de réponses CORRECTES parmi les cas
 * couverts, pas par le nombre de cas. Diviser par le nombre de cas donnerait le coût par appel,
 * qui ne dit rien : deux modèles au même coût par appel dont l'un se trompe deux fois plus n'ont
 * pas du tout le même coût réel.
 *
 * Quand aucune réponse n'est correcte, le coût par réponse correcte est infini — ce qui est la
 * bonne réponse, pas une erreur de calcul. On le rend comme `Infinity` et le rapport l'écrit.
 */
export function computeCost(cases: CaseRecord[]): CostReport {
  const usable = cases.filter((c) => !c.error);
  const covered = usable.filter((c) => c.prediction.cost !== undefined);
  const costs: RunCost[] = covered.map((c) => c.prediction.cost!);

  const totalInputTokens = sum(costs.map((c) => c.inputTokens));
  const totalOutputTokens = sum(costs.map((c) => c.outputTokens));
  const totalEur = sum(costs.map((c) => c.eur));
  const totalLatencyMs = sum(costs.map((c) => c.latencyMs));
  const latencies = costs
    .map((c) => c.latencyMs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const correct = covered.filter((c) => c.correct).length;
  const perCorrect = (total: number | null): number | null => {
    if (total === null) return null;
    return correct > 0 ? total / correct : Number.POSITIVE_INFINITY;
  };

  const tokens =
    totalInputTokens === null && totalOutputTokens === null
      ? null
      : (totalInputTokens ?? 0) + (totalOutputTokens ?? 0);

  const coverage = usable.length > 0 ? covered.length / usable.length : 0;
  const reservations: string[] = [];

  if (covered.length === 0) {
    reservations.push(
      t({
        fr: "Aucun coût déclaré par l'adaptateur : le coût par réponse correcte est indisponible. "
          + "C'est le chiffre qui tranche une décision de migration — sans lui, on compare des "
          + "qualités sans comparer des prix, et le modèle le plus cher gagne par défaut.",
        en: "No cost declared by the adapter: cost per correct answer is unavailable. That is the "
          + "figure that settles a migration decision — without it you compare quality without "
          + "comparing price, and the most expensive model wins by default.",
      }),
    );
  } else if (coverage < 1) {
    reservations.push(
      tf({
        fr: (c: string) =>
          `Coût déclaré sur ${c} des cas seulement : tous les totaux sont partiels et ne peuvent `
          + "pas être comparés à un total complet.",
        en: (c: string) =>
          `Cost declared on only ${c} of cases: every total is partial and cannot be compared to a `
          + "complete total.",
      })(`${(coverage * 100).toFixed(0)} %`),
    );
  }

  if (covered.length > 0 && correct === 0) {
    reservations.push(
      t({
        fr: "Aucune réponse correcte parmi les cas couverts : le coût par réponse correcte est "
          + "infini. Ce n'est pas une erreur de calcul, c'est le résultat.",
        en: "No correct answer among covered cases: cost per correct answer is infinite. That is "
          + "not a computation error, it is the result.",
      }),
    );
  }

  if (totalEur === null && tokens !== null) {
    reservations.push(
      t({
        fr: "Jetons déclarés mais pas de prix : le coût monétaire ne peut pas être calculé. Les "
          + "jetons ne sont comparables qu'entre modèles au même tarif.",
        en: "Tokens declared but no price: monetary cost cannot be computed. Token counts are only "
          + "comparable between models on the same tariff.",
      }),
    );
  }

  return {
    n: covered.length,
    total: usable.length,
    coverage,
    totalInputTokens,
    totalOutputTokens,
    totalEur,
    totalLatencyMs,
    correct,
    eurPerCorrect: perCorrect(totalEur),
    tokensPerCorrect: perCorrect(tokens),
    msPerCorrect: perCorrect(totalLatencyMs),
    medianLatencyMs: median(latencies),
    reservations,
  };
}

/** Le verdict économique d'une migration : ce que le changement coûte pour ce qu'il apporte. */
export type EconomicVerdict =
  | "MOINS CHER ET MEILLEUR"
  | "PLUS CHER MAIS MEILLEUR"
  | "MOINS CHER, QUALITÉ ÉQUIVALENTE"
  | "PLUS CHER SANS GAIN"
  | "INCOMPARABLE";

export interface CostComparison {
  before: CostReport;
  after: CostReport;
  /** Rapport des coûts par réponse correcte : > 1 = le nouveau coûte plus cher. */
  ratio: number | null;
  /** Écart relatif de qualité, fourni par l'appelant (écart de taux de réussite). */
  qualityDelta: number;
  /** La qualité a-t-elle changé de façon démontrée ? Fourni par l'appelant. */
  qualitySignificant: boolean;
  verdict: EconomicVerdict;
  statement: string;
}

/**
 * Croise le coût et la qualité pour dire si un changement vaut son prix.
 *
 * La combinaison la plus utile n'est pas « meilleur » ou « moins cher », c'est leur croisement —
 * et en particulier la case que personne ne regarde : **plus cher sans gain démontré**. C'est le
 * cas le plus fréquent d'une migration vers un modèle plus gros, et le plus coûteux.
 *
 * `qualitySignificant` vient de la comparaison appariée (McNemar ou intervalle de Brier). On ne
 * le recalcule pas ici : un module de coût qui redéciderait de la qualité serait une seconde
 * mesure, exactement ce que le projet interdit.
 */
export function compareCost(args: {
  before: CostReport;
  after: CostReport;
  qualityDelta: number;
  qualitySignificant: boolean;
}): CostComparison {
  const { before, after, qualityDelta, qualitySignificant } = args;

  const b = before.eurPerCorrect ?? before.tokensPerCorrect ?? before.msPerCorrect;
  const a = after.eurPerCorrect ?? after.tokensPerCorrect ?? after.msPerCorrect;

  let ratio: number | null = null;
  if (b !== null && a !== null && Number.isFinite(b) && Number.isFinite(a) && b > 0) {
    ratio = a / b;
  }

  if (ratio === null) {
    return {
      before,
      after,
      ratio,
      qualityDelta,
      qualitySignificant,
      verdict: "INCOMPARABLE",
      statement: t({
        fr: "Coûts non comparables : au moins une des deux exécutions ne déclare aucun coût, ou "
          + "n'a produit aucune réponse correcte. La décision de migration se prend alors sur la "
          + "seule qualité, en sachant qu'on ignore le prix.",
        en: "Costs are not comparable: at least one run declares no cost, or produced no correct "
          + "answer. The migration decision then rests on quality alone, knowing the price is "
          + "unknown.",
      }),
    };
  }

  // 5 % de tolérance : sous cet écart, deux coûts sont pratiquement les mêmes.
  const cheaper = ratio < 0.95;
  const pricier = ratio > 1.05;
  const better = qualitySignificant && qualityDelta > 0;
  const worse = qualitySignificant && qualityDelta < 0;

  const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
  const times = ratio >= 1 ? `${ratio.toFixed(2)} ×` : `${(1 / ratio).toFixed(2)} × moins`;

  let verdict: EconomicVerdict;
  let statement: string;

  if (better && !pricier) {
    verdict = "MOINS CHER ET MEILLEUR";
    statement = tf({
      fr: (q: string, r: string) =>
        `Gain de qualité démontré (${q}) sans surcoût (${r} le coût par réponse correcte). `
        + "C'est le seul cas où la migration ne demande aucun arbitrage.",
      en: (q: string, r: string) =>
        `Demonstrated quality gain (${q}) at no extra cost (${r} the cost per correct answer). `
        + "The only case where migrating requires no trade-off.",
    })(pct(qualityDelta), times);
  } else if (better && pricier) {
    verdict = "PLUS CHER MAIS MEILLEUR";
    statement = tf({
      fr: (q: string, r: string) =>
        `Gain de qualité démontré (${q}), mais le coût par réponse correcte est multiplié par ${r}. `
        + "L'arbitrage est réel et il appartient à celui qui paie — l'outil ne le tranche pas.",
      en: (q: string, r: string) =>
        `Demonstrated quality gain (${q}), but cost per correct answer is multiplied by ${r}. `
        + "The trade-off is real and belongs to whoever pays — the tool does not settle it.",
    })(pct(qualityDelta), ratio.toFixed(2));
  } else if (worse) {
    verdict = "PLUS CHER SANS GAIN";
    statement = tf({
      fr: (q: string) =>
        `Qualité en baisse démontrée (${q}). Quel que soit le coût, ce changement n'a pas de `
        + "justification mesurable.",
      en: (q: string) =>
        `Demonstrated quality drop (${q}). Whatever the cost, this change has no measurable `
        + "justification.",
    })(pct(qualityDelta));
  } else if (cheaper) {
    verdict = "MOINS CHER, QUALITÉ ÉQUIVALENTE";
    statement = tf({
      fr: (r: string) =>
        `Aucun écart de qualité démontré, et le coût par réponse correcte est ${r} élevé. `
        + "C'est une économie sans contrepartie mesurée — le cas le plus rentable, et celui qu'on "
        + "ne cherche presque jamais.",
      en: (r: string) =>
        `No demonstrated quality gap, and cost per correct answer is ${r}. A saving with no `
        + "measured downside — the most profitable case, and the one almost nobody looks for.",
    })(times);
  } else if (pricier) {
    verdict = "PLUS CHER SANS GAIN";
    statement = tf({
      fr: (r: string) =>
        `Coût par réponse correcte multiplié par ${r}, sans écart de qualité démontré. C'est le `
        + "cas le plus fréquent d'une migration vers un modèle plus gros, et le plus coûteux : on "
        + "paie une différence qu'on n'a pas prouvée.",
      en: (r: string) =>
        `Cost per correct answer multiplied by ${r}, with no demonstrated quality gap. This is the `
        + "most common case when migrating to a bigger model, and the most expensive: you pay for "
        + "a difference you have not proven.",
    })(ratio.toFixed(2));
  } else {
    verdict = "MOINS CHER, QUALITÉ ÉQUIVALENTE";
    statement = t({
      fr: "Ni la qualité ni le coût ne diffèrent de façon notable. Le changement est neutre : il "
        + "ne se justifie ni ne se déconseille sur ces mesures.",
      en: "Neither quality nor cost differ noticeably. The change is neutral: these measurements "
        + "neither justify nor discourage it.",
    });
  }

  return { before, after, ratio, qualityDelta, qualitySignificant, verdict, statement };
}
