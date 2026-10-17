// Départager un match d'échecs entre deux modèles — parce qu'un match doit avoir un vainqueur.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CE MODULE EXISTE (demande du propriétaire, 2026-10-04 : « s'ils s'affrontent aux échecs, il
// faut qu'il y en ait un qui gagne, qu'on puisse les départager »).
//
// Entre modèles de langage, une partie atteint souvent la limite de demi-coups sans mat : sans règle,
// tout finit en nulle et le match ne dit rien. On applique donc, DANS CET ORDRE, des règles annoncées
// d'avance — jamais choisies après avoir vu le résultat :
//
//   1. Une partie terminée sur l'échiquier (mat, pat, nulle réglementaire) ou par forfait (3 coups
//      illégaux de suite) garde son résultat.
//   2. Une partie arrêtée à la limite est ADJUGÉE au matériel : 3 points d'avance ou plus (pion 1,
//      cavalier et fou 3, tour 5, dame 9) donnent la victoire ; moins, c'est nulle. C'est la règle
//      d'adjudication classique : une pièce d'avance suffit à gagner entre joueurs qui savent finir.
//   3. Une partie interrompue par une PANNE (connexion, délai) n'est pas comptée : ce n'est la faute
//      d'aucun des deux joueurs. Elle est nommée dans le résultat.
//   4. Égalité aux points : départage par l'avance matérielle cumulée sur toutes les parties, puis
//      par le nombre de coups illégaux proposés (le moins gagne).
//   5. Égalité sur tout : on le dit. Inventer un vainqueur serait mentir.
//
// Le rapport dit TOUJOURS quelle règle a tranché. « Gagné à l'adjudication » n'est pas « gagné par mat ».
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { depuisFen } from "./echiquier.ts";
import type { Partie, Resultat } from "./epreuve.ts";

const VALEUR: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const SEUIL_ADJUDICATION = 3;

/** Matériel des blancs et des noirs dans une position. */
export function materiel(fen: string): { blancs: number; noirs: number } {
  const p = depuisFen(fen);
  let blancs = 0, noirs = 0;
  for (const piece of p.cases) {
    if (!piece) continue;
    const v = VALEUR[piece.toLowerCase()] ?? 0;
    if (piece === piece.toUpperCase()) blancs += v;
    else noirs += v;
  }
  return { blancs, noirs };
}

export type FinDePartie = "échiquier" | "forfait" | "adjudication" | "panne";

export interface PartieDepartagee {
  blancs: string;
  noirs: string;
  /** Résultat retenu pour le match (après adjudication). `null` : partie non comptée (panne). */
  resultat: Resultat | null;
  fin: FinDePartie;
  explication: string;
  /** Avance matérielle des blancs à la fin de la partie. */
  avanceBlancs: number;
  illegaux: { blancs: number; noirs: number };
}

export function departagerPartie(p: Partie): PartieDepartagee {
  const m = materiel(p.fenFinale);
  const avance = m.blancs - m.noirs;
  const base = { blancs: p.blancs, noirs: p.noirs, avanceBlancs: avance, illegaux: p.illegaux };
  if (/^Panne du modèle/.test(p.cause)) {
    return { ...base, resultat: null, fin: "panne", explication: `Non comptée : ${p.cause}` };
  }
  if (/n'a pas produit de coup légal/.test(p.cause)) {
    return { ...base, resultat: p.resultat, fin: "forfait", explication: p.cause };
  }
  if (/^Limite de/.test(p.cause)) {
    if (Math.abs(avance) >= SEUIL_ADJUDICATION) {
      const gagnant = avance > 0 ? p.blancs : p.noirs;
      return {
        ...base, resultat: avance > 0 ? "1-0" : "0-1", fin: "adjudication",
        explication: `Limite atteinte ; adjugée à ${gagnant} au matériel (${m.blancs} contre ${m.noirs}, `
          + `${Math.abs(avance)} points d'avance ≥ ${SEUIL_ADJUDICATION}).`,
      };
    }
    return {
      ...base, resultat: "1/2-1/2", fin: "adjudication",
      explication: `Limite atteinte ; matériel ${m.blancs} contre ${m.noirs} (écart < ${SEUIL_ADJUDICATION}) : nulle.`,
    };
  }
  return { ...base, resultat: p.resultat, fin: "échiquier", explication: p.cause };
}

export interface ResultatMatch {
  a: string;
  b: string;
  parties: PartieDepartagee[];
  points: { a: number; b: number };
  /** Le vainqueur, ou `null` si l'égalité est parfaite. */
  vainqueur: string | null;
  /** La règle qui a tranché. */
  tranchePar: "points" | "matériel cumulé" | "coups illégaux" | "égalité parfaite" | "aucune partie comptée";
  explication: string;
}

export function departagerMatch(parties: Partie[], a: string, b: string): ResultatMatch {
  const dp = parties.map(departagerPartie);
  const points = { a: 0, b: 0 };
  let avanceA = 0, illegauxA = 0, illegauxB = 0, comptees = 0;
  for (const p of dp) {
    const aBlanc = p.blancs === a;
    illegauxA += aBlanc ? p.illegaux.blancs : p.illegaux.noirs;
    illegauxB += aBlanc ? p.illegaux.noirs : p.illegaux.blancs;
    if (p.resultat === null) continue;
    comptees++;
    avanceA += aBlanc ? p.avanceBlancs : -p.avanceBlancs;
    if (p.resultat === "1/2-1/2") { points.a += 0.5; points.b += 0.5; }
    else if ((p.resultat === "1-0") === aBlanc) points.a += 1;
    else points.b += 1;
  }
  const fin = (vainqueur: string | null, tranchePar: ResultatMatch["tranchePar"], explication: string): ResultatMatch =>
    ({ a, b, parties: dp, points, vainqueur, tranchePar, explication });

  if (comptees === 0) return fin(null, "aucune partie comptée", "Aucune partie n'a pu être comptée (pannes).");
  const adjugees = dp.filter((p) => p.fin === "adjudication").length;
  const note = adjugees ? ` ${adjugees} partie(s) sur ${comptees} adjugée(s) au matériel à la limite de coups.` : "";
  if (points.a !== points.b) {
    const v = points.a > points.b ? a : b;
    return fin(v, "points", `${v} gagne ${Math.max(points.a, points.b)}–${Math.min(points.a, points.b)}.${note}`);
  }
  if (avanceA !== 0) {
    const v = avanceA > 0 ? a : b;
    return fin(v, "matériel cumulé", `Égalité ${points.a}–${points.b} aux points ; ${v} l'emporte au matériel cumulé `
      + `(${Math.abs(avanceA)} points d'avance sur l'ensemble des parties).${note}`);
  }
  if (illegauxA !== illegauxB) {
    const v = illegauxA < illegauxB ? a : b;
    return fin(v, "coups illégaux", `Égalité aux points et au matériel ; ${v} l'emporte en ayant proposé moins de coups `
      + `illégaux (${Math.min(illegauxA, illegauxB)} contre ${Math.max(illegauxA, illegauxB)}).${note}`);
  }
  return fin(null, "égalité parfaite", `Égalité parfaite : points, matériel et coups illégaux. Aucun vainqueur ne peut être désigné honnêtement.${note}`);
}
