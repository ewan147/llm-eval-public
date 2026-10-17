// ADAPTATEUR 5 — évaluer le JUGE lui-même.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE CAS QUE PRESQUE PERSONNE NE MESURE.
//
// La plupart des systèmes de LLM d'aujourd'hui sont notés par un autre LLM. On mesure donc
// l'accord d'un système avec une opinion dont on ignore la valeur, et on appelle ça une
// évaluation. Le juge est le maillon le moins vérifié de toute la chaîne, alors que c'est lui qui
// produit tous les chiffres.
//
// Ici, le juge devient le système évalué :
//
//   predict  → ce que dit le juge automatique
//   truth    → ce qu'a dit l'annotateur humain
//   baseline → un juge trivial : « accepte tout ce qui est bien formulé »
//
// Aucune méthode nouvelle n'a été nécessaire. Le contrat à quatre membres suffisait déjà — il
// manquait seulement de s'en servir dans ce sens-là.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE LA BASELINE RÉVÈLE ICI, ET POURQUOI ELLE EST CHOISIE AINSI.
//
// « Accepte tout ce qui est bien formulé » est un juge délibérément stupide : il ne regarde que la
// forme, jamais le fond. S'il obtient un accord comparable au vrai juge, cela veut dire que le
// vrai juge note surtout la fluidité — ce qui est le mode d'échec le mieux documenté des juges
// LLM, et le plus coûteux, parce qu'il laisse passer en production des réponses fausses et bien
// écrites.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { agreement, falseAccepts, type AgreementPair } from "../core/agreement.ts";
import type { Adapter, Outcome, Prediction } from "../core/types.ts";

export interface Answer {
  id: string;
  question: string;
  /** La réponse produite par le système en amont, celle que le juge doit noter. */
  answer: string;
  /** Le verdict de l'annotateur humain : la référence. */
  human: "correcte" | "incorrecte";
  /** La réponse est-elle bien tournée, indépendamment de sa justesse ? */
  fluent: boolean;
  /** Confiance que le générateur avait dans SA propre réponse. Sert à mesurer l'ancrage du juge. */
  generatorConfidence: number;
  topic: "factuel" | "calcul" | "raisonnement";
}

/**
 * Le jeu d'évaluation du juge.
 *
 * Construit sur un déséquilibre réaliste — 68 % de réponses correctes — parce que c'est ce
 * déséquilibre qui rend l'accord brut trompeur et le kappa indispensable. Et il contient
 * délibérément des réponses FAUSSES ET BIEN TOURNÉES : ce sont elles qui séparent un juge qui
 * évalue le fond d'un juge qui évalue la forme.
 */
