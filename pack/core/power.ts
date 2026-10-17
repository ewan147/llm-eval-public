// Puissance et taille d'échantillon : répondre AVANT de mesurer, pas après.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE MANQUE QUE CE MODULE COMBLE.
//
// Sans lui, le pack dit « INDÉCIDABLE : 40 cas, seuil de 100 » et laisse l'utilisateur devant un
// constat frustrant. Il sait qu'il n'en a pas assez ; il ne sait pas combien il lui en faut.
//
// C'est une lacune sérieuse, parce que la réponse dépend entièrement de ce qu'on cherche à
// détecter : distinguer 80 % de 85 % demande des centaines de cas, distinguer 80 % de 40 % en
// demande quelques dizaines. Répondre « il t'en faut 320 » transforme un refus en instruction.
//
// Toute l'information nécessaire est déjà mesurée par le pack — variance, taux de base, taux de
// cas discordants. Ce module ne fait qu'inverser les formules.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// RÉSERVE GÉNÉRALE, valable pour tout ce fichier : ce sont des formules de PLANIFICATION. Elles
// supposent que l'effet observé sur l'échantillon courant est l'effet réel, ce qui est faux — un
// effet mesuré sur peu de cas est lui-même très incertain. Les tailles rendues sont donc des
// ordres de grandeur, pas des garanties. Elles servent à choisir entre « ajouter 50 cas » et
// « ajouter 5 000 cas », pas à décider d'un budget au cas près.

/** Quantile normal, pour les niveaux usuels. Table plutôt qu'inversion : plus lisible, exact. */
export function z(p: number): number {
  if (p >= 0.995) return 2.5758293035489004;
  if (p >= 0.99) return 2.3263478740408408;
  if (p >= 0.975) return 1.959963984540054;
  if (p >= 0.95) return 1.6448536269514722;
  if (p >= 0.9) return 1.2815515655446004;
  if (p >= 0.8) return 0.8416212335729143;
  return 0.6744897501960817;
}

export interface SampleSizePlan {
  /** Nombre de cas nécessaires, arrondi au supérieur. */
  required: number;
  /** Cas déjà disponibles. */
  available: number;
  /** Cas à ajouter. 0 si l'échantillon suffit déjà. */
  missing: number;
  /** L'écart qu'on cherche à détecter, dans l'unité de la métrique. */
  effect: number;
  power: number;
  level: number;
  /** Ce qui a été supposé pour arriver là. À afficher avec le chiffre, jamais séparément. */
  assumption: string;
}

/**
 * Combien de cas pour détecter une différence de MOYENNE (Brier, log-loss, tout score continu).
 *
 * Formule classique de l'échantillon apparié : n = (z_{1−α/2} + z_{1−β})² · σ² / δ².
 *
 * `sd` est l'écart-type des DIFFÉRENCES APPARIÉES, pas des scores eux-mêmes. C'est ce qui rend le
 * chiffre utilisable : deux systèmes très corrélés ont une différence de faible variance, donc
 * demandent beaucoup moins de cas que ne le suggérerait la dispersion de leurs scores.
 */
export function requiredForMeanDifference(args: {
  sd: number;
  effect: number;
  available: number;
  power?: number;
  level?: number;
}): SampleSizePlan {
  const power = args.power ?? 0.8;
  const level = args.level ?? 0.95;
  const delta = Math.abs(args.effect);

  if (!(delta > 0) || !Number.isFinite(args.sd) || args.sd <= 0) {
    return {
      required: Number.POSITIVE_INFINITY,
      available: args.available,
      missing: Number.POSITIVE_INFINITY,
      effect: delta,
      power,
      level,
      assumption:
        "Écart observé nul ou variance nulle : aucune taille d'échantillon ne permet de détecter "
        + "un effet inexistant. Décider quel écart MINIMAL vaudrait la peine d'être détecté, et "
        + "relancer le calcul avec cette valeur.",
    };
  }

  const n = Math.ceil(((z((1 + level) / 2) + z(power)) ** 2 * args.sd ** 2) / delta ** 2);
  return {
    required: n,
    available: args.available,
    missing: Math.max(0, n - args.available),
    effect: delta,
    power,
    level,
    assumption:
      `Pour détecter un écart de ${delta.toPrecision(3)} avec ${(power * 100).toFixed(0)} % de `
      + `chances, au seuil de ${((1 - level) * 100).toFixed(0)} %, en supposant l'écart-type des `
      + `différences appariées égal à ${args.sd.toPrecision(3)} (valeur observée sur l'échantillon `
      + "courant).",
  };
}

