// Tests de bout en bout de l'orchestrateur, et surtout du REFUS.
//
// Le refus est la caractéristique qui distingue ce pack des autres outils d'évaluation. S'il
// cessait de fonctionner, le pack redeviendrait un calculateur de métriques comme les autres.
// Ces tests sont donc les plus importants du dossier.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate } from "../core/evaluate.ts";
import { REFUSAL_HEADLINE } from "../core/guards.ts";
import type { Adapter, Outcome, Prediction } from "../core/types.ts";

interface Case {
  id: number;
  cat: string;
}

function makeAdapter(opts: {
  n: number;
  /** Confiance annoncée par le système. `null` = aucune confiance produite. */
  prob?: (i: number) => number | null;
  correct: (i: number) => boolean;
  baseline?: (i: number) => boolean;
  baselineProb?: (i: number) => number;
  category?: (i: number) => string;
  throwsOn?: (i: number) => boolean;
}): Adapter<Case> {
  const a: Adapter<Case> = {
    name: "adaptateur de test",
    async loadItems() {
      return Array.from({ length: opts.n }, (_, i) => ({ id: i, cat: opts.category?.(i) ?? "" }));
    },
    async predict(item): Promise<Prediction> {
      if (opts.throwsOn?.(item.id)) throw new Error("panne simulée");
      const p = opts.prob ? opts.prob(item.id) : 0.8;
      const out: Prediction = { pass: opts.correct(item.id) };
      if (p !== null) out.prob = p;
      return out;
    },
    async truth(): Promise<Outcome> {
      return { ok: true };
    },
  };
  if (opts.baseline) {
    a.baseline = async (item): Promise<Prediction> => {
      const out: Prediction = { pass: opts.baseline!(item.id) };
      if (opts.baselineProb) out.prob = opts.baselineProb(item.id);
      return out;
    };
  }
  if (opts.category) a.category = (item) => item.cat;
  return a;
}

const FAST = { bootstrapSamples: 200 };

describe("LE REFUS — sans référence, aucun verdict", () => {
  it("refuse et affiche la phrase exacte quand `baseline` n'est pas implémentée", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: (i) => i % 4 !== 0 }), FAST);
    assert.notEqual(r.refusal, null);
    assert.equal(r.refusal!.headline, REFUSAL_HEADLINE);
    assert.ok(r.headline.startsWith(REFUSAL_HEADLINE), "le refus doit ouvrir le verdict");
    assert.equal(r.contrastive, null);
  });

  it("calcule quand même les métriques descriptives", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: (i) => i % 4 !== 0 }), FAST);
    assert.equal(r.n, 200);
    assert.ok(r.binary);
    assert.ok(r.binary!.successRate.value > 0.7);
    assert.ok(r.probabilistic);
  });

  it("propose des références acceptées, pour qu'aucune excuse ne tienne", async () => {
    const r = await evaluate(makeAdapter({ n: 50, correct: () => true }), FAST);
    assert.ok(r.refusal!.accepted.length >= 5);
    assert.ok(r.refusal!.accepted.some((a) => /précédente/.test(a)));
  });

  it("le refus est en TÊTE des réserves, pas noyé au milieu", async () => {
    const r = await evaluate(makeAdapter({ n: 200, correct: () => true }), FAST);
    assert.match(r.reservations[0], /AUCUNE RÉFÉRENCE CONTRASTIVE/);
  });

  it("battre les planchers gratuits ne lève PAS le refus", async () => {
    // Le point central du pack : le système d'origine battait le taux de base de 29,2 % de skill
    // et ne valait rien. Ici, un système qui discrimine RÉELLEMENT — il annonce 95 % sur une
    // moitié qu'il réussit toujours, 50 % sur une moitié qu'il réussit une fois sur deux.
    const r = await evaluate(
      makeAdapter({
        n: 400,
        prob: (i) => (i % 2 === 0 ? 0.95 : 0.5),
        correct: (i) => (i % 2 === 0 ? true : i % 4 === 1),
      }),
      FAST,
    );
    assert.equal(r.trivial.beatsClimatology, true, "il bat bien le plancher gratuit");
    assert.ok(r.probabilistic!.decomposition.skill > 0.1, "il a un vrai pouvoir discriminant");
    assert.notEqual(r.refusal, null, "et le refus tient quand même");
    assert.equal(r.contrastive, null);
  });

  it("fournir une référence lève le refus", async () => {
    const r = await evaluate(
      makeAdapter({ n: 200, correct: (i) => i % 4 !== 0, baseline: (i) => i % 2 !== 0 }),
      FAST,
    );
    assert.equal(r.refusal, null);
    assert.notEqual(r.contrastive, null);
  });
});