export const ANSWERS: Answer[] = [
  ["a01", "Capitale de l'Australie ?", "Canberra.", "correcte", true, 0.92, "factuel"],
  ["a02", "Capitale de l'Australie ?", "Sydney, la plus grande ville du pays.", "incorrecte", true, 0.88, "factuel"],
  ["a03", "12 × 14 ?", "168.", "correcte", true, 0.95, "calcul"],
  ["a04", "12 × 14 ?", "148, en posant la multiplication.", "incorrecte", true, 0.9, "calcul"],
  ["a05", "Auteur de Madame Bovary ?", "Gustave Flaubert.", "correcte", true, 0.94, "factuel"],
  ["a06", "Racine carrée de 144 ?", "12.", "correcte", true, 0.96, "calcul"],
  ["a07", "Racine carrée de 169 ?", "13.", "correcte", true, 0.93, "calcul"],
  ["a08", "Année de la chute du mur de Berlin ?", "1989.", "correcte", true, 0.95, "factuel"],
  ["a09", "Année de la chute du mur de Berlin ?", "1991, à la fin de l'URSS.", "incorrecte", true, 0.85, "factuel"],
  ["a10", "Si A > B et B > C, que dire de A et C ?", "A > C, par transitivité.", "correcte", true, 0.91, "raisonnement"],
  ["a11", "Si tous les X sont Y, un Y est-il un X ?", "Oui, nécessairement.", "incorrecte", true, 0.82, "raisonnement"],
  ["a12", "Combien de côtés a un hexagone ?", "Six.", "correcte", true, 0.97, "factuel"],
  ["a13", "17 est-il premier ?", "Oui.", "correcte", true, 0.94, "calcul"],
  ["a14", "21 est-il premier ?", "Oui, il n'a pas de diviseur évident.", "incorrecte", true, 0.79, "calcul"],
  ["a15", "Plus long fleuve de France ?", "La Loire.", "correcte", true, 0.9, "factuel"],
  ["a16", "Plus long fleuve de France ?", "euh la seine je crois", "incorrecte", false, 0.41, "factuel"],
  ["a17", "3 puissance 4 ?", "81.", "correcte", true, 0.95, "calcul"],
  ["a18", "3 puissance 4 ?", "12", "incorrecte", false, 0.38, "calcul"],
  ["a19", "Un carré est-il un rectangle ?", "Oui, c'est un rectangle à côtés égaux.", "correcte", true, 0.89, "raisonnement"],
  ["a20", "Un rectangle est-il un carré ?", "Oui, les deux sont équivalents.", "incorrecte", true, 0.76, "raisonnement"],
  ["a21", "Symbole chimique du sodium ?", "Na.", "correcte", true, 0.93, "factuel"],
  ["a22", "Symbole chimique du potassium ?", "K.", "correcte", true, 0.92, "factuel"],
  ["a23", "100 divisé par 4 ?", "25.", "correcte", true, 0.96, "calcul"],
  ["a24", "100 divisé par 8 ?", "12,5.", "correcte", true, 0.94, "calcul"],
  ["a25", "Si P implique Q et Q est faux, que dire de P ?", "P est faux, par contraposée.", "correcte", true, 0.88, "raisonnement"],
  ["a26", "Si P implique Q et P est faux, que dire de Q ?", "Q est faux également.", "incorrecte", true, 0.74, "raisonnement"],
  ["a27", "Premier président de la Ve République ?", "Charles de Gaulle.", "correcte", true, 0.95, "factuel"],
  ["a28", "Nombre de continents ?", "Sept, selon la convention usuelle.", "correcte", true, 0.87, "factuel"],
  ["a29", "15 % de 200 ?", "30.", "correcte", true, 0.94, "calcul"],
  ["a30", "15 % de 240 ?", "36.", "correcte", true, 0.92, "calcul"],
  ["a31", "15 % de 320 ?", "45, environ.", "incorrecte", true, 0.71, "calcul"],
  ["a32", "Un nombre pair au carré est-il pair ?", "Oui, toujours.", "correcte", true, 0.9, "raisonnement"],
  ["a33", "Un nombre impair au carré est-il pair ?", "Oui, le carré rend pair.", "incorrecte", true, 0.68, "raisonnement"],
  ["a34", "Langue officielle du Brésil ?", "Le portugais.", "correcte", true, 0.95, "factuel"],
  ["a35", "Langue officielle de l'Autriche ?", "L'allemand.", "correcte", true, 0.93, "factuel"],
  ["a36", "2 puissance 10 ?", "1024.", "correcte", true, 0.96, "calcul"],
  ["a37", "2 puissance 12 ?", "2048.", "incorrecte", true, 0.83, "calcul"],
  ["a38", "Océan le plus vaste ?", "Le Pacifique.", "correcte", true, 0.95, "factuel"],
  ["a39", "Océan le plus vaste ?", "l atlantique non ?", "incorrecte", false, 0.35, "factuel"],
  ["a40", "Si A = B et B = C, alors ?", "A = C.", "correcte", true, 0.94, "raisonnement"],
  ["a41", "Somme des angles d'un triangle ?", "180 degrés.", "correcte", true, 0.96, "factuel"],
  ["a42", "Somme des angles d'un quadrilatère ?", "360 degrés.", "correcte", true, 0.93, "factuel"],
  ["a43", "Somme des angles d'un pentagone ?", "480 degrés.", "incorrecte", true, 0.72, "factuel"],
  ["a44", "Un multiple de 4 est-il multiple de 2 ?", "Oui, nécessairement.", "correcte", true, 0.92, "raisonnement"],
  ["a45", "Un multiple de 2 est-il multiple de 4 ?", "Oui, par construction.", "incorrecte", true, 0.7, "raisonnement"],
  ["a46", "Capitale du Canada ?", "Ottawa.", "correcte", true, 0.93, "factuel"],
  ["a47", "Capitale du Canada ?", "toronto surement", "incorrecte", false, 0.33, "factuel"],
  ["a48", "7 fois 8 ?", "56.", "correcte", true, 0.97, "calcul"],
  ["a49", "9 fois 7 ?", "63.", "correcte", true, 0.96, "calcul"],
  ["a50", "Élément le plus léger ?", "L'hydrogène.", "correcte", true, 0.94, "factuel"],
].map(([id, question, answer, human, fluent, generatorConfidence, topic]) => ({
  id: id as string,
  question: question as string,
  answer: answer as string,
  human: human as Answer["human"],
  fluent: fluent as boolean,
  generatorConfidence: generatorConfidence as number,
  topic: topic as Answer["topic"],
}));

