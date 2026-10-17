// Métriques de rang : hit@k, rappel@k, MRR, NDCG@k.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI hit@k NE SUFFIT PAS.
//
// « Le bon document est-il dans les 5 premiers ? » est une question binaire, et elle jette la
// moitié de ce qu'on sait : elle ne distingue pas un système qui place la bonne réponse en
// première position d'un système qui la place en cinquième. Or dans un pipeline RAG, cette
// différence est décisive — le générateur ne lit pas les cinq documents avec la même attention, et
// un contexte où la bonne réponse arrive en cinquième est souvent un contexte où elle est noyée.
//
//   hit@k    — binaire : au moins un document pertinent dans les k premiers.
//   rappel@k — quelle PART des documents pertinents a été retrouvée.
//   MRR      — 1/rang du premier document pertinent. Récompense la première position.
//   NDCG@k   — pondère chaque position par 1/log₂(rang+1), et normalise par le classement idéal.
//
// Aucune ne remplace les autres. Un système peut avoir un hit@5 parfait et un MRR médiocre : il
// trouve toujours, mais il classe mal.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Un cas de récupération : ce que le système a classé, ce qui était réellement pertinent. */
export interface RankedCase {
  itemId: string;
  category: string;
  /** Candidats ordonnés du meilleur au moins bon, déjà normalisés. */
  ranking: string[];
  /** Identifiants pertinents, déjà normalisés. */
  relevant: Set<string>;
}

/** Au moins un document pertinent dans les k premiers. 0 ou 1. */
export function hitAtK(c: RankedCase, k: number): number {
  return c.ranking.slice(0, k).some((id) => c.relevant.has(id)) ? 1 : 0;
}

/**
 * Part des documents pertinents retrouvés dans les k premiers.
 *
 * Vaut hit@k quand il n'y a qu'un seul document pertinent — c'est le cas courant, et c'est
 * pourquoi on ne s'aperçoit du besoin que sur les questions à plusieurs bonnes réponses.
 */
export function recallAtK(c: RankedCase, k: number): number {
  if (c.relevant.size === 0) return 0;
  const found = c.ranking.slice(0, k).filter((id) => c.relevant.has(id)).length;
  return found / c.relevant.size;
}

/**
 * Inverse du rang du PREMIER document pertinent. 1 s'il est en tête, 0,5 en deuxième, 0 s'il est
 * absent des k premiers.
 *
 * C'est la métrique à regarder quand un seul document sert réellement — un assistant qui cite une
 * source, une recherche « je me sens chanceux ».
 */
export function reciprocalRank(c: RankedCase, k: number): number {
  const top = c.ranking.slice(0, k);
  for (let i = 0; i < top.length; i++) if (c.relevant.has(top[i])) return 1 / (i + 1);
  return 0;
}

/**
 * NDCG@k avec pertinence binaire.
 *
 * Gain cumulé actualisé : chaque document pertinent rapporte 1/log₂(rang+1), et on divise par ce
 * qu'aurait rapporté le classement idéal. Vaut 1 quand tous les pertinents sont en tête, 0 quand
 * aucun n'apparaît.
 *
 * L'actualisation logarithmique est un choix, pas une vérité : elle suppose que l'attention décroît
 * lentement avec le rang. Sur un pipeline qui ne lit vraiment que le premier document, le MRR
 * décrit mieux la réalité.
 */
export function ndcgAtK(c: RankedCase, k: number): number {
  const top = c.ranking.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < top.length; i++) if (c.relevant.has(top[i])) dcg += 1 / Math.log2(i + 2);

  const ideal = Math.min(c.relevant.size, k);
  if (ideal === 0) return 0;
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

/** Les quatre métriques d'un lot de cas, moyennées. */
export interface RankingScores {
  n: number;
  k: number;
  hitAtK: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
}

export function rankingScores(cases: RankedCase[], k: number): RankingScores {
  const n = cases.length;
  if (n === 0) return { n: 0, k, hitAtK: 0, recallAtK: 0, mrr: 0, ndcgAtK: 0 };
  const avg = (f: (c: RankedCase) => number) => cases.reduce((a, c) => a + f(c), 0) / n;
  return {
    n,
    k,
    hitAtK: avg((c) => hitAtK(c, k)),
    recallAtK: avg((c) => recallAtK(c, k)),
    mrr: avg((c) => reciprocalRank(c, k)),
    ndcgAtK: avg((c) => ndcgAtK(c, k)),
  };
}

/**
 * Le diagnostic que hit@k seul ne peut pas donner.
 *
 * Un hit@k élevé avec un MRR bas décrit un système qui trouve mais classe mal — et c'est
 * réparable sans toucher à la récupération, en ajoutant un reclassement. Le dire évite de
 * reconstruire un index quand il suffisait de trier.
 */
export function rankingDiagnosis(s: RankingScores): string {
  if (s.n === 0) return "Aucun cas de récupération.";
  if (s.hitAtK < 0.5) {
    return `Le document pertinent est absent des ${s.k} premiers dans `
      + `${((1 - s.hitAtK) * 100).toFixed(0)} % des cas : c'est la RÉCUPÉRATION qui est en cause, `
      + "pas le classement. Augmenter k n'y changera pas grand-chose.";
  }
  // Un hit@k proche de 1 avec un MRR faible : la bonne réponse est là, mais loin.
  if (s.hitAtK > 0.85 && s.mrr < 0.6) {
    return `Le document pertinent est presque toujours dans les ${s.k} premiers `
      + `(${(s.hitAtK * 100).toFixed(0)} %), mais rarement en tête (MRR ${s.mrr.toFixed(2)}). `
      + "Le défaut est dans le CLASSEMENT, pas dans la récupération : un reclassement des candidats "
      + "déjà trouvés coûterait moins cher qu'un nouvel index.";
  }
  if (s.mrr > 0.85) {
    return `Le document pertinent est le plus souvent en première position (MRR `
      + `${s.mrr.toFixed(2)}). Le classement n'est pas le goulot d'étranglement.`;
  }
  return `hit@${s.k} ${(s.hitAtK * 100).toFixed(0)} %, MRR ${s.mrr.toFixed(2)}, `
    + `NDCG@${s.k} ${s.ndcgAtK.toFixed(2)} : récupération et classement sont tous deux perfectibles.`;
}
