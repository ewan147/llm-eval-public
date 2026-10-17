// Accord entre deux annotateurs — et l'évaluation du JUGE lui-même.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE TROU QUE CE MODULE COMBLE, ET IL EST GRAND.
//
// La majorité des systèmes de LLM d'aujourd'hui sont notés par un autre LLM. Presque personne ne
// mesure le juge. On mesure donc l'accord d'un système avec une opinion dont on ignore la valeur,
// et on appelle ça une évaluation.
//
// Deux questions, et le pack a déjà l'outil pour la seconde :
//
//   1. Le juge est-il d'accord avec l'humain, AU-DELÀ DU HASARD ? C'est le kappa de Cohen. Un
//      accord brut de 90 % sur des données à 90 % d'une seule classe vaut exactement zéro — c'est
//      le même piège que « battre le taux de base », transposé à l'accord.
//
//   2. Le juge mesure-t-il la qualité, ou l'accord avec le modèle qui a produit la réponse ?
//      C'est `anchoring()` de baseline.ts, appliqué au couple juge / générateur. Un juge qui
//      reproduit la confiance de son générateur ne note rien : il paraphrase.
//
// La deuxième question est celle que personne ne pose, et le module qui y répond existait déjà.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Une paire de jugements sur le même cas. */
export interface AgreementPair {
  itemId: string;
  /** Ce qu'a dit le juge automatique. */
  judge: string;
  /** Ce qu'a dit la référence humaine. */
  human: string;
}

export interface AgreementReport {
  n: number;
  /** Part des cas où les deux disent la même chose. Trompeur sur des classes déséquilibrées. */
  rawAgreement: number;
  /** Accord attendu par pur hasard, vu les distributions marginales des deux annotateurs. */
  expectedAgreement: number;
  /**
   * Kappa de Cohen : (observé − attendu) / (1 − attendu).
   *
   * 1 = accord parfait, 0 = pas mieux que le hasard, négatif = pire que le hasard. C'est le seul
   * des trois chiffres qui soit comparable d'un jeu de données à l'autre.
   */
  kappa: number;
  /** Le déséquilibre des classes, qui explique l'écart entre accord brut et kappa. */
  labelDistribution: Array<{ label: string; judgeShare: number; humanShare: number }>;
  /** Lecture conventionnelle du kappa, avec la réserve qui va avec. */
  interpretation: string;
}

/**
 * Accord juge / humain, corrigé du hasard.
 *
 * POURQUOI LE KAPPA ET PAS L'ACCORD BRUT. Sur un jeu où 90 % des réponses sont bonnes, un juge qui
 * répond systématiquement « bonne » obtient 90 % d'accord brut. Son kappa vaut 0 : il n'apporte
 * aucune information. C'est exactement la même erreur que de se féliciter de battre le taux de
 * base, et elle est encore plus fréquente ici parce que 90 % « sonne » comme un bon score.
 */
export function agreement(pairs: AgreementPair[]): AgreementReport {
  const n = pairs.length;
  if (n === 0) {
    return {
      n: 0,
      rawAgreement: 0,
      expectedAgreement: 0,
      kappa: 0,
      labelDistribution: [],
      interpretation: "Aucune paire : accord non mesurable.",
    };
  }

  const observed = pairs.filter((p) => p.judge === p.human).length / n;

  const labels = [...new Set(pairs.flatMap((p) => [p.judge, p.human]))];
  const judgeShare = new Map<string, number>();
  const humanShare = new Map<string, number>();
  for (const l of labels) {
    judgeShare.set(l, pairs.filter((p) => p.judge === l).length / n);
    humanShare.set(l, pairs.filter((p) => p.human === l).length / n);
  }

  // Accord attendu au hasard : produit des marges, sommé sur les classes.
  const expected = labels.reduce((a, l) => a + judgeShare.get(l)! * humanShare.get(l)!, 0);
  const kappa = expected < 1 ? (observed - expected) / (1 - expected) : 0;

  return {
    n,
    rawAgreement: observed,
    expectedAgreement: expected,
    kappa,
    labelDistribution: labels.map((label) => ({
      label,
      judgeShare: judgeShare.get(label)!,
      humanShare: humanShare.get(label)!,
    })),
    interpretation: interpretKappa(kappa, observed, expected, n),
  };
}

function interpretKappa(k: number, observed: number, expected: number, n: number): string {
  const gap = observed - expected;
  const base =
    `Accord brut ${(observed * 100).toFixed(1)} %, attendu par hasard `
    + `${(expected * 100).toFixed(1)} %, kappa ${k.toFixed(3)}.`;

  if (n < 30) {
    return `${base} Sous 30 cas, ce kappa n'est pas interprétable.`;
  }
  if (gap < 0.02) {
    return `${base} LE JUGE N'APPORTE RIEN : son accord avec l'humain s'explique presque `
      + "entièrement par le déséquilibre des classes. Un juge qui répondrait toujours la classe "
      + "majoritaire obtiendrait à peu près le même accord brut.";
  }
  if (k < 0.2) {
    return `${base} Accord négligeable une fois le hasard retiré. Ce juge ne peut pas servir de `
      + "vérité terrain.";
  }
  if (k < 0.4) {
    return `${base} Accord faible. Utilisable pour dégrossir, pas pour trancher.`;
  }
  if (k < 0.6) {
    return `${base} Accord modéré. Les conclusions tirées de ce juge doivent porter la même `
      + "réserve que lui.";
  }
  if (k < 0.8) {
    return `${base} Accord substantiel. Le juge est utilisable, en gardant à l'esprit qu'un `
      + "désaccord sur cinq subsiste.";
  }
  return `${base} Accord fort. Attention toutefois : un kappa élevé mesure la CONCORDANCE, pas la `
    + "justesse — si l'annotateur humain se trompe systématiquement, le juge le suit.";
}

/**
 * Matrice de confusion entre juge et humain.
 *
 * Dit AVEC QUOI le juge confond, là où le kappa dit seulement de combien il se trompe. C'est
 * souvent la sortie la plus actionnable : « le juge accepte les réponses fausses mais bien
 * formulées » est un diagnostic, « kappa 0,52 » n'en est pas un.
 */
export function confusion(pairs: AgreementPair[]): Array<{
  human: string;
  judge: string;
  n: number;
  share: number;
}> {
  const counts = new Map<string, number>();
  for (const p of pairs) {
    const key = `${p.human}␟${p.judge}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = pairs.length || 1;
  return [...counts.entries()]
    .map(([key, n]) => {
      const [human, judge] = key.split("␟");
      return { human, judge, n, share: n / total };
    })
    .sort((a, b) => b.n - a.n);
}

/**
 * Les désaccords les plus coûteux : le juge dit « bon » là où l'humain dit « mauvais ».
 *
 * Cette direction-là compte plus que l'autre. Un juge trop sévère fait perdre du temps ; un juge
 * trop indulgent laisse passer en production des réponses fausses, et personne ne s'en aperçoit
 * puisque le tableau de bord est vert.
 */
export function falseAccepts(
  pairs: AgreementPair[],
  positiveLabel: string,
): { n: number; rate: number; itemIds: string[] } {
  const bad = pairs.filter((p) => p.judge === positiveLabel && p.human !== positiveLabel);
  const humanNegatives = pairs.filter((p) => p.human !== positiveLabel).length;
  return {
    n: bad.length,
    rate: humanNegatives > 0 ? bad.length / humanNegatives : 0,
    itemIds: bad.map((p) => p.itemId),
  };
}
