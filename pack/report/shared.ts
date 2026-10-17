// Formatage partagé par les trois sorties, et l'ORDRE des sections.
//
// L'ordre n'est pas une question de goût. Un rapport est lu de haut en bas, et souvent seulement
// en haut. Donc :
//
//   1. le verdict en une phrase ;
//   2. la comparaison à la référence — TOUJOURS avant les métriques, parce que c'est ce qui compte ;
//   3. les métriques avec leurs intervalles ;
//   4. la ventilation par catégorie : où le système échoue précisément ;
//   5. les tranches écartées, nommées ;
//   6. les réserves — jamais vides ;
//   7. la reproductibilité.

import type { EvalResult } from "../core/evaluate.ts";
import { VERDICT_LABEL, t } from "../core/i18n.ts";
import type { Interval } from "../core/types.ts";

export const SECTIONS = [
  "Verdict",
  "Comparaison à la référence",
  "Métriques",
  "Ventilation par catégorie",
  "Écartés pour échantillon insuffisant",
  "Réserves",
  "Reproductibilité",
] as const;

export const pc = (v: number): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(1)} %` : "—";

export const num = (v: number, digits = 4): string =>
  Number.isFinite(v) ? v.toFixed(digits) : "—";

export const pts = (v: number): string =>
  Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} pt` : "—";

/** Un intervalle rendu lisible. Le point clé : la valeur ne s'affiche jamais seule. */
export function ci(i: Interval, digits = 4, asPercent = false): string {
  const f = asPercent ? (v: number) => pc(v) : (v: number) => num(v, digits);
  if (Number.isNaN(i.low) || Number.isNaN(i.high)) return `${f(i.value)} (intervalle indisponible)`;
  return `${f(i.value)}  [${f(i.low)} – ${f(i.high)}]`;
}

/** Le symbole du verdict, pour l'œil qui balaie. */
export function verdictBadge(r: EvalResult): string {
  if (r.refusal) return t(VERDICT_LABEL["REFUSÉ"]);
  const kind = r.contrastive?.verdict ?? "INDÉCIDABLE";
  return t(VERDICT_LABEL[kind] ?? VERDICT_LABEL["INDÉCIDABLE"]);
}

/** Sérialisation courte d'une valeur quelconque, pour l'affichage d'un défaut. */
export function brief(v: unknown, max = 220): string {
  let s: string;
  if (typeof v === "string") s = v;
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  s = (s ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Une valeur complète, sur plusieurs lignes, pour la reproduction d'un défaut. */
export function full(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}
