// De ce que l'adaptateur rend, à ce que le cœur sait mesurer.
//
// C'est ici que se joue la généricité du pack : quatre façons naturelles de décrire « le système
// a-t-il eu raison ? » sont ramenées à une seule paire (confiance, correct). Aucun adaptateur n'a
// à connaître cette réduction.

import type { Observation, Outcome, Prediction, Trial } from "./types.ts";

/** Comment la correction a été établie. Affiché dans le rapport : la méthode se justifie. */
export type ResolutionMode =
  | "verdict-direct"      // le système rend `pass`, la vérité rend `ok`
  | "étiquettes"          // `label` prédite comparée à `label` vraie
  | "récupération@k"      // le bon identifiant est-il dans les k premiers de `ranking` ?
  | "événement";          // `prob` = probabilité de l'événement, `ok` = il s'est produit

export interface Resolved {
  correct: boolean;
  /**
   * Confiance retenue, dans [0, 1], ou `undefined` si le système n'en produit pas.
   *
   * SÉMANTIQUE, et elle est unique quel que soit le mode : c'est la confiance dans LA RÉPONSE
   * DONNÉE. En mode « événement » la réponse donnée est « l'événement se produit », donc `prob`
   * est bien P(événement) et `correct` vaut « l'événement s'est produit » — c'est la convention
   * classique du score de Brier. Dans les trois autres modes, `prob` est la confiance du système
   * dans sa propre sortie et `correct` dit si cette sortie était la bonne.
   */
  prob?: number;
  mode: ResolutionMode;
}

/** Normalisation d'étiquette : casse, espaces multiples et espaces de bord ignorés. */
export function normLabel(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Ramène une paire (prédiction, vérité) à « le système a-t-il eu raison, et avec quelle confiance ».
 *
 * L'ordre des cas n'est pas arbitraire : du plus explicite au plus implicite. Un adaptateur qui
 * rend un verdict direct veut qu'on l'utilise ; il ne faut pas le contourner en comparant des
 * étiquettes qu'il aurait remplies par commodité.
 */
export function resolve(prediction: Prediction, truth: Outcome, k: number): Resolved {
  // 1. Verdict direct. `truth.ok` absent signifie « la tâche devait réussir ».
  if (prediction.pass !== undefined) {
    const expected = truth.ok ?? true;
    return { correct: prediction.pass === expected, prob: prediction.prob, mode: "verdict-direct" };
  }

  // 2. Récupération : le bon identifiant est-il assez haut dans la liste ?
  if (prediction.ranking !== undefined && truth.relevant !== undefined) {
    const top = prediction.ranking.slice(0, k).map(normLabel);
    const wanted = new Set(truth.relevant.map(normLabel));
    return {
      correct: top.some((id) => wanted.has(id)),
      prob: prediction.prob,
      mode: "récupération@k",
    };
  }

  // 3. Étiquettes.
  if (prediction.label !== undefined && truth.label !== undefined) {
    return {
      correct: normLabel(prediction.label) === normLabel(truth.label),
      prob: prediction.prob,
      mode: "étiquettes",
    };
  }

  // 4. Événement probabiliste : le système donne P(événement), la vérité dit s'il a eu lieu.
  if (prediction.prob !== undefined && truth.ok !== undefined) {
    return { correct: truth.ok, prob: prediction.prob, mode: "événement" };
  }

  throw new Error(
    "Impossible de déterminer si le système a eu raison. L'adaptateur doit rendre au moins une "
    + "combinaison exploitable : `pass` + `ok`, `ranking` + `relevant`, `label` + `label`, ou "
    + "`prob` + `ok`. Reçu prédiction="
    + JSON.stringify(prediction)
    + " vérité="
    + JSON.stringify(truth),
  );
}

/** Une observation probabiliste, ou `null` si le système ne produit pas de confiance. */
export function toObservation(itemId: string, category: string, r: Resolved): Observation | null {
  if (r.prob === undefined) return null;
  if (!Number.isFinite(r.prob) || r.prob < 0 || r.prob > 1) {
    throw new Error(
      `Confiance hors de [0,1] sur ${itemId} : ${r.prob}. Une probabilité de 0 ou de 1 est acceptée `
      + "(et coûte cher en log-loss si elle se trompe), mais pas une valeur hors bornes.",
    );
  }
  return { itemId, category, prob: r.prob, outcome: r.correct };
}

/**
 * Un essai binaire — ou `null` quand la notion n'a pas de sens.
 *
 * ATTENTION, ET C'EST UN PIÈGE QUE LE PACK A ATTRAPÉ SUR LUI-MÊME : en mode « événement », la
 * « réussite » ne dépend pas du système. L'événement s'est produit ou non, et cette issue est la
 * même quel que soit ce qu'on avait annoncé. Produire un essai binaire ici afficherait un « taux
 * de réussite » qui n'est que le taux de survenue de l'événement — identique pour le système et
 * pour sa référence, donc un écart nul et une comparaison vide de sens.
 *
 * En mode « événement », toute la qualité du système est dans la probabilité. On ne rend donc
 * aucun essai, et le rapport s'appuie exclusivement sur les métriques probabilistes.
 */
export function toTrial(itemId: string, category: string, r: Resolved): Trial | null {
  if (r.mode === "événement") return null;
  return { itemId, category, pass: r.correct };
}