/**
 * LE JUGE ÉVALUÉ — point d'insertion. Remplacez par votre appel de modèle juge.
 *
 * Celui-ci est délibérément imparfait, et de la manière la plus réaliste qui soit : il attrape les
 * réponses manifestement bâclées, mais il accepte les réponses fausses et bien tournées. C'est le
 * mode d'échec dominant des juges LLM.
 */
function llmJudge(a: Answer): { verdict: Answer["human"]; confidence: number } {
  if (!a.fluent) return { verdict: "incorrecte", confidence: 0.9 };
  // Bien tournée : le juge suit la confiance du générateur, ce qui est exactement l'ancrage
  // que `anchoring()` va détecter.
  const accepts = a.generatorConfidence >= 0.8;
  return {
    verdict: accepts ? "correcte" : "incorrecte",
    confidence: accepts ? a.generatorConfidence : 1 - a.generatorConfidence,
  };
}

/** LA RÉFÉRENCE — un juge trivial qui ne regarde que la forme. */
function fluencyJudge(a: Answer): { verdict: Answer["human"]; confidence: number } {
  return { verdict: a.fluent ? "correcte" : "incorrecte", confidence: 0.7 };
}

export const judgeAdapter: Adapter<Answer> = {
  name: "Juge LLM — contre un juge de pure fluidité",

  async loadItems() {
    return ANSWERS;
  },

  async predict(item): Promise<Prediction> {
    const { verdict, confidence } = llmJudge(item);
    return { label: verdict, prob: confidence, raw: { verdict_du_juge: verdict } };
  },

  async truth(item): Promise<Outcome> {
    return { label: item.human, raw: { verdict_humain: item.human, réponse: item.answer } };
  },

  async baseline(item): Promise<Prediction> {
    const { verdict, confidence } = fluencyJudge(item);
    return { label: verdict, prob: confidence };
  },

  category(item) {
    return item.topic;
  },
};

export default judgeAdapter;

/**
 * L'analyse propre au juge, que le rapport standard ne couvre pas.
 *
 * Le pack mesure déjà l'exactitude du juge et sa comparaison à la référence. Restent deux choses
 * spécifiques : l'accord CORRIGÉ DU HASARD (kappa), et les faux acceptés — les réponses fausses
 * que le juge a validées, qui sont la seule catégorie d'erreur réellement coûteuse.
 */
export function judgeAnalysis(): {
  agreement: ReturnType<typeof agreement>;
  falseAccepts: ReturnType<typeof falseAccepts>;
  generatorAnchoring: Array<{ prob: number; reference: number }>;
} {
  const pairs: AgreementPair[] = ANSWERS.map((a) => ({
    itemId: a.id,
    judge: llmJudge(a).verdict,
    human: a.human,
  }));
  return {
    agreement: agreement(pairs),
    falseAccepts: falseAccepts(pairs, "correcte"),
    // La confiance du juge contre celle du générateur : si elles sont corrélées, le juge
    // paraphrase au lieu de noter.
    generatorAnchoring: ANSWERS.map((a) => ({
      prob: llmJudge(a).confidence,
      reference: a.generatorConfidence,
    })),
  };
}
