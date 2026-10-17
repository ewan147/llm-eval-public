// Les chaînes destinées à un lecteur, dans les deux langues.
//
// L'API — types, fonctions, champs — reste en anglais, comme tout le reste du pack. Seuls les
// textes lus par un humain sont traduits.
//
// POURQUOI CE MODULE EXISTE PLUTÔT QUE DES CHAÎNES EN DUR. Les verdicts de ce pack ne sont pas de
// la décoration : ce sont eux qui portent le refus, les réserves et les nuances entre INDÉCIDABLE
// et ÉQUIVALENT. Les laisser dispersés dans le code, c'est garantir qu'une traduction en perde la
// moitié — et le pack vaut précisément par ce que ces phrases disent.

export type Lang = "fr" | "en";

let current: Lang = "fr";

/** Change la langue de toutes les sorties. Appelée une fois, au démarrage. */
export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** Une chaîne dans les deux langues. */
type Pair = { fr: string; en: string };

/** Rend la variante de la langue courante. */
export function t(pair: Pair): string {
  return pair[current];
}

/** Rend une fonction de formatage dans la langue courante. */
export function tf<A extends unknown[]>(pair: {
  fr: (...a: A) => string;
  en: (...a: A) => string;
}): (...a: A) => string {
  return pair[current];
}

// ── Vocabulaire des verdicts ──────────────────────────────────────────────────────────────────
//
// Les identifiants de verdict restent en français dans les données (`VerdictKind`), parce que ce
// sont des valeurs de type, pas du texte. Seul l'affichage est traduit.

export const VERDICT_LABEL: Record<string, Pair> = {
  BAT: { fr: "BAT LA RÉFÉRENCE", en: "BEATS THE BASELINE" },
  "MOINS BON": { fr: "MOINS BON QUE LA RÉFÉRENCE", en: "WORSE THAN THE BASELINE" },
  ÉQUIVALENT: { fr: "ÉQUIVALENT À LA RÉFÉRENCE", en: "EQUIVALENT TO THE BASELINE" },
  INDÉCIDABLE: { fr: "INDÉCIDABLE", en: "UNDECIDABLE" },
  REFUSÉ: { fr: "REFUS", en: "REFUSED" },
};

export const SEVERITY_LABEL: Record<string, Pair> = {
  critique: { fr: "critique", en: "critical" },
  majeur: { fr: "majeur", en: "major" },
  mineur: { fr: "mineur", en: "minor" },
};

export const MODE_LABEL: Record<string, Pair> = {
  "verdict-direct": { fr: "verdict direct", en: "direct verdict" },
  étiquettes: { fr: "étiquettes", en: "labels" },
  "récupération@k": { fr: "récupération@k", en: "retrieval@k" },
  événement: { fr: "événement", en: "event" },
};

// ── Titres de sections, communs aux trois formats de rapport ──────────────────────────────────

