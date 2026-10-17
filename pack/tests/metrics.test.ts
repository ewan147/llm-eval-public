import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DECILES,
  baseRate,
  brier,
  calibrationCurve,
  climatologyBrier,
  confidenceSpread,
  decompose,
  expectedCalibrationError,
  logLoss,
  maximumCalibrationError,
  slice,
} from "../core/metrics.ts";
import type { Observation } from "../core/types.ts";

const o = (prob: number, outcome: boolean): Observation => ({
  itemId: "x",
  category: "",
  prob,
  outcome,
});

describe("brier", () => {
  it("vaut zéro sur des prédictions parfaites", () => {
    assert.equal(brier([o(1, true), o(0, false)]), 0);
  });

  it("vaut 0,25 pour qui répond toujours 50 %", () => {
    assert.equal(brier([o(0.5, true), o(0.5, false)]), 0.25);
  });

  it("CAS LIMITE n = 0 : rend 0 sans lever", () => {
    assert.equal(brier([]), 0);
  });

  it("CAS LIMITE n = 1 : reste défini", () => {
    assert.ok(Math.abs(brier([o(0.3, true)]) - 0.49) < 1e-12);
  });
});

describe("logLoss", () => {
  it("punit bien plus durement qu'un Brier une certitude qui se trompe", () => {
    const faux = [o(0.01, true)];
    assert.ok(logLoss(faux) > 4);
    assert.ok(brier(faux) < 1);
  });

  it("CAS LIMITE probabilité 0 sur l'issue réalisée : borné, jamais infini", () => {
    const v = logLoss([o(0, true)]);
    assert.ok(Number.isFinite(v), "la log-loss doit rester finie");
    assert.ok(v > 10, "elle doit rester très pénalisante");
  });

  it("CAS LIMITE probabilité 1 sur l'issue réalisée : coût nul", () => {
    assert.ok(Math.abs(logLoss([o(1, true)])) < 1e-9);
  });

  it("CAS LIMITE probabilité 1 sur l'issue NON réalisée : borné", () => {
    assert.ok(Number.isFinite(logLoss([o(1, false)])));
  });

  it("CAS LIMITE n = 0", () => {
    assert.equal(logLoss([]), 0);
  });
});

describe("baseRate et climatologyBrier", () => {
  it("le Brier du taux de base vaut base × (1 − base)", () => {
    const rows = [o(0.9, true), o(0.9, true), o(0.1, false), o(0.1, false)];
    assert.equal(baseRate(rows), 0.5);
    assert.equal(climatologyBrier(rows), 0.25);
  });

  it("CAS LIMITE n = 0", () => {
    assert.equal(baseRate([]), 0);
    assert.equal(climatologyBrier([]), 0);
  });
});

describe("slice", () => {
  it("mesure la surconfiance : annoncé au-dessus du réalisé", () => {
    const s = slice("x", [o(0.7, true), o(0.7, false), o(0.7, true), o(0.7, false)], 3);
    assert.ok(Math.abs(s.predicted - 0.7) < 1e-9);
    assert.ok(Math.abs(s.actual - 0.5) < 1e-9);
    assert.ok(Math.abs(s.bias - 0.2) < 1e-9);
    assert.equal(s.conclusive, true);
  });

  it("marque non concluante une tranche sous le seuil, sans la supprimer", () => {
    const s = slice("x", [o(0.7, true)], 30);
    assert.equal(s.n, 1);
    assert.equal(s.conclusive, false);
  });
});

describe("calibrationCurve", () => {
  it("range chaque observation dans une seule tranche, bornes comprises", () => {
    const rows = [o(0, false), o(0.05, false), o(0.55, true), o(1, true)];
    const curve = calibrationCurve(rows, DECILES, 1);
    assert.equal(curve.reduce((a, s) => a + s.n, 0), rows.length);
  });

  it("CAS LIMITE probabilité exactement 1 : comptée dans la dernière tranche, jamais perdue", () => {
    const curve = calibrationCurve([o(1, true)], DECILES, 1);
    assert.equal(curve.length, 1);
    assert.equal(curve[0].n, 1);
  });

  it("CAS LIMITE probabilité exactement 0 : comptée dans la première tranche", () => {
    const curve = calibrationCurve([o(0, false)], DECILES, 1);
    assert.equal(curve.length, 1);
    assert.equal(curve[0].n, 1);
  });

  it("CAS LIMITE n = 0 : courbe vide, pas d'erreur", () => {
    assert.deepEqual(calibrationCurve([], DECILES, 1), []);
  });
});

