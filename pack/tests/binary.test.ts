import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mcNemar, successByCategory, successRate, wilson } from "../core/binary.ts";
import type { Trial } from "../core/types.ts";

const t = (itemId: string, pass: boolean, category = ""): Trial => ({ itemId, category, pass });

describe("successRate", () => {
  it("CAS LIMITE n = 0 : rend 0 sans lever", () => {
    assert.equal(successRate([]), 0);
  });
});

describe("wilson — l'intervalle qui empêche de croire à la perfection", () => {
  it("20 réussites sur 20 ne prouvent PAS 100 % de fiabilité", () => {
    // C'est le test le plus important de ce fichier. L'intervalle normal donnerait [100 %, 100 %]
    // et affirmerait la perfection à partir de 20 cas.
    const i = wilson(20, 20);
    assert.equal(i.value, 1);
    assert.ok(i.low < 0.85, `borne basse trop optimiste : ${i.low}`);
    assert.ok(i.low > 0.8);
    assert.equal(i.high, 1);
  });

  it("0 réussite sur 20 ne prouve pas 0 %", () => {
    const i = wilson(0, 20);
    assert.equal(i.value, 0);
    assert.equal(i.low, 0);
    assert.ok(i.high > 0.15);
  });

  it("CAS LIMITE n = 0 : intervalle totalement ouvert, jamais NaN", () => {
    const i = wilson(0, 0);
    assert.equal(i.low, 0);
    assert.equal(i.high, 1);
    assert.ok(Number.isFinite(i.value));
  });

  it("CAS LIMITE n = 1", () => {
    const i = wilson(1, 1);
    assert.ok(Number.isFinite(i.low) && Number.isFinite(i.high));
    assert.ok(i.low < 0.3, "un seul succès ne prouve rien");
  });

  it("l'intervalle se resserre quand l'échantillon grandit", () => {
    const petit = wilson(8, 10);
    const grand = wilson(800, 1000);
    assert.ok(grand.high - grand.low < petit.high - petit.low);
  });

  it("reste dans [0, 1] quel que soit le cas", () => {
    for (const [k, n] of [[0, 3], [3, 3], [1, 2], [50, 100]] as const) {
      const i = wilson(k, n);
      assert.ok(i.low >= 0 && i.high <= 1, `hors bornes pour ${k}/${n}`);
    }
  });
});

describe("mcNemar — seuls les cas discordants portent de l'information", () => {
  it("deux systèmes qui échouent sur LES MÊMES cas sont indiscernables", () => {
    // 80 % et 80 % avec des erreurs identiques : aucun cas discordant, rien à conclure.
    const sys = Array.from({ length: 100 }, (_, i) => t(`i${i}`, i % 5 !== 0));
    const base = Array.from({ length: 100 }, (_, i) => t(`i${i}`, i % 5 !== 0));
    const m = mcNemar(sys, base);
    assert.equal(m.systemOnly, 0);
    assert.equal(m.baselineOnly, 0);
    assert.equal(m.significant, false);
    assert.equal(m.pValue, 1);
  });

  it("détecte une différence nette quand les erreurs sont disjointes", () => {
    const sys = Array.from({ length: 100 }, (_, i) => t(`i${i}`, i >= 5));
    const base = Array.from({ length: 100 }, (_, i) => t(`i${i}`, i >= 30));
    const m = mcNemar(sys, base);
    assert.equal(m.systemOnly, 25);
    assert.equal(m.baselineOnly, 0);
    assert.ok(m.pValue < 0.001);
    assert.equal(m.significant, true);
    assert.ok(m.difference > 0);
  });

  it("REFUSE de conclure sous le nombre minimal de cas discordants", () => {
    // 4 cas discordants tous favorables : p = 2 × (1/2)^4 = 0,125. Pas significatif, et le
    // garde-fou de discordants l'empêche de toute façon.
    const sys = Array.from({ length: 40 }, (_, i) => t(`i${i}`, true));
    const base = Array.from({ length: 40 }, (_, i) => t(`i${i}`, i >= 4));
    const m = mcNemar(sys, base);
    assert.equal(m.systemOnly, 4);
    assert.equal(m.baselineOnly, 0);
    assert.ok(Math.abs(m.pValue - 0.125) < 1e-9, `p attendu 0,125, obtenu ${m.pValue}`);
    assert.equal(m.significant, false);
  });

  it("bascule sur l'approximation chi2 au-delà de 60 discordants, sans discontinuité absurde", () => {
    const sys = Array.from({ length: 200 }, (_, i) => t(`i${i}`, i >= 20));
    const base = Array.from({ length: 200 }, (_, i) => t(`i${i}`, i < 20 || i >= 100));
    const m = mcNemar(sys, base);
    assert.equal(m.method, "chi2");
    assert.ok(m.pValue >= 0 && m.pValue <= 1);
  });

  it("n'apparie que les identifiants présents des deux côtés", () => {
    const m = mcNemar([t("a", true), t("b", false)], [t("a", false)]);
    assert.equal(m.n, 1);
  });

  it("CAS LIMITE aucun cas apparié", () => {
    const m = mcNemar([t("a", true)], [t("z", true)]);
    assert.equal(m.n, 0);
    assert.equal(m.significant, false);
    assert.equal(m.difference, 0);
  });

  it("la p-value reste dans [0, 1] sur des configurations extrêmes", () => {
    const sys = Array.from({ length: 50 }, (_, i) => t(`i${i}`, true));
    const base = Array.from({ length: 50 }, (_, i) => t(`i${i}`, false));
    const m = mcNemar(sys, base);
    assert.ok(m.pValue >= 0 && m.pValue <= 1, `p hors bornes : ${m.pValue}`);
    assert.equal(m.significant, true);
  });
});

describe("successByCategory", () => {
  it("trie du pire au meilleur et marque les segments non concluants", () => {
    const trials = [
      ...Array.from({ length: 40 }, (_, i) => t(`a${i}`, i < 36, "facile")),
      ...Array.from({ length: 40 }, (_, i) => t(`b${i}`, i < 20, "dur")),
      t("c1", false, "rare"),
    ];
    const byCat = successByCategory(trials, 30);
    assert.equal(byCat[0].category, "dur", "le pire segment CONCLUANT doit venir en premier");
    assert.equal(
      byCat[byCat.length - 1].category,
      "rare",
      "un segment non concluant ne doit jamais ouvrir le classement, même à 0 % de réussite",
    );
    assert.equal(byCat.find((c) => c.category === "rare")!.conclusive, false);
    assert.equal(byCat.find((c) => c.category === "facile")!.conclusive, true);
  });

  it("CAS LIMITE catégorie vide : regroupée sous la chaîne vide, jamais perdue", () => {
    const byCat = successByCategory([t("a", true), t("b", false)], 1);
    assert.equal(byCat.length, 1);
    assert.equal(byCat[0].category, "");
    assert.equal(byCat[0].n, 2);
  });

  it("CAS LIMITE aucun essai", () => {
    assert.deepEqual(successByCategory([], 30), []);
  });
});
