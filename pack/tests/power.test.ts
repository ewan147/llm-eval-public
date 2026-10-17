import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  achievedPower,
  planStatement,
  requiredForMeanDifference,
  requiredForPairedProportion,
} from "../core/power.ts";

describe("requiredForMeanDifference", () => {
  it("demande PLUS de cas pour un écart plus petit", () => {
    const gros = requiredForMeanDifference({ sd: 0.1, effect: 0.05, available: 0 });
    const petit = requiredForMeanDifference({ sd: 0.1, effect: 0.005, available: 0 });
    assert.ok(petit.required > gros.required * 50, "l'effort croît comme l'inverse du carré");
  });

  it("demande PLUS de cas quand la variance est plus grande", () => {
    const calme = requiredForMeanDifference({ sd: 0.05, effect: 0.01, available: 0 });
    const bruyant = requiredForMeanDifference({ sd: 0.2, effect: 0.01, available: 0 });
    assert.ok(bruyant.required > calme.required);
  });

  it("compte correctement ce qu'il reste à ajouter", () => {
    const p = requiredForMeanDifference({ sd: 0.1, effect: 0.05, available: 20 });
    assert.equal(p.missing, Math.max(0, p.required - 20));
  });

  it("dit que l'échantillon suffit quand c'est le cas", () => {
    const p = requiredForMeanDifference({ sd: 0.1, effect: 0.05, available: 100000 });
    assert.equal(p.missing, 0);
    assert.match(planStatement(p), /suffit/);
  });

  it("CAS LIMITE écart nul : refuse de donner un nombre, et explique pourquoi", () => {
    // Aucun échantillon ne permet de détecter un effet inexistant. Rendre « l'infini » serait
    // inutile ; rendre un grand nombre serait un mensonge.
    const p = requiredForMeanDifference({ sd: 0.1, effect: 0, available: 50 });
    assert.equal(Number.isFinite(p.required), false);
    assert.match(p.assumption, /écart MINIMAL/);
  });

  it("CAS LIMITE variance nulle", () => {
    const p = requiredForMeanDifference({ sd: 0, effect: 0.05, available: 50 });
    assert.equal(Number.isFinite(p.required), false);
  });
});

describe("requiredForPairedProportion — seuls les discordants comptent", () => {
  it("demande beaucoup de cas quand les erreurs sont majoritairement communes", () => {
    // Deux systèmes qui échouent presque toujours sur les mêmes cas : peu de discordants,
    // donc énormément de cas nécessaires pour les séparer.
    const peuDiscordants = requiredForPairedProportion({
      discordantRate: 0.04,
      difference: 0.02,
      available: 40,
    });
    const beaucoupDiscordants = requiredForPairedProportion({
      discordantRate: 0.4,
      difference: 0.2,
      available: 40,
    });
    assert.ok(peuDiscordants.required > beaucoupDiscordants.required);
  });

  it("CAS LIMITE aucun cas discordant : explique qu'aucun volume n'y changera rien", () => {
    // C'est le diagnostic le plus utile du module : ce n'est pas un problème d'échantillon,
    // c'est que les deux systèmes font la même chose.
    const p = requiredForPairedProportion({ discordantRate: 0, difference: 0, available: 500 });
    assert.equal(Number.isFinite(p.required), false);
    assert.match(p.assumption, /même chose|Aucun cas discordant/);
  });

  it("CAS LIMITE écart supérieur au taux de discordants : incohérent, refusé", () => {
    const p = requiredForPairedProportion({
      discordantRate: 0.1,
      difference: 0.5,
      available: 40,
    });
    assert.equal(Number.isFinite(p.required), false);
  });

  it("rend un nombre plausible sur un cas ordinaire", () => {
    const p = requiredForPairedProportion({
      discordantRate: 0.1,
      difference: 0.1,
      available: 40,
    });
    assert.ok(p.required > 40 && p.required < 500, `taille inattendue : ${p.required}`);
    assert.match(planStatement(p), /cas pour trancher/);
  });
});

describe("achievedPower", () => {
  it("croît avec la taille de l'échantillon", () => {
    const petit = achievedPower({ n: 40, sd: 0.3, effect: 0.1 });
    const grand = achievedPower({ n: 400, sd: 0.3, effect: 0.1 });
    assert.ok(grand > petit);
  });

  it("reste dans [0, 1]", () => {
    for (const n of [2, 10, 100, 10000]) {
      const p = achievedPower({ n, sd: 0.3, effect: 0.5 });
      assert.ok(p >= 0 && p <= 1, `hors bornes pour n=${n} : ${p}`);
    }
  });

  it("CAS LIMITE n = 1 ou écart nul : puissance nulle, jamais NaN", () => {
    assert.equal(achievedPower({ n: 1, sd: 0.3, effect: 0.1 }), 0);
    assert.equal(achievedPower({ n: 100, sd: 0.3, effect: 0 }), 0);
    assert.equal(achievedPower({ n: 100, sd: 0, effect: 0.1 }), 0);
  });

  it("un échantillon largement suffisant approche 1", () => {
    assert.ok(achievedPower({ n: 100000, sd: 0.3, effect: 0.1 }) > 0.99);
  });
});