describe("ECE et MCE", () => {
  it("l'ECE ne se laisse pas annuler par des biais qui se compensent", () => {
    // +20 pt sur une tranche, −20 pt sur l'autre : biais global nul, ECE de 20 pt.
    // C'est la situation exacte où le seul biais global rassure à tort.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => o(0.75, i < 5)),
      ...Array.from({ length: 10 }, (_, i) => o(0.25, i < 5)),
    ];
    const curve = calibrationCurve(rows, DECILES, 1);
    assert.ok(Math.abs(slice("g", rows, 1).bias) < 1e-9, "biais global nul");
    assert.ok(Math.abs(expectedCalibrationError(curve) - 0.25) < 1e-9);
    assert.ok(Math.abs(maximumCalibrationError(curve) - 0.25) < 1e-9);
  });

  it("CAS LIMITE courbe vide", () => {
    assert.equal(expectedCalibrationError([]), 0);
    assert.equal(maximumCalibrationError([]), 0);
  });
});

describe("décomposition de Murphy — être calibré ne suffit pas", () => {
  it("démasque le prévisionniste PARFAITEMENT calibré et totalement inutile", () => {
    // Annonce toujours 50 %, réalise 50 % : calibration impeccable, résolution nulle.
    const rows = Array.from({ length: 100 }, (_, i) => o(0.5, i % 2 === 0));
    const d = decompose(rows, DECILES);
    assert.ok(Math.abs(slice("g", rows, 1).bias) < 1e-9, "« bien calibré »");
    assert.ok(Math.abs(d.resolution) < 1e-9, "et pourtant sans valeur");
    assert.ok(d.skill <= 0);
    assert.equal(d.binsUsed, 1, "une seule tranche peuplée");
  });

  it("reconnaît un prévisionniste qui sépare vraiment les issues", () => {
    const bas = Array.from({ length: 50 }, (_, i) => o(0.2, i < 10));
    const haut = Array.from({ length: 50 }, (_, i) => o(0.8, i < 40));
    const d = decompose([...bas, ...haut], DECILES);
    assert.ok(Math.abs(d.reliability) < 1e-9);
    assert.ok(d.resolution > 0.05);
    assert.ok(d.skill > 0);
  });

  it("sanctionne celui qui discrimine à CONTRESENS", () => {
    const bas = Array.from({ length: 50 }, (_, i) => o(0.2, i < 40));
    const haut = Array.from({ length: 50 }, (_, i) => o(0.8, i < 10));
    assert.ok(decompose([...bas, ...haut], DECILES).skill < 0);
  });

  it("CAS LIMITE n = 0", () => {
    const d = decompose([], DECILES);
    assert.equal(d.n, 0);
    assert.equal(d.skill, 0);
    assert.equal(d.binsUsed, 0);
  });

  it("CAS LIMITE issue constante : incertitude nulle, skill ramené à 0 sans division par zéro", () => {
    const d = decompose(Array.from({ length: 50 }, () => o(0.9, true)), DECILES);
    assert.equal(d.uncertainty, 0);
    assert.equal(d.skill, 0);
    assert.ok(Number.isFinite(d.skill));
  });
});

describe("confidenceSpread", () => {
  it("compte les valeurs de confiance distinctes", () => {
    const s = confidenceSpread([o(0.5, true), o(0.5, false), o(0.9, true)]);
    assert.equal(s.distinct, 2);
    assert.equal(s.min, 0.5);
    assert.equal(s.max, 0.9);
  });

  it("CAS LIMITE n = 0", () => {
    assert.deepEqual(confidenceSpread([]), { distinct: 0, min: 0, max: 0 });
  });
});