export const S = {
  evaluation: { fr: "ÉVALUATION", en: "EVALUATION" },
  verdict: { fr: "Verdict", en: "Verdict" },
  refusalTitle: { fr: "REFUS DE VERDICT", en: "VERDICT REFUSED" },
  refusalWhy: {
    fr: "Pourquoi aucun verdict n'est rendu",
    en: "Why no verdict is given",
  },
  acceptedBaselines: {
    fr: "Références acceptées — il y en a toujours une :",
    en: "Accepted baselines — there is always one:",
  },
  comparison: { fr: "COMPARAISON À LA RÉFÉRENCE", en: "COMPARISON TO THE BASELINE" },
  comparisonTitle: { fr: "Comparaison à la référence", en: "Comparison to the baseline" },
  noBaseline: {
    fr: "AUCUNE. C'est la mesure manquante la plus grave : sans elle, tous les chiffres "
      + "ci-dessous sont des scores absolus, et un score absolu ne dit rien.",
    en: "NONE. This is the most serious missing measurement: without it, every number below is an "
      + "absolute score, and an absolute score tells you nothing.",
  },
  trivialFloors: {
    fr: "planchers gratuits (les battre est nécessaire, jamais suffisant)",
    en: "free floors (beating them is necessary, never sufficient)",
  },
  trivialFloorsTitle: { fr: "Planchers gratuits", en: "Free floors" },
  metrics: { fr: "MÉTRIQUES", en: "METRICS" },
  metricsTitle: { fr: "Métriques", en: "Metrics" },
  ranking: { fr: "MÉTRIQUES DE RANG", en: "RANKING METRICS" },
  rankingTitle: { fr: "Métriques de rang", en: "Ranking metrics" },
  power: { fr: "CE QU'IL FAUDRAIT POUR TRANCHER", en: "WHAT IT WOULD TAKE TO DECIDE" },
  powerTitle: { fr: "Ce qu'il faudrait pour trancher", en: "What it would take to decide" },
  byCategory: {
    fr: "VENTILATION PAR CATÉGORIE — du pire au meilleur",
    en: "BREAKDOWN BY CATEGORY — worst to best",
  },
  byCategoryTitle: { fr: "Ventilation par catégorie", en: "Breakdown by category" },
  underpowered: {
    fr: "ÉCARTÉS POUR ÉCHANTILLON INSUFFISANT",
    en: "SET ASIDE FOR INSUFFICIENT SAMPLE",
  },
  underpoweredTitle: {
    fr: "Écartés pour échantillon insuffisant",
    en: "Set aside for insufficient sample",
  },
  reservations: {
    fr: "RÉSERVES — ce que cette mesure ne dit pas",
    en: "RESERVATIONS — what this measurement does not tell you",
  },
  reservationsTitle: {
    fr: "Réserves — ce que cette mesure ne dit pas",
    en: "Reservations — what this measurement does not tell you",
  },
  defects: { fr: "DÉFAUTS", en: "DEFECTS" },
  defectsTitle: { fr: "Défauts trouvés", en: "Defects found" },
  nextSteps: {
    fr: "Ce qu'il faudrait mesurer ensuite",
    en: "What to measure next",
  },
  reproducibility: { fr: "REPRODUCTIBILITÉ", en: "REPRODUCIBILITY" },
  reproducibilityTitle: { fr: "Reproductibilité", en: "Reproducibility" },
  drift: { fr: "DÉRIVE", en: "DRIFT" },
} as const;

// ── Étiquettes de champs ──────────────────────────────────────────────────────────────────────

