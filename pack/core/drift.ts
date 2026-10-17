// Dérive : le système s'est-il dégradé depuis la dernière mesure ?
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE PIÈGE QUE CE MODULE EXISTE POUR ATTRAPER.
//
// Comparer deux exécutions est la chose la plus facile à faire mal. « 82 % la semaine dernière,
// 78 % aujourd'hui » se lit comme une dégradation, alors que trois explications au moins sont
// possibles :
//
//   1. le système s'est dégradé ;
//   2. le jeu de test a changé — et alors on ne compare rien du tout ;
//   3. rien n'a changé, et l'écart est dans le bruit d'échantillonnage.
//
// Ce module distingue les trois. Il commence par comparer l'EMPREINTE DES DONNÉES : si elle
// diffère, il refuse de parler de dérive du système et le dit. C'est le piège 3 du projet
// d'origine — croiser des mesures issues d'instants différents fabrique des écarts qui n'existent
// pas — appliqué au cas le plus courant de tous.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { mcNemar } from "./binary.ts";
import { zFor } from "./binary.ts";
import type { EvalResult } from "./evaluate.ts";
import type { Trial } from "./types.ts";

export type DriftVerdict =
  | "DÉGRADATION"
  | "AMÉLIORATION"
  | "STABLE"
  | "INDÉCIDABLE"
  | "JEUX DE TEST DIFFÉRENTS";

export interface DriftReport {
  before: { adapter: string; runAt: string; n: number; rate: number; fingerprint: string };
  after: { adapter: string; runAt: string; n: number; rate: number; fingerprint: string };
  /** Les deux exécutions portent-elles sur exactement les mêmes données ? */
  sameData: boolean;
  /** Cas présents dans les deux exécutions, appariés par identifiant. */
  paired: number;
  /** Écart de taux de réussite, après − avant. */
  difference: number;
  /** Demi-largeur de l'intervalle à 95 % sur cet écart. */
  margin: number;
  /** Cas qui réussissaient avant et échouent maintenant. Les régressions à examiner. */
  regressions: string[];
  /** Cas qui échouaient avant et réussissent maintenant. */
  fixes: string[];
  verdict: DriftVerdict;
  statement: string;
}

/**
 * Compare deux exécutions du même adaptateur.
 *
 * L'appariement se fait par identifiant de cas, et l'écart est testé par McNemar : seuls les cas
 * qui ont CHANGÉ d'état portent de l'information. Deux exécutions à 82 % et 78 % peuvent être
 * indiscernables si ce sont les mêmes cas qui échouent, et nettement différentes si ce ne sont pas
 * les mêmes.
 */
export function detectDrift(before: EvalResult, after: EvalResult, level = 0.95): DriftReport {
  const sameData = before.reproducibility.dataFingerprint === after.reproducibility.dataFingerprint;

  const beforeTrials = trialsOf(before);
  const afterTrials = trialsOf(after);
  const beforeById = new Map(beforeTrials.map((t) => [t.itemId, t]));

  const regressions: string[] = [];
  const fixes: string[] = [];
  const pairedBefore: Trial[] = [];
  const pairedAfter: Trial[] = [];

  for (const a of afterTrials) {
    const b = beforeById.get(a.itemId);
    if (!b) continue;
    pairedBefore.push(b);
    pairedAfter.push(a);
    if (b.pass && !a.pass) regressions.push(a.itemId);
    if (!b.pass && a.pass) fixes.push(a.itemId);
  }

  const paired = pairedAfter.length;
  const rateBefore = before.binary.successRate.value;
  const rateAfter = after.binary.successRate.value;
  const difference = paired > 0 ? (fixes.length - regressions.length) / paired : rateAfter - rateBefore;

  // Intervalle sur la différence appariée de proportions (McNemar), formule de Wald sur les
  // discordants — suffisante ici parce qu'on ne s'en sert que pour l'affichage ; la décision
  // s'appuie sur le test exact ci-dessous.
  const discordant = regressions.length + fixes.length;
  const margin =
    paired > 0 && discordant > 0
      ? (zFor(level) * Math.sqrt(discordant - (fixes.length - regressions.length) ** 2 / paired)) / paired
      : 0;

  const test = paired > 0 ? mcNemar(pairedAfter, pairedBefore, level) : null;

  let verdict: DriftVerdict;
  let statement: string;

  if (!sameData) {
    verdict = "JEUX DE TEST DIFFÉRENTS";
    statement =
      "Les deux exécutions ne portent pas sur les mêmes données (empreintes différentes : "
      + `${before.reproducibility.dataFingerprint} contre ${after.reproducibility.dataFingerprint}). `
      + "Tout écart de score mélange un changement du système et un changement du jeu de test. "
      + "Aucune conclusion sur une dérive n'est possible — refaire les deux mesures sur le même jeu.";
  } else if (paired === 0) {
    verdict = "INDÉCIDABLE";
    statement = "Aucun cas apparié entre les deux exécutions.";
  } else if (!test || !test.significant) {
    verdict = "STABLE";
    statement =
      `Aucune dérive détectable : ${fixes.length} cas réparés, ${regressions.length} cas dégradés `
      + `sur ${paired} appariés. L'écart ne sort pas du bruit d'échantillonnage `
      + `(p = ${test ? test.pValue.toFixed(3) : "n/a"}). Stable ne veut pas dire identique : `
      + `${discordant} cas ont changé d'état individuellement.`;
  } else if (difference < 0) {
    verdict = "DÉGRADATION";
    statement =
      `DÉGRADATION mesurée : ${regressions.length} cas qui passaient échouent maintenant, contre `
      + `${fixes.length} réparés, sur ${paired} cas appariés (p = ${test.pValue.toFixed(4)}). `
      + "Les identifiants des régressions sont listés : ce sont eux qu'il faut regarder en premier.";
  } else {
    verdict = "AMÉLIORATION";
    statement =
      `AMÉLIORATION mesurée : ${fixes.length} cas réparés contre ${regressions.length} dégradés sur `
      + `${paired} cas appariés (p = ${test.pValue.toFixed(4)}).`;
  }

  return {
    before: {
      adapter: before.adapter,
      runAt: before.reproducibility.runAt,
      n: before.n,
      rate: rateBefore,
      fingerprint: before.reproducibility.dataFingerprint,
    },
    after: {
      adapter: after.adapter,
      runAt: after.reproducibility.runAt,
      n: after.n,
      rate: rateAfter,
      fingerprint: after.reproducibility.dataFingerprint,
    },
    sameData,
    paired,
    difference,
    margin,
    regressions,
    fixes,
    verdict,
    statement,
  };
}

function trialsOf(r: EvalResult): Trial[] {
  return r.cases
    .filter((c) => !c.error)
    .map((c) => ({ itemId: c.itemId, category: c.category, pass: c.correct }));
}
