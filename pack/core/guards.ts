// Les garde-fous. C'est ce qui distingue ce pack d'un calculateur de métriques.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE REFUS, ET D'OÙ IL VIENT.
//
// Le système à l'origine de ce pack était parfaitement calibré — biais global de −0,42 point — et
// totalement sans valeur. Il paraissait bon parce qu'il recopiait sa référence : corrélation
// 0,9933, écart médian 0,9 point. Personne ne s'en est aperçu pendant 42 jours, parce que toutes
// les mesures étaient faites DANS L'ABSOLU.
//
// Il battait même largement le taux de base : skill de +29,2 %. Ce chiffre-là était vrai, et il
// n'a rien empêché. Battre le taux de base est nécessaire ; ce n'est JAMAIS suffisant.
//
// D'où la règle non négociable de ce pack : sans référence contrastive — quelque chose que
// quelqu'un pourrait réellement déployer à la place du système testé — AUCUN verdict de compétence
// n'est rendu. Pas un avertissement poli : un refus, en tête du rapport.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { t, tf } from "./i18n.ts";
import type { Slice } from "./types.ts";

/** La phrase exacte affichée en tête d'un rapport sans référence contrastive. */
export function refusalHeadline(): string {
  return t({
    fr:
      "Aucun verdict de compétence : sans baseline, une bonne calibration ne prouve rien. "
      + "Fournissez une référence.",
    en:
      "No competence verdict: without a baseline, good calibration proves nothing. "
      + "Provide a reference.",
  });
}

/** Conservée pour les tests et pour quiconque veut la chaîne française telle quelle. */
export const REFUSAL_HEADLINE =
  "Aucun verdict de compétence : sans baseline, une bonne calibration ne prouve rien. "
  + "Fournissez une référence.";

/** Seuil par défaut sous lequel une tranche ou un segment ne reçoit aucune conclusion. */
export const DEFAULT_MIN_OBS = 30;

/**
 * Seuil par défaut sous lequel une COMPARAISON n'est pas tentée.
 *
 * Plus haut que `DEFAULT_MIN_OBS` parce que distinguer deux systèmes proches demande beaucoup plus
 * de données que décrire un seul système. Sur les données d'origine, 242 observations appariées ne
 * suffisaient toujours pas à séparer deux Brier distants de 0,0013.
 */
export const DEFAULT_MIN_PAIRED = 100;

/** Les références contrastives acceptées. Aucune excuse ne tient : il y en a toujours une. */
export function acceptedBaselines(): string[] {
  return [
    t({
      fr: "la version précédente du système (prompt, modèle, réglages)",
      en: "the previous version of the system (prompt, model, settings)",
    }),
    t({ fr: "un modèle plus petit ou moins cher", en: "a smaller or cheaper model" }),
    t({
      fr: "une méthode non apprise : règle, recherche lexicale, heuristique",
      en: "a non-learned method: a rule, a lexical search, a heuristic",
    }),
    t({
      fr: "une référence externe : autre fournisseur, jeu de référence publié",
      en: "an external reference: another vendor, a published benchmark",
    }),
    t({
      fr: "un humain, même sur un sous-échantillon de 50 cas",
      en: "a human, even on a 50-case subsample",
    }),
    t({
      fr: "le système sans son étage le plus coûteux (RAG désactivé, outil retiré, chaîne raccourcie)",
      en: "the system without its most expensive stage (RAG off, tool dropped, chain shortened)",
    }),
  ];
}

/** Ce que le pack refuse, et pourquoi. Rendu tel quel dans les trois formats de rapport. */
export interface Refusal {
  headline: string;
  reason: string;
  accepted: string[];
}

export function refusalForMissingBaseline(): Refusal {
  return {
    headline: refusalHeadline(),
    reason: t({
      fr:
        "Aucune référence contrastive n'a été fournie par l'adaptateur (`baseline?`). Les métriques "
        + "ci-dessous décrivent le système ; elles ne disent pas s'il vaut mieux que ce qu'on aurait "
        + "déployé sans lui. Les références triviales calculées automatiquement (taux de base, classe "
        + "majoritaire, hasard) sont un PLANCHER : les battre est nécessaire, jamais suffisant.",
      en:
        "No contrastive baseline was provided by the adapter (`baseline?`). The metrics below "
        + "describe the system; they do not say whether it is better than what would have been "
        + "deployed without it. The trivial baselines computed automatically (base rate, majority "
        + "class, random) are a FLOOR: beating them is necessary, never sufficient.",
    }),
    accepted: acceptedBaselines(),
  };
}

/** Une tranche ou un segment écarté, avec son nom et la raison. Jamais tu. */
export interface Underpowered {
  scope: string;
  label: string;
  n: number;
  required: number;
}

/**
 * Les tranches sous le seuil, nommées.
 *
 * ELLES DOIVENT APPARAÎTRE DANS LE RAPPORT. Le projet d'origine a produit des ajustements à partir
 * de tranches à n = 5, 4 et 6 — c'est consigné dans son journal de leçons comme la première erreur
 * de la boucle d'apprentissage. Le silence sur une tranche trop mince se lit comme son absence ;
 * la nommer force à la voir.
 */
export function underpoweredSlices(scope: string, slices: Slice[], minObs: number): Underpowered[] {
  return slices
    .filter((s) => !s.conclusive)
    .map((s) => ({ scope, label: s.label, n: s.n, required: minObs }));
}

/** Peut-on conclure quoi que ce soit sur cet effectif ? */
export function canConclude(n: number, minObs: number): boolean {
  return n >= minObs;
}

/**
 * La phrase à écrire quand on ne peut pas conclure.
 *
 * « Pas encore mesurable » est une réponse complète et acceptable. Aucune formulation positive
 * n'est atteignable sous le seuil.
 */
export function insufficientSample(n: number, required: number, what: string): string {
  return tf({
    fr: (n: number, required: number, what: string) =>
      `${n} observations sur ${what} : sous le seuil de ${required}, aucune conclusion. `
      + "Ce n'est pas un mauvais résultat, c'est une absence de résultat.",
    en: (n: number, required: number, what: string) =>
      `${n} observations on ${what}: below the threshold of ${required}, no conclusion. `
      + "This is not a bad result, it is an absence of result.",
  })(n, required, what);
}

/** Les portées, traduites, pour la liste des écartés. */
export function scopeLabel(kind: "bin" | "category"): string {
  return kind === "bin"
    ? t({ fr: "tranche de confiance", en: "confidence bin" })
    : t({ fr: "catégorie", en: "category" });
}
