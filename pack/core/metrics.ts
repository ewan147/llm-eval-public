// Métriques probabilistes. Arithmétique pure, aucune dépendance, aucun état.
//
// ORIGINE : extraction/src/metrics.ts, lui-même porté de scripts/calibration.core.ts du projet
// d'origine. Les formules sont inchangées.

import type { Observation, Slice } from "./types.ts";

/** Bornage avant log() : une seule probabilité à 0 sur l'issue réalisée enverrait la log-loss à +∞. */
export const EPS = 1e-6;

/**
 * Score de Brier : erreur quadratique moyenne entre la confiance annoncée et l'issue (0 ou 1).
 *
 * PLUS BAS = MIEUX. 0 = perfection, 0,25 = ce qu'obtient qui répond toujours 50 %.
 *
 * Lu SEUL, il ne dit presque rien : sa valeur est d'abord celle de la difficulté du problème. Un
 * Brier de 0,16 est excellent sur une question à 50/50 et médiocre sur une question à 95/5. Il ne
 * devient interprétable que comparé à une référence, ou décomposé.
 */
export function brier(observations: Observation[]): number {
  if (observations.length === 0) return 0;
  return observations.reduce((a, o) => a + (o.prob - (o.outcome ? 1 : 0)) ** 2, 0) / observations.length;
}

/**
 * Log-loss : −log de la probabilité attribuée à ce qui s'est produit.
 *
 * PLUS BAS = MIEUX. Punit beaucoup plus durement que le Brier une certitude qui se trompe :
 * annoncer 1 % sur ce qui arrive coûte 4,6, contre 0,98 au Brier. À préférer quand une erreur
 * confiante est réellement plus grave qu'une erreur hésitante — c'est-à-dire dès qu'un système en
 * aval traite une confiance haute comme un fait.
 */
export function logLoss(observations: Observation[]): number {
  if (observations.length === 0) return 0;
  return (
    observations.reduce((a, o) => {
      const p = o.outcome ? o.prob : 1 - o.prob;
      return a + -Math.log(Math.max(p, EPS));
    }, 0) / observations.length
  );
}

/** Fréquence réellement observée. C'est la prédiction du système le plus bête possible. */
export function baseRate(observations: Observation[]): number {
  if (observations.length === 0) return 0;
  return observations.filter((o) => o.outcome).length / observations.length;
}

/**
 * Le Brier qu'obtiendrait un système annonçant toujours le taux de base.
 *
 * Le plancher gratuit. Un système qui ne le bat pas n'apporte AUCUNE information, quelle que soit
 * la sophistication de son calcul. Le battre est nécessaire ; ce n'est jamais suffisant.
 */
export function climatologyBrier(observations: Observation[]): number {
  const base = baseRate(observations);
  return base * (1 - base);
}

/** Résumé d'une tranche. `conclusive` est faux sous le seuil : affiché, mais sans conclusion. */
export function slice(label: string, observations: Observation[], minObs: number): Slice {
  const n = observations.length;
  const predicted = n ? observations.reduce((a, o) => a + o.prob, 0) / n : 0;
  const actual = n ? observations.filter((o) => o.outcome).length / n : 0;
  return { label, n, predicted, actual, bias: predicted - actual, conclusive: n >= minObs };
}

/** Coupures par défaut : les déciles. Assez fin pour voir une courbe, assez large pour la peupler. */
export const DECILES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** Coupures grossières, pour les petits échantillons. */
export const QUARTERS = [0, 0.4, 0.55, 0.7, 1];

/**
 * La courbe de calibration : un point par tranche de confiance annoncée.
 *
 * Se lit `predicted` en abscisse, `actual` en ordonnée. Un système parfait suit la diagonale.
 * Au-dessus = sous-confiance (on annonce moins que ce qui arrive) ; en dessous = surconfiance.
 */
export function calibrationCurve(
  observations: Observation[],
  bins: number[],
  minObs: number,
): Slice[] {
  const out: Slice[] = [];
  for (let i = 0; i < bins.length - 1; i++) {
    const lo = bins[i];
    const hi = bins[i + 1];
    const last = i === bins.length - 2;
    const inBin = observations.filter((o) => o.prob >= lo && (last ? o.prob <= hi : o.prob < hi));
    if (inBin.length === 0) continue;
    out.push(slice(`${lo.toFixed(2)}–${hi.toFixed(2)}`, inBin, minObs));
  }
  return out;
}

