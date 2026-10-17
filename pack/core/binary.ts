// Métriques binaires : réussite / échec, sans probabilité.
//
// C'est le cas de la plupart des agents. « La tâche a-t-elle été accomplie ? » n'a pas de nuance,
// et un taux de réussite brut n'a pas d'intervalle — d'où ce module.
//
// Arithmétique pure, aucune dépendance.

import type { Interval, Trial } from "./types.ts";

/** Taux de réussite brut. Sans intervalle, ce chiffre ne veut rien dire : voir `wilson`. */
export function successRate(trials: Trial[]): number {
  if (trials.length === 0) return 0;
  return trials.filter((t) => t.pass).length / trials.length;
}

/**
 * Intervalle de Wilson sur une proportion.
 *
 * POURQUOI WILSON ET PAS L'INTERVALLE NORMAL. Sur 20 essais tous réussis, l'intervalle normal
 * donne [100 %, 100 %] — il affirme la perfection à partir de 20 cas. Wilson donne [83,9 %, 100 %],
 * ce qui est la vérité : 20 réussites sur 20 sont compatibles avec un système qui échoue une fois
 * sur six. C'est exactement l'erreur que commet un tableau de bord d'agent en début de projet.
 *
 * Reste correct à n petit, à taux 0 % et à taux 100 %.
 */
export function wilson(successes: number, n: number, level = 0.95): Interval {
  if (n === 0) return { value: 0, low: 0, high: 1, level, method: "wilson" };
  const z = zFor(level);
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return {
    value: p,
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
    level,
    method: "wilson",
  };
}

/** Quantile normal pour les niveaux usuels. Table plutôt qu'inversion : c'est plus lisible. */
export function zFor(level: number): number {
  if (level >= 0.99) return 2.5758293035489004;
  if (level >= 0.98) return 2.3263478740408408;
  if (level >= 0.95) return 1.959963984540054;
  if (level >= 0.9) return 1.6448536269514722;
  return 1.959963984540054;
}

/** Le résultat d'une comparaison appariée binaire. */
export interface McNemarResult {
  n: number;
  /** Cas où le système réussit et la référence échoue. */
  systemOnly: number;
  /** Cas où la référence réussit et le système échoue. */
  baselineOnly: number;
  /** Cas où les deux réussissent. */
  bothPass: number;
  /** Cas où les deux échouent. */
  bothFail: number;
  /** Écart de taux de réussite, système − référence. */
  difference: number;
  /** p-value bilatérale du test de McNemar. */
  pValue: number;
  /** Méthode : "exact" (binomiale) ou "chi2" (approximation avec correction de continuité). */
  method: string;
  /** Vrai si p < 1 − level ET si l'échantillon discordant est suffisant. */
  significant: boolean;
}

/**
 * Test de McNemar : le système et la référence diffèrent-ils vraiment ?
 *
 * POURQUOI APPARIÉ. Comparer deux taux de réussite globaux revient à comparer deux moyennes de
 * populations différentes : l'écart réel se noie dans la variance entre cas. McNemar ne regarde
 * QUE les cas où les deux systèmes divergent — les cas où les deux réussissent ou les deux
 * échouent ne portent aucune information sur leur différence.
 *
 * Conséquence pratique, souvent surprenante : deux systèmes à 80 % et 84 % de réussite peuvent
 * être indiscernables si leurs erreurs sont les mêmes, et nettement différents si elles ne le sont
 * pas. Seul l'appariement le dit.
 *
 * `minDiscordant` : sous ce nombre de cas discordants, aucune conclusion n'est possible même si la
 * p-value est basse — c'est le garde-fou de taille d'échantillon appliqué au bon dénominateur.
 */
export function mcNemar(
  system: Trial[],
  baseline: Trial[],
  level = 0.95,
  minDiscordant = 10,
): McNemarResult {
  const byId = new Map(baseline.map((t) => [t.itemId, t]));
  let systemOnly = 0;
  let baselineOnly = 0;
  let bothPass = 0;
  let bothFail = 0;
  let n = 0;

  for (const s of system) {
    const b = byId.get(s.itemId);
    if (!b) continue;
    n++;
    if (s.pass && !b.pass) systemOnly++;
    else if (!s.pass && b.pass) baselineOnly++;
    else if (s.pass && b.pass) bothPass++;
    else bothFail++;
  }

  const discordant = systemOnly + baselineOnly;
  const difference = n > 0 ? (systemOnly - baselineOnly) / n : 0;

  let pValue = 1;
  let method = "exact";
  if (discordant === 0) {
    pValue = 1;
    method = "aucun cas discordant";
  } else if (discordant < 60) {
    // Binomiale exacte : sous H0, chaque cas discordant tombe d'un côté ou de l'autre à pile ou face.
    pValue = Math.min(1, 2 * binomialTail(Math.min(systemOnly, baselineOnly), discordant));
  } else {
    // Chi-2 à 1 degré de liberté avec correction de continuité, via la survie normale.
    const chi2 = (Math.abs(systemOnly - baselineOnly) - 1) ** 2 / discordant;
    pValue = 2 * (1 - normalCdf(Math.sqrt(Math.max(chi2, 0))));
    method = "chi2";
  }

  return {
    n,
    systemOnly,
    baselineOnly,
    bothPass,
    bothFail,
    difference,
    pValue,
    method,
    significant: discordant >= minDiscordant && pValue < 1 - level,
  };
}

/** P(X ≤ k) pour X ~ Binomiale(n, 1/2). Calculé en log pour ne pas déborder. */
function binomialTail(k: number, n: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, sum);
}

function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** Approximation de Lanczos. Suffisante bien au-delà des effectifs qu'on rencontre ici. */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) a += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Fonction de répartition normale centrée réduite, via erf d'Abramowitz-Stegun. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Taux de réussite par segment, avec intervalle de Wilson et marqueur de conclusivité.
 *
 * Un segment sous le seuil est RENDU quand même — il doit apparaître dans le rapport, nommé,
 * comme écarté. Le taire reviendrait à laisser croire qu'il n'existe pas.
 */
export function successByCategory(
  trials: Trial[],
  minObs: number,
  level = 0.95,
): Array<{ category: string; n: number; rate: Interval; conclusive: boolean }> {
  const groups = new Map<string, Trial[]>();
  for (const t of trials) {
    const list = groups.get(t.category);
    if (list) list.push(t);
    else groups.set(t.category, [t]);
  }
  return [...groups.entries()]
    .map(([category, list]) => ({
      category,
      n: list.length,
      rate: wilson(list.filter((t) => t.pass).length, list.length, level),
      conclusive: list.length >= minObs,
    }))
    // Les segments CONCLUANTS d'abord, du pire au meilleur ; les non concluants ensuite.
    // Laisser un segment à n = 1 et 0 % de réussite ouvrir le classement ferait lire un tirage
    // comme le pire défaut du système.
    .sort(
      (a, b) =>
        Number(b.conclusive) - Number(a.conclusive) || a.rate.value - b.rate.value,
    );
}
