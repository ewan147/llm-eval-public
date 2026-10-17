// Tests du format public.
//
// Ils vérifient une seule chose, sous plusieurs angles : **le score public ne peut pas dire
// autre chose que le rapport d'entreprise**. C'est la règle de la phase 4, et sans ces tests elle
// ne serait qu'une intention.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate } from "../core/evaluate.ts";
import type { Adapter, Outcome, Prediction } from "../core/types.ts";
import { highlightsFromEval, renderHighlightsMarkdown } from "../report/highlights.ts";
import {
  checkConsistency,
  linkId,
  renderScorecardMarkdown,
  scorecardFromEval,
  simplify,
} from "../report/scorecard.ts";

interface Cas {
  id: number;
}

function makeAdapter(opts: {
  n: number;
  correct: (i: number) => boolean;
  prob?: (i: number) => number | null;
  baseline?: (i: number) => boolean;
  cost?: number;
}): Adapter<Cas> {
  const a: Adapter<Cas> = {
    name: "système de test",
    async loadItems() {
      return Array.from({ length: opts.n }, (_, i) => ({ id: i }));
    },
    async predict(item): Promise<Prediction> {
      const p = opts.prob ? opts.prob(item.id) : 0.8;
      const out: Prediction = { pass: opts.correct(item.id) };
      if (p !== null) out.prob = p;
      if (opts.cost !== undefined) out.cost = { eur: opts.cost };
      return out;
    },
    async truth(): Promise<Outcome> {
      return { ok: true };
    },
  };
  if (opts.baseline) {
    a.baseline = async (item): Promise<Prediction> => ({ pass: opts.baseline!(item.id) });
  }
  return a;
}

const FAST = { bootstrapSamples: 200 };

describe("scorecardFromEval — deux lectures, une seule mesure", () => {
  it("reprend TELLE QUELLE la phrase d'accroche du rapport d'entreprise", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: (i) => i % 4 !== 0 }), FAST);
    const card = scorecardFromEval(r);
    assert.equal(card.headline, r.headline, "aucune reformulation plus vendeuse n'est permise");
  });

  it("PROPAGE le refus : pas de verdict public là où le rapport refuse", async () => {
    // Le cas le plus important. Un format public qui afficherait « bon score » là où le rapport
    // technique refuse de conclure serait exactement le maquillage que la phase 4 interdit.
    const r = await evaluate(makeAdapter({ n: 200, correct: () => true }), FAST);
    const card = scorecardFromEval(r);
    const s = card.scores.find((x) => x.label.startsWith("Fait-il mieux"))!;
    assert.equal(s.insufficient, true);
    assert.equal(s.value, null);
    assert.equal(s.band, "inconnu");
    assert.deepEqual(checkConsistency(r, card), []);
  });

  it("affiche « pas assez de données » plutôt qu'un chiffre inventé", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: () => true, prob: () => null }), FAST);
    const card = scorecardFromEval(r);
    const s = card.scores.find((x) => x.label.startsWith("Sait-il quand"))!;
    assert.equal(s.value, null);
    assert.match(s.plain, /Impossible à dire/);
  });

  it("applique LE MÊME seuil d'échantillon que le rapport technique", async () => {
    // 10 cas : aucune tranche n'atteint 30. Le format public ne doit pas assouplir le seuil.
    const r = await evaluate(
      makeAdapter({ n: 10, correct: () => true, prob: () => 0.7 }),
      { ...FAST, minObs: 30 },
    );
    const s = scorecardFromEval(r).scores.find((x) => x.label.startsWith("Sait-il quand"))!;
    assert.equal(s.insufficient, true);
    assert.match(s.plain, /on ne l'assouplit pas/);
  });

  it("traduit un verdict ÉQUIVALENT en « non, pareil » — jamais en demi-succès", async () => {
    const r = await evaluate(
      makeAdapter({ n: 400, correct: (i) => i % 5 !== 0, baseline: (i) => i % 5 !== 0 }),
      FAST,
    );
    const s = scorecardFromEval(r).scores.find((x) => x.label.startsWith("Fait-il mieux"))!;
    assert.equal(s.value, "Non, pareil");
    assert.match(s.plain, /n'apporte rien de prouvé/);
  });

  it("chaque note porte sa correspondance vers une métrique réelle", async () => {
    const r = await evaluate(
      makeAdapter({ n: 200, correct: (i) => i % 3 !== 0, baseline: (i) => i % 2 !== 0 }),
      FAST,
    );
    for (const s of scorecardFromEval(r).scores) {
      assert.ok(s.mapping.length > 10, `note « ${s.label} » sans correspondance`);
      assert.match(s.mapping, /core\/|protocols\//, "la correspondance doit citer un module réel");
    }
  });

  it("les réserves ne sont jamais vides", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: () => true }), FAST);
    assert.ok(scorecardFromEval(r).caveats.length > 0);
  });

  it("le coût remonte quand il est déclaré", async () => {
    const r = await evaluate(
      makeAdapter({ n: 200, correct: (i) => i % 2 === 0, baseline: () => true, cost: 2 }),
      FAST,
    );
    const s = scorecardFromEval(r).scores.find((x) => x.label.startsWith("Combien coûte"))!;
    assert.equal(s.value, "4.00", "400 € pour 100 bonnes réponses");
  });
});

