// Les points d'amélioration.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUI EST VÉRIFIÉ ICI n'est pas « il donne des conseils », mais l'inverse : il n'en donne
// AUCUN qui ne soit porté par un chiffre du résultat.
//
// Un générateur de recommandations est l'endroit du pack le plus facile à rater. « Améliorez
// votre couverture de test », « surveillez la robustesse », « pensez au coût » : des phrases
// vraies partout, donc utiles nulle part, et que rien dans les données ne justifie. Elles
// empruntent l'autorité du rapport de mesure sans en avoir la substance — ce qui est pire que
// le silence.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate } from "../core/evaluate.ts";
import type { Adapter } from "../core/types.ts";
import { ameliorations, renderAmeliorationsMarkdown } from "../report/ameliorations.ts";

interface Cas { id: number }

function sain(over: Partial<Adapter<Cas>> = {}, n = 200): Adapter<Cas> {
  return {
    name: "sonde",
    loadItems: async () => Array.from({ length: n }, (_, i) => ({ id: i })),
    predict: async (it: Cas) => ({ label: it.id % 2 ? "a" : "b" }),
    truth: (it: Cas) => ({ label: (it.id * 7) % 3 ? "a" : "b" }),
    baseline: () => ({ label: "a" }),
    ...over,
  } as Adapter<Cas>;
}

const titres = (l: ReturnType<typeof ameliorations>) => l.map((a) => a.titre).join(" | ");

describe("chaque point cite la mesure qui le déclenche", () => {
  it("aucun point n'a de preuve vide", async () => {
    // La règle unique de ce module. Un point sans preuve est un conseil générique déguisé en
    // résultat de mesure.
    for (const adaptateur of [
      sain(),
      sain({ predict: async () => ({ label: "a" }) }),
      sain({ truth: () => ({ label: "a" }) }),
      sain({ baseline: () => { throw new Error("bogue"); } }),
      sain({ cluster: (it: Cas) => `j${it.id % 5}` }),
      sain({}, 40),
    ]) {
      for (const a of ameliorations(await evaluate(adaptateur))) {
        assert.ok(a.preuve.length > 0, `« ${a.titre} » n'a pas de preuve`);
        assert.ok(a.constat.length > 0, `« ${a.titre} » n'a pas de constat`);
      }
    }
  });
});

describe("les points sont déclenchés par les faits, pas par un catalogue", () => {
  it("l'absence de référence passe en tête et en BLOQUANT", async () => {
    const { baseline, ...sansRef } = sain();
    const l = ameliorations(await evaluate(sansRef as Adapter<Cas>));
    assert.equal(l[0].priorite, "bloquant");
    assert.match(l[0].titre, /référence/i);
  });

  it("une référence cassée donne un point différent de l'absence de référence", async () => {
    const l = ameliorations(await evaluate(sain({ baseline: () => { throw new Error("x"); } })));
    assert.match(titres(l), /Réparer la méthode/);
  });

  it("un score parfait déclenche la recherche de fuite", async () => {
    const l = ameliorations(await evaluate(
      sain({ predict: async (it: Cas) => ({ label: (it.id * 7) % 3 ? "a" : "b" }) }),
    ));
    assert.match(titres(l), /fuite/i);
    assert.equal(l[0].priorite, "bloquant");
  });

  it("une vérité constante vise le JEU DE TEST, pas le système", async () => {
    const l = ameliorations(await evaluate(sain({ truth: () => ({ label: "a" }) })));
    const point = l.find((a) => /Rééquilibrer/.test(a.titre));
    assert.ok(point);
    // Ce qu'il faut corriger est l'échantillon. Conseiller d'améliorer le système serait
    // exactement le mauvais conseil, et il serait suivi.
    assert.match(point.pourquoi, /l'échantillon/);
  });

  it("des observations groupées demandent plus de GRAPPES, pas plus de cas", async () => {
    const l = ameliorations(await evaluate(sain({ cluster: (it: Cas) => `j${it.id % 5}` })));
    const point = l.find((a) => /grappes/.test(a.titre));
    assert.ok(point);
    assert.match(point.titre, /pas plus de cas/);
  });

  it("une confiance pire qu'une constante demande de la recalibrer", async () => {
    // Le système annonce une confiance qui ne suit pas la réalité : son Brier est pire que celui
    // d'une référence qui dirait 0,5 partout.
    const l = ameliorations(await evaluate(sain({
      predict: async (it: Cas) => ({ prob: it.id % 2 ? 0.95 : 0.05 }),
      truth: (it: Cas) => ({ ok: it.id % 2 === 0 }),
      baseline: () => ({ prob: 0.5 }),
    })));
    assert.match(titres(l), /Recalibrer/);
  });
});

describe("le module se tait quand rien ne le déclenche", () => {
  it("ne produit aucun point générique sur une mesure saine", async () => {
    const l = ameliorations(await evaluate(sain({
      // Assez de cas, une confiance, un coût déclaré : rien ne manque.
      predict: async (it: Cas) => ({
        label: it.id % 2 ? "a" : "b",
        prob: it.id % 2 ? 0.7 : 0.3,
        cost: { eur: 0.01, inputTokens: 10, outputTokens: 5 },
      }),
      truth: (it: Cas) => ({ label: (it.id * 7) % 3 ? "a" : "b", ok: (it.id * 7) % 3 !== 0 }),
      baseline: (it: Cas) => ({ label: it.id % 3 ? "a" : "b", prob: 0.55 }),
    }), 400));

    // On n'exige pas zéro point — la mesure peut légitimement en déclencher. On exige qu'aucun
    // ne soit du remplissage : tous ceux qui sortent doivent porter une preuve.
    for (const a of l) assert.ok(a.preuve.length > 0);
    assert.ok(!/Déclarer le coût/.test(titres(l)), "un coût déclaré ne doit plus être réclamé");
  });

  it("le rendu dit explicitement qu'il n'a rien à dire, plutôt que d'inventer", () => {
    // Un résultat où AUCUNE règle ne se déclenche : pas de refus, pas d'erreur, un coût déclaré,
    // une confiance présente, assez de cas. Le module doit alors le dire, pas meubler.
    const vide = { reservations: [], n: 500, errors: 0, binary: null, probabilistic: {},
      contrastive: null, refusal: null, cost: { coverage: 1 },
      reproducibility: { minPaired: 100 } } as never;
    const md = renderAmeliorationsMarkdown(vide);
    assert.match(md, /Aucun point/);
    assert.match(md, /absence de signal/);
  });
});

describe("ordre de lecture", () => {
  it("les bloquants passent avant les importants, qui passent avant les utiles", async () => {
    const l = ameliorations(await evaluate(sain({
      predict: async () => ({ label: "a" }),
      cluster: (it: Cas) => `j${it.id % 5}`,
    }, 40)));
    const rang = { bloquant: 0, important: 1, utile: 2 } as const;
    for (let i = 1; i < l.length; i++) {
      assert.ok(
        rang[l[i - 1].priorite] <= rang[l[i].priorite],
        "un bloquant ne doit jamais se retrouver après un utile : corriger le système sur la foi "
        + "d'une mesure fausse est la façon la plus coûteuse de perdre du temps",
      );
    }
  });
});
