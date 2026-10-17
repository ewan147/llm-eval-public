import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareCost, computeCost } from "../core/cost.ts";
import type { CaseRecord } from "../core/types.ts";

const rec = (
  correct: boolean,
  cost?: { eur?: number; latencyMs?: number; inputTokens?: number; outputTokens?: number },
  error?: string,
): CaseRecord => ({
  itemId: Math.random().toString(36).slice(2),
  category: "",
  input: {},
  prediction: cost ? { cost } : {},
  truth: {},
  correct,
  error,
});

describe("computeCost", () => {
  it("divise par les réponses CORRECTES, pas par le nombre de cas", () => {
    // 10 cas à 1 € chacun, 5 corrects → 2 € par réponse correcte, pas 1 €.
    // C'est toute la différence : le coût par appel ne dit rien, le coût par réponse
    // correcte punit deux fois une erreur — on l'a payée et elle ne compte pas.
    const cases = [
      ...Array.from({ length: 5 }, () => rec(true, { eur: 1 })),
      ...Array.from({ length: 5 }, () => rec(false, { eur: 1 })),
    ];
    const c = computeCost(cases);
    assert.equal(c.totalEur, 10);
    assert.equal(c.correct, 5);
    assert.equal(c.eurPerCorrect, 2);
  });

  it("un modèle deux fois plus cher et un peu meilleur peut coûter plus par réponse correcte", () => {
    const pasCher = computeCost([
      ...Array.from({ length: 9 }, () => rec(true, { eur: 1 })),
      rec(false, { eur: 1 }),
    ]);
    const cher = computeCost([
      ...Array.from({ length: 10 }, () => rec(true, { eur: 4 })),
    ]);
    assert.ok(Math.abs(pasCher.eurPerCorrect! - 10 / 9) < 1e-9);
    assert.equal(cher.eurPerCorrect, 4);
    assert.ok(cher.eurPerCorrect! > pasCher.eurPerCorrect! * 3, "100 % de réussite ne rachète pas 4× le prix");
  });

  it("CAS LIMITE aucune réponse correcte : coût infini, et c'est le bon résultat", () => {
    const c = computeCost(Array.from({ length: 5 }, () => rec(false, { eur: 2 })));
    assert.equal(c.eurPerCorrect, Number.POSITIVE_INFINITY);
    assert.ok(c.reservations.some((r) => /infini/.test(r)));
  });

  it("CAS LIMITE aucun coût déclaré : tout est null, et la réserve le dit fortement", () => {
    const c = computeCost(Array.from({ length: 5 }, () => rec(true)));
    assert.equal(c.n, 0);
    assert.equal(c.totalEur, null);
    assert.equal(c.eurPerCorrect, null);
    assert.ok(c.reservations.some((r) => /le modèle le plus cher gagne par défaut/.test(r)));
  });

  it("signale une couverture partielle plutôt que de rendre un total qui a l'air complet", () => {
    const c = computeCost([rec(true, { eur: 1 }), rec(true), rec(true), rec(true)]);
    assert.equal(c.coverage, 0.25);
    assert.ok(c.reservations.some((r) => /partiel/.test(r)));
  });

  it("exclut les cas en erreur du dénominateur de couverture", () => {
    const c = computeCost([rec(true, { eur: 1 }), rec(false, undefined, "panne")]);
    assert.equal(c.total, 1);
    assert.equal(c.coverage, 1);
  });

  it("additionne jetons d'entrée et de sortie", () => {
    const c = computeCost([
      rec(true, { inputTokens: 100, outputTokens: 50 }),
      rec(true, { inputTokens: 200, outputTokens: 50 }),
    ]);
    assert.equal(c.totalInputTokens, 300);
    assert.equal(c.totalOutputTokens, 100);
    assert.equal(c.tokensPerCorrect, 200);
  });

  it("la médiane de latence résiste à un blocage isolé", () => {
    const c = computeCost([
      rec(true, { latencyMs: 100 }),
      rec(true, { latencyMs: 110 }),
      rec(true, { latencyMs: 120 }),
      rec(true, { latencyMs: 300000 }),
    ]);
    assert.equal(c.medianLatencyMs, 115);
    assert.ok(c.msPerCorrect! > 70000, "la moyenne, elle, est ruinée par le blocage");
  });

  it("CAS LIMITE aucun cas", () => {
    const c = computeCost([]);
    assert.equal(c.n, 0);
    assert.equal(c.coverage, 0);
    assert.ok(c.reservations.length > 0);
  });
});

describe("compareCost — le croisement qualité × prix", () => {
  const withCost = (n: number, correct: number, eur: number) =>
    computeCost([
      ...Array.from({ length: correct }, () => rec(true, { eur })),
      ...Array.from({ length: n - correct }, () => rec(false, { eur })),
    ]);

  it("DÉTECTE le cas le plus fréquent et le plus coûteux : plus cher sans gain démontré", () => {
    const c = compareCost({
      before: withCost(100, 80, 1),
      after: withCost(100, 82, 4),
      qualityDelta: 0.02,
      qualitySignificant: false,
    });
    assert.equal(c.verdict, "PLUS CHER SANS GAIN");
    assert.match(c.statement, /différence qu'on n'a pas prouvée/);
  });

  it("reconnaît une économie sans contrepartie", () => {
    const c = compareCost({
      before: withCost(100, 80, 4),
      after: withCost(100, 80, 1),
      qualityDelta: 0,
      qualitySignificant: false,
    });
    assert.equal(c.verdict, "MOINS CHER, QUALITÉ ÉQUIVALENTE");
    assert.ok(c.ratio! < 0.3);
  });

  it("nomme l'arbitrage quand le gain est réel mais coûteux", () => {
    const c = compareCost({
      before: withCost(100, 70, 1),
      after: withCost(100, 90, 5),
      qualityDelta: 0.2,
      qualitySignificant: true,
    });
    assert.equal(c.verdict, "PLUS CHER MAIS MEILLEUR");
    assert.match(c.statement, /appartient à celui qui paie/);
  });

  it("un gain démontré sans surcoût ne demande aucun arbitrage", () => {
    const c = compareCost({
      before: withCost(100, 70, 1),
      after: withCost(100, 90, 1),
      qualityDelta: 0.2,
      qualitySignificant: true,
    });
    assert.equal(c.verdict, "MOINS CHER ET MEILLEUR");
  });

  it("une dégradation démontrée ne se rachète pas par le prix", () => {
    const c = compareCost({
      before: withCost(100, 90, 5),
      after: withCost(100, 70, 1),
      qualityDelta: -0.2,
      qualitySignificant: true,
    });
    assert.equal(c.verdict, "PLUS CHER SANS GAIN");
    assert.match(c.statement, /pas de justification mesurable/);
  });

  it("CAS LIMITE coûts absents d'un côté : INCOMPARABLE, jamais un chiffre inventé", () => {
    const c = compareCost({
      before: computeCost([rec(true)]),
      after: withCost(10, 8, 1),
      qualityDelta: 0.1,
      qualitySignificant: true,
    });
    assert.equal(c.verdict, "INCOMPARABLE");
    assert.equal(c.ratio, null);
  });
});