describe("linkId — la preuve que les deux formats portent sur la même exécution", () => {
  it("est identique pour la même empreinte et le même horodatage", () => {
    assert.equal(linkId("abc123", "2026-09-09T18:00:00Z"), linkId("abc123", "2026-09-09T18:00:00Z"));
  });
  it("diffère quand les données diffèrent", () => {
    assert.notEqual(linkId("abc123", "2026-09-09T18:00:00Z"), linkId("def456", "2026-09-09T18:00:00Z"));
  });
});

describe("checkConsistency — le garde-fou mécanique", () => {
  it("détecte une accroche publique différente de celle du rapport", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: () => true }), FAST);
    const card = scorecardFromEval(r);
    const falsifie = { ...card, headline: "Excellent modèle, à déployer sans réserve !" };
    const problems = checkConsistency(r, falsifie);
    assert.ok(problems.some((p) => /accroche/.test(p)));
  });

  it("détecte un verdict public là où le rapport refuse", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: () => true }), FAST);
    const card = scorecardFromEval(r);
    const falsifie = {
      ...card,
      scores: card.scores.map((s) =>
        s.label.startsWith("Fait-il mieux")
          ? { ...s, value: "Oui", band: "bon" as const, insufficient: false }
          : s,
      ),
    };
    assert.ok(checkConsistency(r, falsifie).some((p) => /REFUSE/.test(p)));
  });

  it("détecte une exécution qui n'est pas la même", async () => {
    const r = await evaluate(makeAdapter({ n: 100, correct: () => true }), FAST);
    const card = { ...scorecardFromEval(r), dataFingerprint: "autre" };
    assert.ok(checkConsistency(r, card).some((p) => /même exécution/.test(p)));
  });

  it("détecte la disparition de toutes les réserves", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: () => true }), FAST);
    const card = { ...scorecardFromEval(r), caveats: [] };
    assert.ok(checkConsistency(r, card).length > 0);
  });
});

describe("simplify — reformuler n'est pas supprimer", () => {
  it("traduit une réserve technique en phrase simple", () => {
    const out = simplify(["AUCUNE RÉFÉRENCE CONTRASTIVE. Les chiffres décrivent le système…"]);
    assert.equal(out.length, 1);
    assert.match(out[0], /point de comparaison/);
    assert.doesNotMatch(out[0], /CONTRASTIVE/);
  });

  it("conserve telle quelle une réserve sans traduction connue", () => {
    const inconnue = "Réserve inédite dont personne n'a prévu la reformulation.";
    assert.deepEqual(simplify([inconnue]), [inconnue]);
  });

  it("ne rend jamais une liste vide à partir d'une liste non vide", () => {
    const out = simplify(["a", "b", "c"]);
    assert.ok(out.length > 0);
  });

  it("déduplique deux réserves qui se traduisent pareil", () => {
    const out = simplify([
      "12 tranche(s) sous le seuil de 30 observations : …",
      "3 tranche(s) sous le seuil de 30 observations : …",
    ]);
    assert.equal(out.length, 1);
  });
});

