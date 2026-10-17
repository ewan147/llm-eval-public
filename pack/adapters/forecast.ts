// ADAPTATEUR 4 — prédiction probabiliste d'un événement futur.
//
// C'est le cas d'origine de tout ce pack, généralisé : 3 671 prédictions réellement réglées d'un
// système probabiliste, anonymisées, avec la référence externe qui l'accompagnait.
//
// Il sert de démonstration ET de test de non-régression : le pack doit y retrouver les chiffres
// publiés dans extraction/PREUVES.md, et surtout le verdict — le système n'y bat pas sa référence.
//
// Il n'appelle aucun modèle : les prédictions sont déjà faites et archivées. C'est le cas le plus
// simple à brancher, et souvent le vôtre si vous journalisez déjà vos sorties.

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import type { Adapter, Outcome, Prediction } from "../core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolvePath(here, "../fixtures");

interface RawObservation {
  itemId: string;
  category: string;
  group: string;
  cohort: string;
  prob: number;
  outcome: boolean;
  observedAt: string;
}

interface RawBaseline {
  itemId: string;
  source: string;
  observedAt: string | null;
  references: Record<string, number>;
}

/** Un cas : une prédiction déjà émise, son issue, et éventuellement la valeur de la référence. */
export interface ForecastItem {
  id: string;
  category: string;
  group: string;
  systemProb: number;
  happened: boolean;
  /** Probabilité de la référence sur ce même événement, dévigorisée. Absente si non couvert. */
  referenceProb?: number;
}

/**
 * Retire la surronde d'un jeu de valeurs de référence exhaustives.
 *
 * Une référence exprimée en prix inversé somme à plus de 1 : l'écart est la marge de celui qui la
 * publie. Comparer une probabilité à `1/valeur` sans retirer cette marge fait perdre le système à
 * tous les coups, pour une raison qui n'a rien à voir avec sa qualité.
 */
function removeOverround(values: number[]): number[] {
  const implied = values.map((v) => 1 / v);
  const sum = implied.reduce((a, p) => a + p, 0);
  if (!(sum > 0) || !Number.isFinite(sum)) return values.map(() => 0);
  return implied.map((p) => p / sum);
}

/** Charge les cas. `limit` permet de rejouer l'instantané historique de 3 100 observations. */
export function loadForecastItems(limit?: number): ForecastItem[] {
  const obs = JSON.parse(readFileSync(resolvePath(FIXTURES, "observations.json"), "utf-8")) as {
    observations: RawObservation[];
  };
  const base = JSON.parse(readFileSync(resolvePath(FIXTURES, "baseline.json"), "utf-8")) as {
    partitions: Array<{ id: string; categories: string[] }>;
    baseline: RawBaseline[];
  };

  // La référence n'est exploitable que sur une PARTITION COMPLÈTE : si une issue manque, la somme
  // des autres tombe sous 1 et chaque probabilité rendue est mécaniquement gonflée. On exige donc
  // toutes les catégories de la partition avant de convertir quoi que ce soit.
  const refProb = new Map<string, number>();
  for (const b of base.baseline) {
    for (const p of base.partitions) {
      const raw = p.categories.map((c) => b.references[c]);
      if (raw.some((v) => typeof v !== "number" || !Number.isFinite(v) || v <= 1)) continue;
      const probs = removeOverround(raw as number[]);
      p.categories.forEach((c, i) => refProb.set(`${b.itemId}#${c}`, probs[i]));
    }
  }

  const rows = obs.observations.slice(0, limit ?? obs.observations.length);
  return rows.map((o) => ({
    id: o.itemId ? `${o.itemId}#${o.category}` : "",
    category: o.group,
    group: o.group,
    systemProb: o.prob,
    happened: o.outcome,
    referenceProb: refProb.get(`${o.itemId}#${o.category}`),
  }));
}

/**
 * L'adaptateur. Douze lignes utiles.
 *
 * `limit` : passer 3100 rejoue l'instantané sur lequel extraction/PREUVES.md a été écrit.
 */
export function forecastAdapter(limit?: number): Adapter<ForecastItem> {
  const items = loadForecastItems(limit);
  return {
    name: `Prévision probabiliste archivée (${items.length} observations)`,

    async loadItems() {
      return items;
    },

    // Le système a déjà répondu : on relit sa sortie. `prob` est P(événement).
    async predict(item): Promise<Prediction> {
      return { prob: item.systemProb, raw: { probabilité: item.systemProb } };
    },

    // L'événement a-t-il eu lieu ?
    async truth(item): Promise<Outcome> {
      return { ok: item.happened, raw: { survenu: item.happened } };
    },

    // La référence externe. Rendre `{}` quand elle n'a pas d'avis : le cas sera compté comme non
    // apparié, jamais comme une erreur.
    async baseline(item): Promise<Prediction> {
      return item.referenceProb === undefined ? {} : { prob: item.referenceProb };
    },

    category(item) {
      return item.group;
    },
  };
}

// `FORECAST_LIMIT=3100` rejoue l'instantané historique sur lequel extraction/PREUVES.md a été
// écrit, et doit y retrouver un Brier de 0,1603.
export default forecastAdapter(
  process.env.FORECAST_LIMIT ? Number(process.env.FORECAST_LIMIT) : undefined,
);