/**
 * Expected Calibration Error : moyenne pondérée des |annoncé − réalisé| par tranche.
 *
 * PLUS BAS = MIEUX. Contrairement au biais global, l'ECE ne se laisse PAS annuler par la
 * compensation entre une tranche surconfiante et une tranche sous-confiante. C'est pour ça qu'il
 * faut le lire à côté du biais et jamais à sa place.
 *
 * ATTENTION : l'ECE dépend du découpage. Des tranches larges le font baisser artificiellement.
 * Comparer deux ECE calculés sur des découpages différents n'a aucun sens.
 */
export function expectedCalibrationError(curve: Slice[]): number {
  const n = curve.reduce((a, s) => a + s.n, 0);
  if (n === 0) return 0;
  return curve.reduce((a, s) => a + (s.n / n) * Math.abs(s.bias), 0);
}

/** Le pire écart d'une tranche peuplée. Dit OÙ ça casse, là où l'ECE dit de combien en moyenne. */
export function maximumCalibrationError(curve: Slice[]): number {
  return curve.reduce((a, s) => Math.max(a, Math.abs(s.bias)), 0);
}

/**
 * Décomposition de Murphy : Brier = Fiabilité − Résolution + Incertitude.
 *
 * POURQUOI ELLE EST INDISPENSABLE — c'est LA leçon du projet d'origine.
 *
 * Mesurer la seule FIABILITÉ (« mes 70 % font-ils vraiment 70 % ? ») laisse passer un système
 * parfaitement calibré et parfaitement inutile : celui qui annonce toujours le taux de base a une
 * fiabilité impeccable et un pouvoir discriminant nul. Un tableau de bord qui n'affiche que la
 * calibration le déclare « bien calibré » avec satisfaction.
 *
 *   Fiabilité   — écart entre annoncé et réalisé, par tranche.        PLUS BAS = MIEUX.
 *   Résolution  — de combien on s'écarte du taux de base, à raison.   PLUS HAUT = MIEUX.
 *   Incertitude — le bruit irréductible du problème. Ni bon ni mauvais : la référence.
 *
 * RÉSERVE D'HONNÊTETÉ, conservée du projet d'origine : la décomposition exacte suppose des
 * probabilités discrètes. Le regroupement par tranche laisse de la variance intra-tranche, donc
 * les trois termes ne se recomposent pas au centième près. Les ordres de grandeur sont justes.
 */
export interface Decomposition {
  n: number;
  reliability: number;
  resolution: number;
  uncertainty: number;
  /** (résolution − fiabilité) / incertitude. Positif = mieux que le taux de base. */
  skill: number;
  /** Tranches réellement peuplées. Une seule ⇒ résolution nulle PAR CONSTRUCTION, pas par défaut. */
  binsUsed: number;
}

export function decompose(observations: Observation[], bins: number[]): Decomposition {
  const n = observations.length;
  if (n === 0) return { n: 0, reliability: 0, resolution: 0, uncertainty: 0, skill: 0, binsUsed: 0 };

  const base = baseRate(observations);
  const uncertainty = base * (1 - base);

  let reliability = 0;
  let resolution = 0;
  let binsUsed = 0;
  for (let i = 0; i < bins.length - 1; i++) {
    const lo = bins[i];
    const hi = bins[i + 1];
    const last = i === bins.length - 2;
    const bin = observations.filter((o) => o.prob >= lo && (last ? o.prob <= hi : o.prob < hi));
    if (bin.length === 0) continue;
    binsUsed++;
    const w = bin.length / n;
    const announced = bin.reduce((a, o) => a + o.prob, 0) / bin.length;
    const observed = bin.filter((o) => o.outcome).length / bin.length;
    reliability += w * (announced - observed) ** 2;
    resolution += w * (observed - base) ** 2;
  }

  const skill = uncertainty > 0 ? (resolution - reliability) / uncertainty : 0;
  return { n, reliability, resolution, uncertainty, skill, binsUsed };
}

/**
 * Le système fait-il seulement varier sa confiance ?
 *
 * Un système qui répond toujours le même chiffre a une résolution nulle par construction. Le
 * signaler évite de lire « aucun pouvoir discriminant » comme un défaut du système alors que
 * c'est un défaut de l'éventail de ses réponses — ou du découpage choisi.
 */
export function confidenceSpread(observations: Observation[]): { distinct: number; min: number; max: number } {
  if (observations.length === 0) return { distinct: 0, min: 0, max: 0 };
  const probs = observations.map((o) => o.prob);
  return {
    distinct: new Set(probs.map((p) => Math.round(p * 1000))).size,
    min: Math.min(...probs),
    max: Math.max(...probs),
  };
}