describe("highlights — le bêtisier reproductible", () => {
  it("ne montre QUE des cas présents dans le rapport d'entreprise", async () => {
    const r = await evaluate(
      makeAdapter({ n: 60, correct: (i) => i > 3, prob: () => 0.9 }),
      FAST,
    );
    const reel = highlightsFromEval(r, "run-1");
    const ids = new Set(r.defects.map((d) => d.itemId));
    for (const h of reel.items) {
      assert.ok(ids.has(h.caseId), `${h.caseId} ne figure pas dans les défauts du rapport`);
    }
  });

  it("classe une régression vis-à-vis de la référence avant une simple erreur", async () => {
    const r = await evaluate(
      makeAdapter({ n: 60, correct: (i) => i !== 5, prob: () => 0.5, baseline: () => true }),
      FAST,
    );
    const reel = highlightsFromEval(r, "run-2");
    assert.equal(reel.items[0].rank, 1);
    assert.match(reel.items[0].why, /a répondu juste sur ce cas exact/);
  });

  it("classe une erreur confiante avant une erreur hésitante", async () => {
    const r = await evaluate(
      makeAdapter({ n: 60, correct: (i) => i > 1, prob: (i) => (i === 0 ? 0.95 : 0.5) }),
      FAST,
    );
    const reel = highlightsFromEval(r, "run-3");
    assert.equal(reel.items[0].rank, 2);
    assert.equal(reel.items[0].confidence, "95 %");
  });

  it("ne dépasse jamais cinq cas", async () => {
    const r = await evaluate(makeAdapter({ n: 100, correct: () => false, prob: () => 0.9 }), FAST);
    assert.ok(highlightsFromEval(r, "run-4").items.length <= 5);
  });

  it("REFUSE de compléter avec des cas faibles pour faire nombre", async () => {
    const r = await evaluate(
      makeAdapter({ n: 60, correct: (i) => i !== 0, prob: () => 0.9 }),
      FAST,
    );
    const reel = highlightsFromEval(r, "run-5");
    assert.equal(reel.items.length, 1);
    assert.match(reel.note, /on ne complète pas/);
  });

  it("le dit franchement quand il n'y a rien à montrer", async () => {
    const r = await evaluate(makeAdapter({ n: 60, correct: () => true, prob: () => 0.9 }), FAST);
    const reel = highlightsFromEval(r, "run-6");
    assert.equal(reel.items.length, 0);
    assert.match(reel.note, /Ce n'est pas un oubli/);
  });

  it("chaque cas porte entrée, sortie obtenue et sortie attendue", async () => {
    const r = await evaluate(
      makeAdapter({ n: 60, correct: (i) => i !== 7, prob: () => 0.9 }),
      FAST,
    );
    const h = highlightsFromEval(r, "run-7").items[0];
    assert.ok(h.input.length > 0);
    assert.ok(h.got.length > 0);
    assert.ok(h.expected.length > 0);
    assert.ok(h.why.length > 20);
  });
});

describe("rendu", () => {
  it("le Markdown du score public affiche la correspondance de chaque note", async () => {
    const r = await evaluate(
      makeAdapter({ n: 200, correct: (i) => i % 3 !== 0, baseline: (i) => i % 2 !== 0 }),
      FAST,
    );
    const md = renderScorecardMarkdown(scorecardFromEval(r));
    assert.match(md, /D'où vient chaque note/);
    assert.match(md, /core\//);
    assert.match(md, /Empreinte des données/);
    assert.match(md, /À savoir avant de citer/);
  });

  it("le bêtisier vide ne rend pas une page vide", async () => {
    const r = await evaluate(makeAdapter({ n: 60, correct: () => true, prob: () => 0.9 }), FAST);
    const md = renderHighlightsMarkdown(highlightsFromEval(r, "run-8"));
    assert.ok(md.length > 100);
    assert.match(md, /Ce n'est pas un oubli/);
  });
});
