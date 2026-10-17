// Ancrage en cascade : quel étage d'un pipeline apporte réellement quelque chose ?
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA QUESTION QUE PERSONNE NE POSE.
//
// `anchoring()` de baseline.ts compare deux séries d'estimations et dit si la seconde reproduit la
// première. Mais l'ancrage ne se contente pas d'exister entre deux points : il SE PROPAGE le long
// d'une chaîne.
//
//     récupérateur → générateur → juge
//
// Si le générateur recopie le document récupéré, et si le juge recopie la confiance du générateur,
// alors le pipeline entier ne fait que redire ce que le récupérateur avait trouvé — avec trois
// appels de modèle et trois factures. Chaque étage paraît utile isolément ; la chaîne, elle,
// n'ajoute rien après le premier étage.
//
// C'est la version en cascade de « indiscernable de sa référence », et c'est la question centrale
// de tout système agentique multi-étages. Comme `anchoring()`, elle se répond SANS AUCUNE VÉRITÉ
// TERRAIN : il suffit d'avoir, pour chaque cas, ce que chaque étage a produit.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { anchoring, type AnchoringReport } from "./baseline.ts";

/** Ce qu'un étage du pipeline a produit sur chaque cas, dans le même ordre partout. */
export interface Stage {
  name: string;
  /**
   * Une valeur par cas : confiance, score, probabilité. Ce qui compte est que la série soit
   * comparable d'un étage à l'autre — pas son unité.
   */
  values: number[];
  /** Coût relatif de cet étage, si connu. Sert à chiffrer ce qu'un étage inutile coûte. */
  cost?: number;
}

/** Le lien entre deux étages consécutifs. */
export interface StageLink {
  from: string;
  to: string;
  anchoring: AnchoringReport;
  /** Vrai si `to` reproduit `from` au point de ne rien ajouter. */
  redundant: boolean;
}

export interface PipelineReport {
  n: number;
  stages: string[];
  /** Un lien par paire consécutive. */
  links: StageLink[];
  /**
   * Les étages dont la sortie est indiscernable de celle de l'étage précédent.
   *
   * Ce sont les candidats à la suppression : pas la preuve qu'ils sont inutiles, mais la preuve
   * qu'ils n'ont rien changé sur ces cas-là.
   */
  redundantStages: string[];
  /** Part du coût total portée par les étages redondants, si les coûts sont fournis. */
  wastedCostShare: number | null;
  verdict: string;
}

/**
 * Mesure la propagation de l'ancrage le long d'une chaîne.
 *
 * Prend les étages DANS L'ORDRE du pipeline. Chaque étage est comparé au précédent, jamais au
 * premier : c'est la dépendance locale qui dit ce qu'un étage ajoute, et une chaîne peut dériver
 * loin de son point de départ par petits pas tout en n'ajoutant rien à chaque pas.
 *
 * RÉSERVE : « n'a rien changé sur ces cas » n'est pas « ne sert à rien ». Un étage de sécurité qui
 * ne se déclenche jamais sur un jeu de test propre paraîtra redondant, et il ne l'est pas. Le
 * rapport signale des candidats, il ne prononce pas de suppression.
 */
export function pipelineAnchoring(stages: Stage[]): PipelineReport {
  if (stages.length < 2) {
    return {
      n: stages[0]?.values.length ?? 0,
      stages: stages.map((s) => s.name),
      links: [],
      redundantStages: [],
      wastedCostShare: null,
      verdict:
        "Il faut au moins deux étages pour mesurer une propagation. Avec un seul, il n'y a rien à "
        + "comparer.",
    };
  }

  const n = Math.min(...stages.map((s) => s.values.length));
  if (n === 0) {
    return {
      n: 0,
      stages: stages.map((s) => s.name),
      links: [],
      redundantStages: [],
      wastedCostShare: null,
      verdict: "Aucune valeur : rien à comparer.",
    };
  }

  const links: StageLink[] = [];
  for (let i = 1; i < stages.length; i++) {
    const from = stages[i - 1];
    const to = stages[i];
    const pairs = Array.from({ length: n }, (_, j) => ({
      prob: to.values[j],
      reference: from.values[j],
    }));
    const a = anchoring(pairs);
    links.push({ from: from.name, to: to.name, anchoring: a, redundant: a.anchored });
  }

  const redundantStages = links.filter((l) => l.redundant).map((l) => l.to);

  let wastedCostShare: number | null = null;
  const totalCost = stages.reduce((a, s) => a + (s.cost ?? 0), 0);
  if (totalCost > 0) {
    const wasted = stages
      .filter((s) => redundantStages.includes(s.name))
      .reduce((a, s) => a + (s.cost ?? 0), 0);
    wastedCostShare = wasted / totalCost;
  }

  return {
    n,
    stages: stages.map((s) => s.name),
    links,
    redundantStages,
    wastedCostShare,
    verdict: verdictFor(links, redundantStages, wastedCostShare, n),
  };
}

function verdictFor(
  links: StageLink[],
  redundant: string[],
  wasted: number | null,
  n: number,
): string {
  if (redundant.length === 0) {
    return `Chaque étage modifie sensiblement la sortie du précédent, sur ${n} cas. Aucun étage `
      + "n'est un simple relais. La chaîne n'est pas nécessairement bonne — mais elle n'est pas "
      + "redondante.";
  }

  const chain = links.filter((l) => l.redundant).map((l) => `${l.from} → ${l.to}`);
  const cost =
    wasted !== null
      ? ` Ces étages représentent ${(wasted * 100).toFixed(0)} % du coût déclaré du pipeline.`
      : "";

  if (redundant.length === links.length) {
    return `TOUTE LA CHAÎNE EST UN RELAIS : chaque étage reproduit le précédent (${chain.join(", ")}). `
      + `Sur ces ${n} cas, le pipeline entier ne fait que redire ce que son premier étage avait `
      + `produit.${cost} Mesurer le premier étage seul avant d'ajouter quoi que ce soit.`;
  }

  return `${redundant.length} étage(s) sur ${links.length} reproduisent leur prédécesseur `
    + `(${chain.join(", ")}), sur ${n} cas.${cost} Ce sont des candidats à la suppression : leur `
    + "retirer ne devrait rien changer, et c'est une hypothèse testable en une exécution.";
}

/**
 * Le test qui tranche : retirer l'étage et remesurer.
 *
 * L'ancrage désigne un suspect ; seule cette comparaison le condamne. On évalue le pipeline
 * complet contre le pipeline amputé, sur les mêmes cas — c'est-à-dire exactement la comparaison
 * contrastive que `compareToBaseline` sait faire. Ce helper ne calcule rien : il formule
 * l'expérience à mener, parce que la formuler est ce qui manquait.
 */
export function ablationInstruction(report: PipelineReport): string {
  if (report.redundantStages.length === 0) {
    return "Aucune ablation suggérée : aucun étage ne reproduit son prédécesseur.";
  }
  const s = report.redundantStages[0];
  return `Écrire un adaptateur dont \`predict\` est le pipeline complet et \`baseline\` le pipeline `
    + `SANS l'étage « ${s} », puis lancer \`eval-pack run\`. Un verdict ÉQUIVALENT sur un échantillon `
    + `suffisant est la démonstration que cet étage peut partir. Un verdict INDÉCIDABLE signifie `
    + "qu'il faut plus de cas — pas que l'étage est utile.";
}
