import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agreement, confusion, falseAccepts, type AgreementPair } from "../core/agreement.ts";
import { pipelineAnchoring, ablationInstruction } from "../core/pipeline.ts";

const p = (itemId: string, judge: string, human: string): AgreementPair => ({ itemId, judge, human });

describe("agreement — le kappa démasque ce que l'accord brut cache", () => {
  it("DÉMASQUE un juge qui répond toujours la classe majoritaire", () => {
    // C'est le test central de ce fichier, et le pendant exact de « battre le taux de base ».
    // 90 % de bonnes réponses, un juge qui dit toujours « bonne » : 90 % d'accord brut, kappa nul.
    const pairs = Array.from({ length: 100 }, (_, i) =>
      p(`i${i}`, "bonne", i < 90 ? "bonne" : "mauvaise"),
    );
    const a = agreement(pairs);
    assert.ok(Math.abs(a.rawAgreement - 0.9) < 1e-9, "90 % d'accord brut, très flatteur");
    assert.ok(Math.abs(a.kappa) < 1e-9, "et un kappa nul : le juge n'apporte rien");
    assert.match(a.interpretation, /N'APPORTE RIEN/);
  });

  it("reconnaît un juge réellement d'accord", () => {
    const pairs = Array.from({ length: 100 }, (_, i) => {
      const human = i % 2 === 0 ? "bonne" : "mauvaise";
      return p(`i${i}`, i < 95 ? human : human === "bonne" ? "mauvaise" : "bonne", human);
    });
    const a = agreement(pairs);
    assert.ok(a.kappa > 0.85);
    assert.match(a.interpretation, /fort|substantiel/);
  });

  it("sanctionne un juge en désaccord systématique", () => {
    const pairs = Array.from({ length: 100 }, (_, i) =>
      p(`i${i}`, i % 2 === 0 ? "mauvaise" : "bonne", i % 2 === 0 ? "bonne" : "mauvaise"),
    );
    assert.ok(agreement(pairs).kappa < 0);
  });

  it("REFUSE d'interpréter sous 30 cas", () => {
    const pairs = Array.from({ length: 10 }, (_, i) => p(`i${i}`, "bonne", "bonne"));
    assert.match(agreement(pairs).interpretation, /pas interprétable/);
  });

  it("CAS LIMITE aucune paire", () => {
    const a = agreement([]);
    assert.equal(a.n, 0);
    assert.equal(a.kappa, 0);
  });

  it("CAS LIMITE accord parfait sur une seule classe : kappa indéfini, ramené à 0", () => {
    // Les deux annotateurs disent toujours la même chose : l'accord attendu vaut 1, la formule
    // diviserait par zéro. Rendre 0 plutôt que NaN, et le dire.
    const pairs = Array.from({ length: 50 }, (_, i) => p(`i${i}`, "bonne", "bonne"));
    const a = agreement(pairs);
    assert.equal(a.rawAgreement, 1);
    assert.ok(Number.isFinite(a.kappa));
    assert.equal(a.kappa, 0);
  });

  it("expose la distribution des étiquettes, qui explique l'écart", () => {
    const pairs = Array.from({ length: 100 }, (_, i) => p(`i${i}`, "bonne", i < 90 ? "bonne" : "mauvaise"));
    const a = agreement(pairs);
    const bonne = a.labelDistribution.find((d) => d.label === "bonne")!;
    assert.equal(bonne.judgeShare, 1);
    assert.ok(Math.abs(bonne.humanShare - 0.9) < 1e-9);
  });
});

describe("falseAccepts — la seule erreur réellement coûteuse", () => {
  it("compte les réponses fausses validées par le juge", () => {
    const pairs = [
      p("a", "bonne", "bonne"),
      p("b", "bonne", "mauvaise"),
      p("c", "mauvaise", "mauvaise"),
      p("d", "bonne", "mauvaise"),
    ];
    const fa = falseAccepts(pairs, "bonne");
    assert.equal(fa.n, 2);
    assert.deepEqual(fa.itemIds, ["b", "d"]);
    assert.ok(Math.abs(fa.rate - 2 / 3) < 1e-9, "rapporté aux réponses réellement fausses");
  });

  it("CAS LIMITE aucune réponse fausse : taux nul, pas de division par zéro", () => {
    const fa = falseAccepts([p("a", "bonne", "bonne")], "bonne");
    assert.equal(fa.n, 0);
    assert.equal(fa.rate, 0);
  });
});

describe("confusion", () => {
  it("dit AVEC QUOI le juge confond", () => {
    const rows = confusion([
      p("a", "bonne", "mauvaise"),
      p("b", "bonne", "mauvaise"),
      p("c", "bonne", "bonne"),
    ]);
    const top = rows[0];
    assert.equal(top.human, "mauvaise");
    assert.equal(top.judge, "bonne");
    assert.equal(top.n, 2);
  });

  it("CAS LIMITE aucune paire", () => {
    assert.deepEqual(confusion([]), []);
  });
});

describe("pipelineAnchoring", () => {
  it("détecte un étage qui reproduit son prédécesseur", () => {
    const base = Array.from({ length: 60 }, (_, i) => (i % 40) / 40);
    const r = pipelineAnchoring([
      { name: "a", values: base, cost: 1 },
      { name: "b", values: base.map((v, i) => v + ((i % 3) - 1) * 0.001), cost: 9 },
    ]);
    assert.deepEqual(r.redundantStages, ["b"]);
    assert.ok(r.wastedCostShare !== null && r.wastedCostShare > 0.85);
    assert.match(r.verdict, /RELAIS/);
  });

  it("ne signale rien quand chaque étage change la sortie", () => {
    const r = pipelineAnchoring([
      { name: "a", values: Array.from({ length: 60 }, (_, i) => (i * 7) % 100 / 100) },
      { name: "b", values: Array.from({ length: 60 }, (_, i) => (i * 31) % 100 / 100) },
    ]);
    assert.deepEqual(r.redundantStages, []);
    assert.match(r.verdict, /Aucun étage n'est un simple relais/);
  });

  it("formule une ablation testable plutôt qu'un jugement", () => {
    const base = Array.from({ length: 60 }, (_, i) => (i % 40) / 40);
    const r = pipelineAnchoring([
      { name: "a", values: base },
      { name: "b", values: base.map((v) => v + 0.001) },
    ]);
    assert.match(ablationInstruction(r), /baseline.*SANS l'étage/s);
    assert.match(ablationInstruction(r), /INDÉCIDABLE signifie qu'il faut plus de cas/);
  });

  it("CAS LIMITE un seul étage : rien à comparer, et le dit", () => {
    const r = pipelineAnchoring([{ name: "a", values: [0.1, 0.2] }]);
    assert.equal(r.links.length, 0);
    assert.match(r.verdict, /au moins deux étages/);
  });

  it("CAS LIMITE aucune valeur", () => {
    const r = pipelineAnchoring([{ name: "a", values: [] }, { name: "b", values: [] }]);
    assert.equal(r.n, 0);
    assert.match(r.verdict, /Aucune valeur/);
  });

  it("s'aligne sur le plus court étage plutôt que de lever", () => {
    const r = pipelineAnchoring([
      { name: "a", values: [0.1, 0.2, 0.3] },
      { name: "b", values: [0.1, 0.2] },
    ]);
    assert.equal(r.n, 2);
  });
});