export const F = {
  cases: { fr: "cas évalués", en: "cases evaluated" },
  errors: { fr: "en erreur, exclus", en: "errored, excluded" },
  mode: { fr: "mode(s) de résolution", en: "resolution mode(s)" },
  successRate: { fr: "taux de réussite", en: "success rate" },
  paired: { fr: "cas appariés", en: "paired cases" },
  unpaired: { fr: "cas sans réponse de la référence", en: "cases with no baseline answer" },
  systemBrier: { fr: "Brier système", en: "system Brier" },
  baselineBrier: { fr: "Brier référence", en: "baseline Brier" },
  brierDiff: { fr: "écart de Brier apparié", en: "paired Brier difference" },
  lowerBetter: { fr: "(négatif = système meilleur)", en: "(negative = system is better)" },
  logLoss: { fr: "log-loss système / réf.", en: "log-loss system / baseline" },
  skillVsBaseline: { fr: "skill vs référence", en: "skill vs baseline" },
  rateDiff: { fr: "écart apparié", en: "paired difference" },
  anchoringTitle: {
    fr: "ancrage (mesuré sans consulter les vérités terrain)",
    en: "anchoring (measured without consulting any ground truth)",
  },
  medianGap: { fr: "écart médian", en: "median gap" },
  correlation: { fr: "corrélation", en: "correlation" },
  within2: { fr: "part à moins de 2 pts", en: "share within 2 pts" },
  baseRate: { fr: "taux de base", en: "base rate" },
  majorityLabel: { fr: "étiquette majoritaire", en: "majority label" },
  randomAnswer: { fr: "réponse au hasard", en: "random answer" },
  climatologyBrier: { fr: "Brier du taux de base", en: "base-rate Brier" },
  randomBrier: { fr: "Brier d'une réponse au hasard", en: "random-answer Brier" },
  beaten: { fr: "battu", en: "beaten" },
  ece: { fr: "ECE / MCE", en: "ECE / MCE" },
  announced: { fr: "confiance annoncée", en: "announced confidence" },
  observed: { fr: "réalisé", en: "observed" },
  bias: { fr: "biais", en: "bias" },
  spread: { fr: "éventail de confiance", en: "confidence spread" },
  decomposition: {
    fr: "décomposition (Brier = fiabilité − résolution + incertitude)",
    en: "decomposition (Brier = reliability − resolution + uncertainty)",
  },
  reliability: { fr: "fiabilité", en: "reliability" },
  resolution: { fr: "résolution", en: "resolution" },
  uncertainty: { fr: "incertitude", en: "uncertainty" },
  skillVsBase: { fr: "skill vs taux de base", en: "skill vs base rate" },
  lowerIsBetter: { fr: "(plus bas = mieux)", en: "(lower is better)" },
  higherIsBetter: { fr: "(plus haut = mieux)", en: "(higher is better)" },
  problemNoise: { fr: "(le bruit du problème)", en: "(the problem's own noise)" },
  calibrationCurve: { fr: "courbe de calibration", en: "calibration curve" },
  bin: { fr: "tranche", en: "bin" },
  conclusive: { fr: "conclusif", en: "conclusive" },
  category: { fr: "catégorie", en: "category" },
  interval: { fr: "intervalle", en: "interval" },
  scope: { fr: "portée", en: "scope" },
  label: { fr: "libellé", en: "label" },
  threshold: { fr: "seuil", en: "threshold" },
  command: { fr: "commande", en: "command" },
  runAt: { fr: "exécuté le", en: "run at" },
  packVersion: { fr: "version du pack / Node", en: "pack version / Node" },
  fingerprint: { fr: "empreinte des données", en: "data fingerprint" },
  seedBootstrap: { fr: "graine / bootstrap", en: "seed / bootstrap" },
  thresholds: { fr: "seuils", en: "thresholds" },
  resamples: { fr: "rééchantillonnages", en: "resamples" },
  input: { fr: "entrée", en: "input" },
  got: { fr: "obtenu", en: "got" },
  expected: { fr: "attendu", en: "expected" },
  why: { fr: "pourquoi", en: "why" },
  confidence: { fr: "confiance", en: "confidence" },
  yes: { fr: "oui", en: "yes" },
  no: { fr: "NON", en: "NO" },
  notApplicable: { fr: "non applicable", en: "not applicable" },
  none: { fr: "aucun", en: "none" },
  required: { fr: "requis", en: "required" },
  available: { fr: "disponibles", en: "available" },
  toAdd: { fr: "à ajouter", en: "to add" },
  achievedPower: { fr: "puissance atteinte", en: "achieved power" },
  hitAtK: { fr: "hit@k", en: "hit@k" },
  recallAtK: { fr: "rappel@k", en: "recall@k" },
  mrr: { fr: "MRR", en: "MRR" },
  ndcg: { fr: "NDCG@k", en: "NDCG@k" },
  system: { fr: "système", en: "system" },
  baseline: { fr: "référence", en: "baseline" },
  diagnosis: { fr: "diagnostic", en: "diagnosis" },
} as const;

// ── Phrases longues ───────────────────────────────────────────────────────────────────────────

