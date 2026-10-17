// La série longitudinale — le seul avantage qui ne se rattrape pas en publiant vite.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI C'EST L'ACTIF, ET PAS LE RAPPORT INDIVIDUEL.
//
// Une mesure isolée sur un modèle qui vient de sortir s'évapore en trois jours : cent personnes
// publient la même chose dans les six heures. Une SUITE CONSTANTE appliquée à douze modèles
// successifs construit autre chose — une courbe que personne ne peut produire après coup, parce
// qu'il aurait fallu commencer il y a un an.
//
// C'est ce qui rend la contrainte de suite figée non négociable : la valeur de la série est
// exactement égale à la rigueur avec laquelle on refuse de toucher aux cas.
//
// CE MODULE NE COMPARE PAS DES MODÈLES ENTRE EUX. Il range des points sur un axe, et il SÉPARE
// les points selon leur empreinte de suite. Deux points d'empreintes différentes apparaissent
// dans la même série chronologique mais dans des segments distincts, et la série le dit — sinon
// on tracerait une courbe qui mélange des mesures incomparables, ce qui est précisément le piège
// n°3 de `PIEGES.md` appliqué au temps.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { summarize, type ProtocolRun, type RunSummary } from "./runner.ts";

/** Un point de la série : un modèle, une date, une suite, un résultat. */
export interface SeriesPoint {
  model: string;
  runAt: string;
  suiteId: string;
  suiteVersion: number;
  fingerprint: string;
  caseCount: number;
  summary: RunSummary;
  /** L'exécution est-elle allée au bout ? Un point incomplet n'est pas comparable aux autres. */
  complete: boolean;
  /** Vrai pour les exécutions antérieures au protocole. */
  legacy: boolean;
}

/** Un segment de série : tous les points partageant la même empreinte, donc comparables. */
export interface SeriesSegment {
  fingerprint: string;
  suiteId: string;
  suiteVersion: number;
  caseCount: number;
  points: SeriesPoint[];
  /** Vrai si le segment contient au moins deux modèles distincts — sinon rien à comparer. */
  comparable: boolean;
}

export interface Series {
  segments: SeriesSegment[];
  totalPoints: number;
  /** Modèles distincts mesurés, toutes suites confondues. */
  models: string[];
  /** La phrase honnête sur ce que cette série permet et ne permet pas encore. */
  statement: string;
}

export function toPoint(run: ProtocolRun): SeriesPoint {
  return {
    model: run.model,
    runAt: run.runAt,
    suiteId: run.suite.id,
    suiteVersion: run.suite.version,
    fingerprint: run.suite.fingerprint,
    caseCount: run.suite.caseCount,
    summary: summarize(run),
    complete: run.complete,
    legacy: run.suite.id.startsWith("legacy-"),
  };
}

/**
 * Construit la série à partir d'un ensemble d'exécutions.
 *
 * Les segments sont triés par nombre de points décroissant : le plus fourni d'abord, parce que
 * c'est le seul sur lequel une tendance peut se lire. Les points d'un segment sont triés
 * chronologiquement.
 */
export function buildSeries(runs: ProtocolRun[]): Series {
  const points = runs.map(toPoint);
  const byFingerprint = new Map<string, SeriesPoint[]>();
  for (const p of points) {
    const list = byFingerprint.get(p.fingerprint);
    if (list) list.push(p);
    else byFingerprint.set(p.fingerprint, [p]);
  }

  const segments: SeriesSegment[] = [...byFingerprint.entries()]
    .map(([fingerprint, list]) => {
      const sorted = [...list].sort((a, b) => a.runAt.localeCompare(b.runAt));
      return {
        fingerprint,
        suiteId: sorted[0].suiteId,
        suiteVersion: sorted[0].suiteVersion,
        caseCount: sorted[0].caseCount,
        points: sorted,
        comparable: new Set(sorted.map((p) => p.model)).size >= 2,
      };
    })
    .sort((a, b) => b.points.length - a.points.length);

  const models = [...new Set(points.map((p) => p.model))];
  const usable = segments.filter((s) => s.comparable);

  let statement: string;
  if (segments.length === 0) {
    statement = "Série vide : aucune exécution enregistrée.";
  } else if (usable.length === 0) {
    statement =
      `${points.length} exécution(s) sur ${models.length} modèle(s), réparties en `
      + `${segments.length} suites d'empreintes différentes. AUCUN segment ne contient deux modèles `
      + "mesurés sur les mêmes cas : la série existe, mais elle ne permet encore aucune comparaison. "
      + "C'est le point de départ normal, et c'est ce que la suite figée corrige à partir de "
      + "maintenant.";
  } else {
    const best = usable[0];
    statement =
      `${points.length} exécution(s) sur ${models.length} modèle(s). `
      + `${usable.length} segment(s) permettent une comparaison ; le plus fourni porte sur `
      + `${best.caseCount} cas et ${best.points.length} exécutions `
      + `(${[...new Set(best.points.map((p) => p.model))].join(", ")}). `
      + `Les ${segments.length - usable.length} autre(s) segment(s) n'ont qu'un seul modèle : rien `
      + "à y comparer.";
  }

  return { segments, totalPoints: points.length, models, statement };
}

/** L'évolution d'une métrique dans un segment, du plus ancien au plus récent. */
export interface Trend {
  fingerprint: string;
  metric: string;
  points: Array<{ model: string; runAt: string; value: number }>;
  /** Écart entre le premier et le dernier point. */
  delta: number;
  /** Faux tant que le segment ne contient pas au moins trois points : une tendance sur deux points est une droite, pas une tendance. */
  readable: boolean;
}

/**
 * Extrait une tendance lisible d'un segment.
 *
 * `readable` est faux sous trois points, et c'est délibéré : relier deux points donne toujours une
 * droite parfaite, et l'afficher comme une tendance suggère une régularité qui n'a pas été
 * observée. Deux points sont une comparaison, pas une trajectoire.
 */
export function accuracyTrend(segment: SeriesSegment): Trend {
  const pts = segment.points.map((p) => ({
    model: p.model,
    runAt: p.runAt,
    value: p.summary.accuracy,
  }));
  return {
    fingerprint: segment.fingerprint,
    metric: "exactitude",
    points: pts,
    delta: pts.length >= 2 ? pts[pts.length - 1].value - pts[0].value : 0,
    readable: pts.length >= 3,
  };
}
