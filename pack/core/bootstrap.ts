// Intervalles de confiance par bootstrap.
//
// POURQUOI CE MODULE EXISTE. Un chiffre sans intervalle est un chiffre qui ment — pas par malice,
// par omission. « Brier 0,158 contre 0,157 » se lit comme une différence tant qu'on n'a pas écrit
// « ± 0,022 ». Le projet d'origine a passé six semaines à raffiner un écart plus petit que son
// propre bruit d'échantillonnage.
//
// Le bootstrap est utilisé plutôt qu'une formule fermée parce qu'il s'applique TELLE QUELLE à
// n'importe quelle métrique — Brier, ECE, résolution, écart de taux de réussite — sans avoir à
// dériver une variance différente pour chacune. Ce qu'il coûte en temps, il le rend en généralité.
//
// Arithmétique pure, aucune dépendance.

import type { Interval } from "./types.ts";

/**
 * Générateur congruentiel linéaire, graine explicite.
 *
 * Pseudo-aléatoire et REPRODUCTIBLE : deux exécutions du pack sur les mêmes données rendent les
 * mêmes intervalles. Un intervalle de confiance qui bouge d'une exécution à l'autre est
 * indéfendable devant un client.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Intervalle de confiance percentile d'une métrique quelconque.
 *
 * Rééchantillonne les observations AVEC REMISE, recalcule la métrique, et prend les percentiles.
 *
 * RÉSERVE, à énoncer plutôt qu'à cacher : la méthode percentile est la plus simple des variantes
 * de bootstrap. Elle est légèrement biaisée sur des métriques très asymétriques et sur de très
 * petits échantillons — c'est aussi pour ça que le pack refuse de conclure sous le seuil
 * d'observations, plutôt que de rendre un intervalle rassurant.
 */
export function bootstrapCI<T>(
  data: T[],
  metric: (sample: T[]) => number,
  options: { samples?: number; level?: number; seed?: number } = {},
): Interval {
  const level = options.level ?? 0.95;
  const samples = options.samples ?? 2000;
  const n = data.length;
  const value = n > 0 ? metric(data) : 0;

  if (n < 2) {
    return { value, low: Number.NaN, high: Number.NaN, level, method: "bootstrap (impossible, n<2)" };
  }

  const rng = makeRng(options.seed ?? 20260905);
  const stats = new Array<number>(samples);
  const buffer = new Array<T>(n);
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < n; i++) buffer[i] = data[Math.floor(rng() * n)];
    stats[s] = metric(buffer);
  }
  stats.sort((a, b) => a - b);

  const alpha = (1 - level) / 2;
  return {
    value,
    low: percentile(stats, alpha),
    high: percentile(stats, 1 - alpha),
    level,
    method: "bootstrap",
  };
}

/**
 * Intervalle de confiance sur la DIFFÉRENCE entre deux systèmes, en rééchantillonnant les
 * mêmes cas des deux côtés.
 *
 * C'est le point critique, et le plus souvent raté : il faut rééchantillonner les INDICES, pas
 * chaque série séparément. Deux bootstraps indépendants cassent l'appariement, gonflent la
 * variance de la différence, et font conclure « indiscernable » sur des systèmes qui diffèrent
 * réellement — ou l'inverse.
 */
export function pairedBootstrapCI<T>(
  pairs: T[],
  difference: (sample: T[]) => number,
  options: { samples?: number; level?: number; seed?: number } = {},
): Interval {
  return bootstrapCI(pairs, difference, options);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** L'intervalle contient-il zéro ? Si oui, aucune différence n'est démontrée. */
export function containsZero(i: Interval): boolean {
  if (Number.isNaN(i.low) || Number.isNaN(i.high)) return true;
  return i.low <= 0 && i.high >= 0;
}