export const P = {
  noRankingBreakdown: {
    fr: "Aucune ventilation disponible (mode « événement », ou `category?` non implémentée).",
    en: "No breakdown available (event mode, or `category?` not implemented).",
  },
  noConfidence: {
    fr: "Aucune confiance chiffrée : calibration, ECE et décomposition indisponibles.",
    en: "No numeric confidence: calibration, ECE and decomposition are unavailable.",
  },
  successRateNotApplicable: {
    fr: "sans objet en mode « événement » : l'issue ne dépend pas du système. Toute sa qualité "
      + "est dans la probabilité annoncée.",
    en: "not applicable in event mode: the outcome does not depend on the system. All of its "
      + "quality is in the announced probability.",
  },
  nothingUnderpowered: {
    fr: "Aucun : toutes les tranches et catégories atteignent le seuil.",
    en: "None: every bin and category reaches the threshold.",
  },
  underpoweredWarning: {
    fr: "Ces lignes sont affichées mais ne portent AUCUNE conclusion.",
    en: "These rows are displayed but carry NO conclusion.",
  },
  degenerateFloor: {
    fr: "comparaison dégénérée : l'issue est constante sur ce jeu",
    en: "degenerate comparison: the outcome is constant on this set",
  },
  noLabels: {
    fr: "sans objet : les vérités terrain ne portent pas d'étiquette",
    en: "not applicable: ground truths carry no label",
  },
  noDefects: {
    fr: "Aucun défaut : tous les cas sont corrects, et aucun ne l'est avec une confiance "
      + "anormalement basse.",
    en: "No defects: every case is correct, and none is correct with abnormally low confidence.",
  },
  reservationsAreResult: {
    fr: "Cette section fait partie du résultat. Un rapport d'évaluation qui ne dit pas ses limites "
      + "est un rapport qui ment.",
    en: "This section is part of the result. An evaluation report that does not state its limits "
      + "is a report that lies.",
  },
  intervalsMatter: {
    fr: "Chaque valeur est donnée avec son intervalle de confiance à 95 %. Un chiffre sans "
      + "intervalle est un chiffre qui ment.",
    en: "Every value comes with its 95 % confidence interval. A number without an interval is a "
      + "number that lies.",
  },
  anchoringNoTruth: {
    fr: "Mesuré sans consulter une seule vérité terrain : disponible dès le premier jour d'un "
      + "projet, avant le moindre résultat.",
    en: "Measured without consulting a single ground truth: available on day one of a project, "
      + "before any result exists.",
  },
  floorsNecessaryNotSufficient: {
    fr: "Les battre est nécessaire. Ça n'a jamais été suffisant : le système à l'origine de ce "
      + "pack battait le taux de base de 29,2 % et ne valait rien.",
    en: "Beating them is necessary. It has never been sufficient: the system this pack came from "
      + "beat the base rate by 29.2 % and was worthless.",
  },
  worstFirst: {
    fr: "Triée du pire au meilleur. C'est ici qu'on voit où le système échoue, et non pas "
      + "seulement combien.",
    en: "Sorted worst to best. This is where you see where the system fails, not just how often.",
  },
  underpoweredHistory: {
    fr: "Le projet à l'origine de ce pack a produit des ajustements à partir de tranches à n = 5, "
      + "4 et 6 ; c'est la première erreur consignée dans son journal.",
    en: "The project this pack came from made adjustments from bins of n = 5, 4 and 6; that is the "
      + "first mistake recorded in its log.",
  },
  fingerprintExplained: {
    fr: "Deux exécutions qui affichent la même empreinte ont vu exactement les mêmes entrées et "
      + "les mêmes vérités terrain. C'est ce qui permet de dire si un écart vient du système ou du "
      + "jeu de test.",
    en: "Two runs showing the same fingerprint saw exactly the same inputs and ground truths. That "
      + "is what lets you tell whether a difference comes from the system or from the test set.",
  },
  defectsExplained: {
    fr: "Classés par gravité. Chacun est reproductible tel quel : entrée exacte, sortie obtenue, "
      + "sortie attendue. Une erreur confiante est classée plus grave qu'une erreur hésitante, "
      + "parce qu'un système en aval la traitera comme un fait.",
    en: "Sorted by severity. Each is reproducible as-is: exact input, output obtained, output "
      + "expected. A confident error ranks as more severe than a hesitant one, because a "
      + "downstream system will treat it as a fact.",
  },
  noCategoryMethod: {
    fr: "Aucune catégorie fournie par l'adaptateur (méthode `category?` non implémentée). C'est la "
      + "ligne la plus rentable à ajouter : elle transforme « le système réussit 78 % » en « le "
      + "système échoue sur telle famille de cas ».",
    en: "No category provided by the adapter (`category?` not implemented). It is the highest-value "
      + "line you can add: it turns « the system succeeds 78 % of the time » into « the system "
      + "fails on this family of cases ».",
  },
  sameData: { fr: "mêmes données", en: "same data" },
  regressions: { fr: "régressions", en: "regressions" },
  fixes: { fr: "réparations", en: "fixes" },
  before: { fr: "avant", en: "before" },
  after: { fr: "après", en: "after" },
} as const;