/**
 * Combien de cas pour détecter une différence de TAUX DE RÉUSSITE apparié (McNemar).
 *
 * Formule de Connor (1987), qui ne dépend que des cas DISCORDANTS — les seuls porteurs
 * d'information dans un test apparié :
 *
 *     n = [z_{1−α/2}·√π_d + z_{1−β}·√(π_d − π_diff²)]² / π_diff²
 *
 * où π_d est la proportion de cas discordants et π_diff l'écart de taux de réussite.
 *
 * Conséquence contre-intuitive mais juste : deux systèmes qui se trompent sur LES MÊMES cas ont
 * très peu de discordants, donc demandent énormément de cas pour être distingués — même si leurs
 * taux globaux diffèrent. C'est exactement ce que McNemar mesure.
 */
export function requiredForPairedProportion(args: {
  discordantRate: number;
  difference: number;
  available: number;
  power?: number;
  level?: number;
}): SampleSizePlan {
  const power = args.power ?? 0.8;
  const level = args.level ?? 0.95;
  const piD = args.discordantRate;
  const piDiff = Math.abs(args.difference);

  if (!(piDiff > 0) || !(piD > 0) || piDiff > piD) {
    return {
      required: Number.POSITIVE_INFINITY,
      available: args.available,
      missing: Number.POSITIVE_INFINITY,
      effect: piDiff,
      power,
      level,
      assumption:
        piD <= 0
          ? "Aucun cas discordant : les deux systèmes se trompent exactement sur les mêmes cas. "
            + "Aucun nombre de cas supplémentaires ne les distinguera — ils font la même chose. "
            + "Chercher une référence réellement différente."
          : "Écart observé nul : décider quel écart MINIMAL vaudrait la peine d'être détecté, et "
            + "relancer le calcul avec cette valeur.",
    };
  }

  const a = z((1 + level) / 2) * Math.sqrt(piD);
  const b = z(power) * Math.sqrt(piD - piDiff ** 2);
  const n = Math.ceil((a + b) ** 2 / piDiff ** 2);

  return {
    required: n,
    available: args.available,
    missing: Math.max(0, n - args.available),
    effect: piDiff,
    power,
    level,
    assumption:
      `Pour détecter un écart de ${(piDiff * 100).toFixed(1)} points de taux de réussite avec `
      + `${(power * 100).toFixed(0)} % de chances, au seuil de ${((1 - level) * 100).toFixed(0)} %, `
      + `en supposant ${(piD * 100).toFixed(1)} % de cas discordants (valeur observée). Ce sont les `
      + "cas discordants qui portent l'information : deux systèmes qui échouent sur les mêmes cas "
      + "restent indistinguables quel que soit le volume.",
  };
}

/**
 * La puissance réellement atteinte par l'échantillon dont on dispose.
 *
 * Répond à l'autre moitié de la question : « avec mes 40 cas, quelle chance avais-je de voir un
 * écart de 5 points s'il existait ? » Une réponse de 12 % explique un INDÉCIDABLE bien mieux
 * qu'un seuil.
 */
export function achievedPower(args: {
  n: number;
  sd: number;
  effect: number;
  level?: number;
}): number {
  const level = args.level ?? 0.95;
  if (args.n <= 1 || args.sd <= 0 || !(Math.abs(args.effect) > 0)) return 0;
  const se = args.sd / Math.sqrt(args.n);
  const zStat = Math.abs(args.effect) / se - z((1 + level) / 2);
  return clamp(normalCdf(zStat), 0, 1);
}

/** Fonction de répartition normale centrée réduite. */
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Le plan rendu en une phrase actionnable, ou l'explication de pourquoi il n'y en a pas. */
export function planStatement(plan: SampleSizePlan): string {
  if (!Number.isFinite(plan.required)) return plan.assumption;
  if (plan.missing === 0) {
    return `L'échantillon suffit : ${plan.available} cas pour ${plan.required} requis. `
      + `Une différence de cette taille aurait été détectée. ${plan.assumption}`;
  }
  return `Il faut environ ${plan.required} cas pour trancher, contre ${plan.available} disponibles `
    + `— soit ${plan.missing} à ajouter. ${plan.assumption}`;
}
