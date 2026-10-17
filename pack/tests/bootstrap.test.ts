import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bootstrapCI, containsZero, makeRng, pairedBootstrapCI } from "../core/bootstrap.ts";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

describe("makeRng", () => {
  it("est reproductible à graine égale", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 20; i++) assert.equal(a(), b());
  });

  it("diffère à graine différente", () => {
    assert.notEqual(makeRng(1)(), makeRng(2)());
  });

  it("reste dans [0, 1)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `hors bornes : ${v}`);
    }
  });

  it("CAS LIMITE graine 0 : ne se bloque pas sur une suite constante", () => {
    const r = makeRng(0);
    const vals = new Set(Array.from({ length: 10 }, () => r()));
    assert.ok(vals.size > 1, "une graine nulle ne doit pas produire une suite constante");
  });
});

describe("bootstrapCI", () => {
  it("encadre la vraie valeur", () => {
    const data = Array.from({ length: 400 }, (_, i) => (i < 120 ? 1 : 0));
    const ci = bootstrapCI(data, mean, { samples: 500 });
    assert.ok(Math.abs(ci.value - 0.3) < 1e-9);
    assert.ok(ci.low < 0.3 && ci.high > 0.3, "l'intervalle doit contenir la valeur ponctuelle");
  });

  it("est reproductible : deux appels donnent le même intervalle", () => {
    const data = Array.from({ length: 200 }, (_, i) => i % 3);
    const a = bootstrapCI(data, mean, { samples: 300, seed: 5 });
    const b = bootstrapCI(data, mean, { samples: 300, seed: 5 });
    assert.equal(a.low, b.low);
    assert.equal(a.high, b.high);
  });

  it("se resserre quand l'échantillon grandit", () => {
    const petit = bootstrapCI(Array.from({ length: 30 }, (_, i) => i % 2), mean, { samples: 400 });
    const grand = bootstrapCI(Array.from({ length: 3000 }, (_, i) => i % 2), mean, { samples: 400 });
    assert.ok(grand.high - grand.low < petit.high - petit.low);
  });

  it("CAS LIMITE n = 0 : rend un intervalle indisponible plutôt qu'un faux intervalle", () => {
    const ci = bootstrapCI([], mean, { samples: 100 });
    assert.ok(Number.isNaN(ci.low));
    assert.ok(Number.isNaN(ci.high));
    assert.match(ci.method, /impossible/);
  });

  it("CAS LIMITE n = 1 : refuse aussi, au lieu de rendre [x, x]", () => {
    // Un intervalle de largeur nulle sur une seule observation serait le mensonge le plus direct
    // que ce pack puisse produire.
    const ci = bootstrapCI([0.7], mean, { samples: 100 });
    assert.equal(ci.value, 0.7);
    assert.ok(Number.isNaN(ci.low));
  });

  it("CAS LIMITE données constantes : intervalle de largeur nulle, ce qui est correct ici", () => {
    const ci = bootstrapCI(Array.from({ length: 50 }, () => 0.5), mean, { samples: 200 });
    assert.equal(ci.low, 0.5);
    assert.equal(ci.high, 0.5);
  });
});

describe("pairedBootstrapCI — l'appariement ne doit jamais être cassé", () => {
  it("détecte une différence systématique même quand les deux séries varient beaucoup", () => {
    // Chaque paire : le système fait exactement 0,1 de mieux. La variance ENTRE paires est
    // énorme, la différence appariée est constante. Deux bootstraps indépendants noieraient
    // l'écart ; l'appariement le voit immédiatement.
    const pairs = Array.from({ length: 200 }, (_, i) => {
      const base = (i % 50) / 50;
      return { s: base + 0.1, b: base };
    });
    const ci = pairedBootstrapCI(pairs, (sample) => mean(sample.map((p) => p.s - p.b)), {
      samples: 400,
    });
    assert.ok(Math.abs(ci.value - 0.1) < 1e-9);
    assert.equal(containsZero(ci), false, "une différence constante doit être détectée");
  });

  it("ne détecte rien quand il n'y a rien à détecter", () => {
    const pairs = Array.from({ length: 200 }, (_, i) => ({ s: (i * 7) % 11, b: (i * 7) % 11 }));
    const ci = pairedBootstrapCI(pairs, (sample) => mean(sample.map((p) => p.s - p.b)), {
      samples: 400,
    });
    assert.equal(ci.value, 0);
    assert.equal(containsZero(ci), true);
  });
});

describe("containsZero", () => {
  it("vrai quand l'intervalle chevauche zéro", () => {
    assert.equal(containsZero({ value: 0.01, low: -0.02, high: 0.04, level: 0.95, method: "b" }), true);
  });

  it("faux quand il l'exclut", () => {
    assert.equal(containsZero({ value: 0.05, low: 0.01, high: 0.09, level: 0.95, method: "b" }), false);
  });

  it("CAS LIMITE intervalle indisponible : traité comme contenant zéro, donc non concluant", () => {
    // Le choix prudent : un intervalle inconnu ne doit jamais autoriser une conclusion.
    assert.equal(
      containsZero({ value: 1, low: Number.NaN, high: Number.NaN, level: 0.95, method: "b" }),
      true,
    );
  });
});
