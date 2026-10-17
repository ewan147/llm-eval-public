// Le contrat. C'est le seul fichier que quelqu'un doit lire avant d'écrire son adaptateur.
//
// PRINCIPE. Le cœur ne sait rien de ce qu'il mesure. Il reçoit, pour chaque cas : ce que le
// système a répondu, ce qu'il fallait répondre, et — si on la lui donne — ce qu'une référence
// aurait répondu. Tout le reste en découle.

/** Ce que le système testé répond sur un cas. Au moins un champ doit être rempli. */
export interface Prediction {
  /**
   * Confiance dans la réponse donnée, dans [0, 1].
   *
   * C'est la confiance dans SA PROPRE réponse, pas la probabilité d'une classe fixée : un
   * classifieur qui répond « spam » à 90 % remplit `label: "spam"` et `prob: 0.9`. Sans ce champ,
   * les métriques probabilistes (Brier, calibration, décomposition) sont indisponibles et le
   * rapport le dit.
   */
  prob?: number;
  /** La réponse donnée : classe, identifiant de document, verdict… Comparée à `Outcome.label`. */
  label?: string;
  /** Verdict direct quand l'adaptateur juge lui-même la réussite. Court-circuite la comparaison. */
  pass?: boolean;
  /** Candidats ordonnés, du meilleur au moins bon. Pour la récupération documentaire. */
  ranking?: string[];
  /** Sortie brute, conservée telle quelle pour rendre un défaut reproductible dans le rapport. */
  raw?: unknown;
  /**
   * Ce qu'a coûté la production de CETTE réponse. Facultatif, et c'est le champ qui manque le
   * plus souvent — voir `core/cost.ts` pour ce qu'il permet de dire.
   */
  cost?: RunCost;
}

/**
 * Le coût d'une réponse. Tous les champs sont facultatifs : on remplit ce qu'on sait.
 *
 * POURQUOI CE N'EST PAS UN DÉTAIL COMPTABLE. « Ce modèle est 3 % meilleur » ne se décide pas
 * sans « pour combien de fois le prix ». Un système d'évaluation qui ignore le coût laisse
 * systématiquement gagner le modèle le plus cher, puisqu'il est presque toujours un peu meilleur.
 * Le chiffre qui tranche n'est pas l'exactitude, c'est le COÛT PAR RÉPONSE CORRECTE.
 */
export interface RunCost {
  inputTokens?: number;
  outputTokens?: number;
  /** Durée de bout en bout, en millisecondes. */
  latencyMs?: number;
  /** Coût monétaire, dans une unité laissée à l'appelant (euros par défaut). */
  eur?: number;
}

/** Ce qu'il fallait répondre. Au moins un champ doit être rempli. */
export interface Outcome {
  /** Verdict direct. Prioritaire sur tout le reste quand il est présent. */
  ok?: boolean;
  /** La bonne réponse, comparée à `Prediction.label`. */
  label?: string;
  /** Les identifiants acceptables. Pour la récupération : succès si l'un est dans les k premiers. */
  relevant?: string[];
  /** Note attendue, conservée pour l'affichage d'un défaut. */
  raw?: unknown;
}

/**
 * La SEULE chose que l'utilisateur écrit.
 *
 * Quatre membres obligatoires, deux facultatifs, et l'interface ne grandira pas : si vous êtes
 * tenté d'ajouter une cinquième méthode, c'est que la complexité doit aller dans `core/`.
 *
 * `baseline` est facultatif au sens de TypeScript, pas au sens de la méthode : sans lui, le pack
 * REFUSE de rendre un verdict de compétence. Voir `core/guards.ts`.
 */
