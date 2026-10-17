import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hitAtK,
  ndcgAtK,
  rankingDiagnosis,
  rankingScores,
  recallAtK,
  reciprocalRank,
  type RankedCase,
} from "../core/ranking.ts";

const c = (ranking: string[], relevant: string[]): RankedCase => ({
  itemId: "x",
  category: "",
  ranking,
  relevant: new Set(relevant),
});

describe("hitAtK", () => {
  it("vaut 1 si un pertinent est dans les k premiers", () => {
    assert.equal(hitAtK(c(["a", "b", "d"], ["d"]), 3), 1);
  });

  it("vaut 0 s'il est au-delà de k", () => {
    assert.equal(hitAtK(c(["a", "b", "d"], ["d"]), 2), 0);
  });

  it("CAS LIMITE classement vide", () => {
    assert.equal(hitAtK(c([], ["d"]), 5), 0);
  });
});

describe("recallAtK", () => {
  it("mesure la PART des pertinents retrouvés, là où hit@k se contente d'un seul", () => {
    // Deux pertinents, un seul dans les 3 premiers : hit@3 = 1 mais rappel@3 = 0,5.
    const rc = c(["a", "x", "b"], ["a", "z"]);
    assert.equal(hitAtK(rc, 3), 1);
    assert.equal(recallAtK(rc, 3), 0.5);
  });

  it("coïncide avec hit@k quand il n'y a qu'un pertinent", () => {
    const rc = c(["a", "b"], ["b"]);
    assert.equal(recallAtK(rc, 2), hitAtK(rc, 2));
  });

  it("CAS LIMITE aucun pertinent déclaré", () => {
    assert.equal(recallAtK(c(["a"], []), 5), 0);
  });
});

describe("reciprocalRank", () => {
  it("récompense la première position", () => {
    assert.equal(reciprocalRank(c(["a", "b", "c"], ["a"]), 3), 1);
    assert.equal(reciprocalRank(c(["b", "a", "c"], ["a"]), 3), 0.5);
    assert.ok(Math.abs(reciprocalRank(c(["b", "c", "a"], ["a"]), 3) - 1 / 3) < 1e-12);
  });

  it("vaut 0 si le pertinent est hors des k premiers", () => {
    assert.equal(reciprocalRank(c(["b", "c", "a"], ["a"]), 2), 0);
  });

  it("DISTINGUE ce que hit@k confond", () => {
    // Même hit@5, MRR très différent : c'est tout l'intérêt de la métrique.
    const premier = c(["a", "b", "c", "d", "e"], ["a"]);
    const dernier = c(["b", "c", "d", "e", "a"], ["a"]);
    assert.equal(hitAtK(premier, 5), hitAtK(dernier, 5));
    assert.ok(reciprocalRank(premier, 5) > reciprocalRank(dernier, 5) * 4);
  });
});

describe("ndcgAtK", () => {
  it("vaut 1 quand tous les pertinents sont en tête", () => {
    assert.ok(Math.abs(ndcgAtK(c(["a", "b", "x", "y"], ["a", "b"]), 4) - 1) < 1e-12);
  });

  it("vaut 0 quand aucun pertinent n'apparaît", () => {
    assert.equal(ndcgAtK(c(["x", "y"], ["a"]), 2), 0);
  });

  it("décroît quand le pertinent recule", () => {
    const a = ndcgAtK(c(["a", "x", "y"], ["a"]), 3);
    const b = ndcgAtK(c(["x", "a", "y"], ["a"]), 3);
    const d = ndcgAtK(c(["x", "y", "a"], ["a"]), 3);
    assert.ok(a > b && b > d);
  });

  it("reste dans [0, 1]", () => {
    for (const k of [1, 3, 10]) {
      const v = ndcgAtK(c(["a", "b", "c"], ["b", "c"]), k);
      assert.ok(v >= 0 && v <= 1, `hors bornes pour k=${k} : ${v}`);
    }
  });
});

describe("rankingScores", () => {
  it("CAS LIMITE aucun cas", () => {
    const s = rankingScores([], 5);
    assert.equal(s.n, 0);
    assert.equal(s.hitAtK, 0);
  });

  it("moyenne les quatre métriques", () => {
    const s = rankingScores([c(["a"], ["a"]), c(["x"], ["a"])], 1);
    assert.equal(s.n, 2);
    assert.equal(s.hitAtK, 0.5);
    assert.equal(s.mrr, 0.5);
  });
});

describe("rankingDiagnosis — le diagnostic que hit@k seul ne peut pas donner", () => {
  it("désigne le CLASSEMENT quand on trouve toujours mais jamais en tête", () => {
    // Le pertinent est systématiquement en 4e position : hit@5 parfait, MRR = 0,25.
    const cases = Array.from({ length: 20 }, () => c(["x", "y", "z", "a", "b"], ["a"]));
    const d = rankingDiagnosis(rankingScores(cases, 5));
    assert.match(d, /CLASSEMENT/);
    assert.match(d, /reclassement/);
  });

  it("désigne la RÉCUPÉRATION quand le pertinent est souvent absent", () => {
    const cases = Array.from({ length: 20 }, () => c(["x", "y", "z"], ["a"]));
    assert.match(rankingDiagnosis(rankingScores(cases, 3)), /RÉCUPÉRATION/);
  });

  it("ne signale rien d'anormal quand le pertinent est en tête", () => {
    const cases = Array.from({ length: 20 }, () => c(["a", "x"], ["a"]));
    assert.match(rankingDiagnosis(rankingScores(cases, 2)), /première position/);
  });

  it("CAS LIMITE aucun cas", () => {
    assert.match(rankingDiagnosis(rankingScores([], 5)), /Aucun cas/);
  });
});