describe("verdicts", () => {
  it("BAT quand la différence est nette, même sur un échantillon modeste", async () => {
    // Le seuil d'échantillon ne doit bloquer QUE les conclusions négatives.
    const r = await evaluate(
      makeAdapter({ n: 60, correct: () => true, baseline: (i) => i % 3 !== 0 }),
      FAST,
    );
    assert.equal(r.contrastive!.verdict, "BAT");
  });

  it("MOINS BON quand la référence gagne nettement", async () => {
    const r = await evaluate(
      makeAdapter({ n: 60, correct: (i) => i % 3 !== 0, baseline: () => true }),
      FAST,
    );
    assert.equal(r.contrastive!.verdict, "MOINS BON");
    assert.match(r.headline, /MOINS BIEN/);
  });

  it("INDÉCIDABLE — et non ÉQUIVALENT — quand l'échantillon est trop mince", async () => {
    // Absence de preuve n'est pas preuve d'absence. C'est l'erreur que le pack existe pour éviter.
    const r = await evaluate(
      makeAdapter({ n: 40, correct: (i) => i % 7 !== 0, baseline: (i) => i % 6 !== 0 }),
      FAST,
    );
    assert.equal(r.contrastive!.verdict, "INDÉCIDABLE");
    assert.match(r.contrastive!.statement, /pas assez puissant|n'en sait rien/);
  });

  it("ÉQUIVALENT seulement sur un échantillon suffisant sans différence détectée", async () => {
    const r = await evaluate(
      makeAdapter({ n: 400, correct: (i) => i % 5 !== 0, baseline: (i) => i % 5 !== 0 }),
      FAST,
    );
    assert.equal(r.contrastive!.verdict, "ÉQUIVALENT");
    assert.match(r.headline, /Sans valeur démontrée/);
  });
});

describe("garde-fous d'échantillon", () => {
  it("nomme les tranches et catégories écartées, au lieu de les taire", async () => {
    const r = await evaluate(
      makeAdapter({
        n: 120,
        correct: () => true,
        category: (i) => (i < 5 ? "rare" : "courante"),
      }),
      FAST,
    );
    const rare = r.underpowered.find((u) => u.label === "rare");
    assert.ok(rare, "la catégorie rare doit apparaître nommée");
    assert.equal(rare!.n, 5);
    assert.equal(rare!.required, 30);
  });

  it("refuse tout verdict sous le seuil d'observations", async () => {
    const r = await evaluate(makeAdapter({ n: 5, correct: () => true }), FAST);
    assert.match(r.headline, /Pas encore mesurable/);
  });

  it("CAS LIMITE n = 0 : ne lève pas, et le dit", async () => {
    const r = await evaluate(makeAdapter({ n: 0, correct: () => true }), FAST);
    assert.equal(r.n, 0);
    assert.match(r.headline, /Aucun cas évaluable/);
    assert.ok(r.reservations.length > 0);
  });

  it("CAS LIMITE n = 1", async () => {
    const r = await evaluate(makeAdapter({ n: 1, correct: () => true }), FAST);
    assert.equal(r.n, 1);
    assert.match(r.headline, /Pas encore mesurable/);
  });
});

describe("cas limites de probabilité", () => {
  it("CAS LIMITE probabilités 0 et 1 : acceptées, log-loss finie", async () => {
    const r = await evaluate(
      makeAdapter({ n: 100, prob: (i) => (i % 2 === 0 ? 0 : 1), correct: (i) => i % 2 === 1 }),
      FAST,
    );
    assert.ok(Number.isFinite(r.probabilistic!.logLoss));
    assert.ok(Number.isFinite(r.probabilistic!.brier.value));
  });

  it("REJETTE une probabilité hors de [0, 1] au lieu de la propager", async () => {
    const r = await evaluate(makeAdapter({ n: 10, prob: () => 1.5, correct: () => true }), FAST);
    assert.equal(r.errors, 10);
    assert.equal(r.n, 0);
  });

  it("sans confiance produite : pas de bloc probabiliste, et une réserve explicite", async () => {
    const r = await evaluate(
      makeAdapter({ n: 200, prob: () => null, correct: (i) => i % 3 !== 0 }),
      FAST,
    );
    assert.equal(r.probabilistic, null);
    assert.ok(r.binary);
    assert.ok(r.reservations.some((x) => /aucune confiance chiffrée/i.test(x)));
  });

  it("confiance constante : signalée comme résolution nulle PAR CONSTRUCTION", async () => {
    const r = await evaluate(
      makeAdapter({ n: 200, prob: () => 0.75, correct: (i) => i % 4 !== 0 }),
      FAST,
    );
    assert.equal(r.probabilistic!.spread.distinct, 1);
    assert.ok(r.reservations.some((x) => /CONSTRUCTION/.test(x)));
  });
});

describe("robustesse", () => {
  it("un cas qui lève n'interrompt pas l'évaluation, et est compté", async () => {
    const r = await evaluate(
      makeAdapter({ n: 100, correct: () => true, throwsOn: (i) => i < 7 }),
      FAST,
    );
    assert.equal(r.errors, 7);
    assert.equal(r.n, 93);
    assert.ok(r.reservations.some((x) => /échoué pendant l'évaluation/.test(x)));
  });

  it("une référence qui ne répond pas est comptée NON APPARIÉE, jamais en erreur", async () => {
    const adapter = makeAdapter({ n: 200, correct: (i) => i % 4 !== 0, baseline: () => true });
    // La référence se tait sur la moitié des cas.
    adapter.baseline = async (item) => (item.id % 2 === 0 ? {} : { pass: true });
    const r = await evaluate(adapter, FAST);
    assert.equal(r.errors, 0);
    assert.equal(r.contrastive!.unmatched, 100);
    assert.equal(r.contrastive!.n, 100);
  });

  it("CAS LIMITE catégorie vide : ne casse rien", async () => {
    const r = await evaluate(
      makeAdapter({ n: 60, correct: () => true, category: () => "" }),
      FAST,
    );
    assert.ok(r.binary);
    assert.equal(r.binary!.byCategory.length, 1);
    assert.equal(r.binary!.byCategory[0].category, "");
  });

  it("une `category` qui lève est absorbée", async () => {
    const adapter = makeAdapter({ n: 40, correct: () => true });
    adapter.category = () => {
      throw new Error("catégorie cassée");
    };
    const r = await evaluate(adapter, FAST);
    assert.equal(r.errors, 0);
  });
});

describe("réserves et reproductibilité", () => {
  it("la liste des réserves n'est JAMAIS vide", async () => {
    for (const n of [0, 1, 60, 400]) {
      const r = await evaluate(
        makeAdapter({ n, correct: (i) => i % 3 !== 0, baseline: (i) => i % 4 !== 0 }),
        FAST,
      );
      assert.ok(r.reservations.length > 0, `réserves vides pour n = ${n}`);
    }
  });

  it("l'empreinte des données est stable d'une exécution à l'autre", async () => {
    const mk = () => makeAdapter({ n: 50, correct: (i) => i % 3 !== 0 });
    const a = await evaluate(mk(), FAST);
    const b = await evaluate(mk(), FAST);
    assert.equal(a.reproducibility.dataFingerprint, b.reproducibility.dataFingerprint);
  });

  it("l'empreinte change quand le JEU DE TEST change", async () => {
    const a = await evaluate(makeAdapter({ n: 50, correct: () => true }), FAST);
    const b = await evaluate(makeAdapter({ n: 51, correct: () => true }), FAST);
    assert.notEqual(a.reproducibility.dataFingerprint, b.reproducibility.dataFingerprint);
  });

  it("l'empreinte NE change PAS quand seules les prédictions changent", async () => {
    // C'est la propriété qui rend `compare` utilisable : deux versions d'un système évaluées sur
    // le même jeu doivent partager la même empreinte, sinon toute dérive serait attribuée à un
    // changement de jeu de test.
    const a = await evaluate(makeAdapter({ n: 50, correct: (i) => i % 3 !== 0 }), FAST);
    const b = await evaluate(makeAdapter({ n: 50, correct: (i) => i % 4 !== 0 }), FAST);
    assert.equal(a.reproducibility.dataFingerprint, b.reproducibility.dataFingerprint);
  });

  it("consigne les seuils employés, pour qu'un lecteur puisse les contester", async () => {
    const r = await evaluate(makeAdapter({ n: 40, correct: () => true }), {
      ...FAST,
      minObs: 12,
      seed: 99,
    });
    assert.equal(r.reproducibility.minObs, 12);
    assert.equal(r.reproducibility.seed, 99);
    assert.equal(r.reproducibility.bootstrapSamples, 200);
  });
});

describe("défauts", () => {
  it("classe l'erreur confiante en critique, avant l'erreur hésitante", async () => {
    const r = await evaluate(
      makeAdapter({
        n: 60,
        prob: (i) => (i === 0 ? 0.95 : 0.55),
        correct: (i) => i > 1,
      }),
      FAST,
    );
    assert.equal(r.defects[0].severity, "critique");
    assert.match(r.defects[0].kind, /confiante/);
  });

  it("classe en critique une erreur là où la référence avait raison", async () => {
    const r = await evaluate(
      makeAdapter({
        n: 60,
        prob: () => 0.5,
        correct: (i) => i !== 3,
        baseline: () => true,
      }),
      FAST,
    );
    const reg = r.defects.find((d) => /régression/.test(d.kind));
    assert.ok(reg, "une régression vis-à-vis de la référence doit être signalée");
    assert.equal(reg!.severity, "critique");
  });

  it("chaque défaut porte l'entrée, l'obtenu et l'attendu", async () => {
    const r = await evaluate(
      makeAdapter({ n: 60, prob: () => 0.9, correct: (i) => i !== 5 }),
      FAST,
    );
    const d = r.defects[0];
    assert.notEqual(d.input, undefined);
    assert.notEqual(d.got, undefined);
    assert.notEqual(d.expected, undefined);
    assert.ok(d.why.length > 10);
  });
});