export interface Adapter<TItem> {
  /** Nom du système évalué. Apparaît en tête de chaque rapport. */
  name: string;
  /** Les cas à évaluer. Appelée une fois. */
  loadItems(): Promise<TItem[]>;
  /** Ce que dit le système testé. Appelée une fois par cas. */
  predict(item: TItem): Promise<Prediction>;
  /** Ce qui est réellement arrivé, ou ce qui était attendu. Appelée une fois par cas. */
  truth(item: TItem): Promise<Outcome>;
  /** Ce qu'aurait répondu la référence. FORTEMENT RECOMMANDÉ — sans elle, aucun verdict. */
  baseline?(item: TItem): Promise<Prediction>;
  /** Segment d'appartenance du cas, pour la ventilation. Retourner "" pour ne pas ventiler. */
  category?(item: TItem): string;
  /**
   * Clé de GRAPPE : les cas qui la partagent ne sont PAS des observations indépendantes.
   *
   * POURQUOI CETTE MÉTHODE EXISTE, et elle a été ajoutée après une mesure réelle qui l'exigeait.
   * Un système de sélection d'actions produisait 170 prédictions réparties sur 10 séances de
   * bourse — dix-sept par jour. Tous les paris d'un même jour subissent le MÊME marché : si la
   * séance monte, ils gagnent presque tous ensemble. Les traiter comme 170 tirages indépendants
   * donne des intervalles de confiance beaucoup trop étroits, et fait conclure là où il n'y a
   * rien à conclure.
   *
   * Le nombre qui compte n'est alors pas le nombre de cas, mais le nombre de GRAPPES. Renvoyer
   * ici la date, la session, l'utilisateur, le document source — ce qui fait que deux cas
   * partagent leur sort.
   *
   * Ne rien renvoyer est le comportement historique : chaque cas est supposé indépendant. C'est
   * souvent faux, et le pack ne peut pas le deviner tout seul.
   */
  cluster?(item: TItem): string;
}

/** Options d'exécution. Toutes ont une valeur par défaut défendable. */
export interface EvalOptions {
  /** Coupures des tranches de confiance. Par défaut : déciles. */
  bins?: number[];
  /** Sous ce nombre d'observations, une tranche ou un segment ne reçoit aucune conclusion. */
  minObs?: number;
  /** Nombre de rééchantillonnages bootstrap. Plus haut = intervalles plus stables, plus lent. */
  bootstrapSamples?: number;
  /** Graine du générateur pseudo-aléatoire. Fixe par défaut : deux exécutions donnent le même CI. */
  seed?: number;
  /** Profondeur k pour les métriques de récupération (le bon document est-il dans les k premiers ?). */
  k?: number;
  /** Concurrence des appels à `predict` / `truth` / `baseline`. */
  concurrency?: number;
}

/** Une observation probabiliste normalisée : ce que le cœur sait manipuler. */
export interface Observation {
  itemId: string;
  category: string;
  /** Confiance annoncée dans la réponse donnée, dans [0, 1]. */
  prob: number;
  /** La réponse était-elle la bonne ? */
  outcome: boolean;
}

/** Un essai binaire normalisé : réussite ou échec, sans probabilité. */
export interface Trial {
  itemId: string;
  category: string;
  pass: boolean;
}

/** Le compte rendu d'un cas, conservé pour rendre un défaut reproductible. */
export interface CaseRecord {
  itemId: string;
  category: string;
  /** Clé de grappe déclarée par l'adaptateur. Les cas qui la partagent sont liés. */
  cluster?: string;
  /** L'entrée exacte, sérialisée. Tronquée à l'affichage, jamais au stockage. */
  input: unknown;
  prediction: Prediction;
  truth: Outcome;
  /** Le système a-t-il eu raison ? */
  correct: boolean;
  /** La référence a-t-elle eu raison sur ce même cas ? `undefined` s'il n'y a pas de référence. */
  baselineCorrect?: boolean;
  baselinePrediction?: Prediction;
  /** Erreur levée pendant l'évaluation de ce cas, s'il y en a eu une. */
  error?: string;
}

/** Une tranche résumée : ce qu'on annonçait, ce qui est arrivé, l'écart. */
export interface Slice {
  label: string;
  n: number;
  predicted: number;
  actual: number;
  /** predicted − actual. Positif = surconfiance, négatif = sous-confiance. */
  bias: number;
  /** Faux quand n < minObs : la tranche est affichée mais aucune conclusion n'en est tirée. */
  conclusive: boolean;
}

/** Un intervalle de confiance. Un chiffre sans intervalle est un chiffre qui ment. */
export interface Interval {
  value: number;
  low: number;
  high: number;
  /** Niveau de confiance, 0,95 par défaut. */
  level: number;
  /** Méthode employée : "bootstrap", "wilson", "normal". */
  method: string;
}
