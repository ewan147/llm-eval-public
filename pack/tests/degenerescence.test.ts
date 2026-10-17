// Contrôles de dégénérescence : vérifier que la MESURE veut dire quelque chose.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ces cinq situations ont un point commun, et c'est ce qui les rend dangereuses : elles
// produisent un chiffre d'aspect parfaitement normal et complètement vide de sens. Rien ne
// plante, rien n'a l'air anormal, et le rapport a l'air d'un rapport.
//
// Elles ont toutes été trouvées en soumettant le pack à des adaptateurs hostiles — pas en lisant
// le code. La leçon du projet se répète : un défaut qui ABAISSE un score se voit ; un défaut qui
// produit un score PLAUSIBLE ne se voit que si on le cherche exprès.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate } from "../core/evaluate.ts";
import type { Adapter } from "../core/types.ts";

interface Cas { id: number }

/** Un adaptateur sain : ~50 % de réussite, une référence qui répond, assez de cas. */
function sain(over: Partial<Adapter<Cas>> = {}, n = 120): Adapter<Cas> {
  return {
    name: "sonde",
    loadItems: async () => Array.from({ length: n }, (_, i) => ({ id: i })),
    predict: async (it: Cas) => ({ label: it.id % 2 ? "a" : "b" }),
    truth: (it: Cas) => ({ label: (it.id * 7) % 3 ? "a" : "b" }),
    baseline: () => ({ label: "a" }),
    ...over,
  } as Adapter<Cas>;
}

const reserve = (r: { reservations: string[] }, motif: RegExp) =>
  r.reservations.find((x) => motif.test(x));

describe("une référence qui plante n'est pas un système cassé", () => {
  it("ne fait pas échouer les cas, et nomme la référence", async () => {
    const r = await evaluate(sain({ baseline: () => { throw new Error("bogue interne"); } }));

    // AVANT : l'appel à baseline() était hors du try du cas, donc une référence cassée faisait
    // basculer les 120 cas dans la branche d'erreur. Le rapport annonçait « 120 cas ont échoué »
    // et l'utilisateur partait chercher un bogue dans son predict().
    assert.equal(r.errors, 0, "le système doit rester mesuré");
    assert.ok(r.n > 0);

    const m = reserve(r, /baseline\(\) a échoué/);
    assert.ok(m, "la réserve doit nommer la référence");
    assert.match(m, /bogue interne/, "le message d'origine doit être cité");
  });
});

describe("un score trop beau est suspect avant d'être bon", () => {
  it("signale une fuite probable quand predict renvoie la vérité", async () => {
    // L'erreur la plus fréquente quand on évalue son propre système : la vérité arrive dans
    // l'entrée. Le pack couronnait « BAT LA RÉFÉRENCE » sans le moindre doute.
    const r = await evaluate(sain({ predict: async (it: Cas) => ({ label: (it.id * 7) % 3 ? "a" : "b" }) }));
    assert.equal(r.binary?.successRate.value, 1);
    assert.ok(reserve(r, /SUSPECT/), "un score de 100 % doit être signalé comme suspect");
  });

  it("ne crie pas au loup sur un score ordinaire", async () => {
    const r = await evaluate(sain());
    assert.ok(!reserve(r, /SUSPECT/), "un score normal ne doit pas déclencher l'alerte");
  });

  it("se tait quand l'échantillon est trop petit pour que 100 % surprenne", async () => {
    // Sur cinq cas, tout juste n'a rien d'extraordinaire : le seuil de 30 évite une alerte
    // permanente sur les petits jeux, qui la ferait ignorer là où elle compte.
    const r = await evaluate(sain({ predict: async (it: Cas) => ({ label: (it.id * 7) % 3 ? "a" : "b" }) }, 5));
    assert.ok(!reserve(r, /SUSPECT/));
  });
});

describe("une vérité terrain dégénérée ne mesure rien", () => {
  it("dit qu'un jeu à réponse unique ne distingue aucun système", async () => {
    const r = await evaluate(sain({ truth: () => ({ label: "a" }) }));
    const m = reserve(r, /MÊME vérité terrain/);
    assert.ok(m, "une vérité constante doit être signalée");
    assert.match(m, /ne mesure rien/);
  });

  it("signale aussi un déséquilibre extrême, pas seulement le cas constant", async () => {
    // 97 % d'une même classe : « répondre toujours ça » obtient 97 % sans rien savoir. C'est la
    // façon la plus courante de publier un chiffre flatteur sans le faire exprès.
    const r = await evaluate(sain({ truth: (it: Cas) => ({ label: it.id < 4 ? "b" : "a" }) }));
    assert.ok(reserve(r, /portent la même vérité terrain/));
  });

  it("ne dit rien sur un jeu équilibré", async () => {
    const r = await evaluate(sain({ truth: (it: Cas) => ({ label: it.id % 2 ? "a" : "b" }) }));
    assert.ok(!reserve(r, /vérité terrain/));
  });
});

describe("un système qui répond toujours pareil", () => {
  it("est signalé, parce que son taux n'est qu'une fréquence", async () => {
    const r = await evaluate(sain({ predict: async () => ({ label: "a" }) }));
    const m = reserve(r, /TOUJOURS la même chose/);
    assert.ok(m);
    assert.match(m, /aucune capacité à distinguer/);
  });

  it("ne se déclenche pas sur un système qui varie", async () => {
    assert.ok(!reserve(await evaluate(sain()), /TOUJOURS la même chose/));
  });
});

describe("multiplicité des tranches", () => {
  it("avertit quand plusieurs tranches sont examinées ensemble", async () => {
    const r = await evaluate(sain({ category: (it: Cas) => `tranche${it.id % 10}` }, 400));
    const m = reserve(r, /tranches sont examinées simultanément/);
    assert.ok(m, "dix tranches simultanées doivent déclencher l'avertissement");
    // Le rapport trie « du pire au meilleur » et invite à regarder la première ligne : sans cette
    // réserve, c'est une fabrique à fausses découvertes.
    assert.match(m, /n'est donc pas une découverte/);
  });

  it("se tait quand il n'y a que deux ou trois tranches", async () => {
    const r = await evaluate(sain({ category: (it: Cas) => `t${it.id % 3}` }, 400));
    assert.ok(!reserve(r, /tranches sont examinées simultanément/));
  });
});

describe("le refus reste en tête", () => {
  it("passe avant tous les contrôles de dégénérescence", async () => {
    // Règle de conception déjà testée ailleurs, que les nouveaux contrôles ont enfreinte une
    // fois : le refus est la réserve la plus lourde, il ne doit jamais être poussé plus bas.
    const { baseline, ...sansReference } = sain({
      predict: async (it: Cas) => ({ label: (it.id * 7) % 3 ? "a" : "b" }),
    });
    const r = await evaluate(sansReference as Adapter<Cas>);
    assert.ok(r.refusal);
    assert.match(r.reservations[0], /AUCUNE RÉFÉRENCE CONTRASTIVE/);
    assert.ok(reserve(r, /SUSPECT/), "les autres contrôles restent présents, plus bas");
  });
});

describe("observations groupees", () => {
  // TROUVE SUR UNE MESURE REELLE. Un systeme de selection d'actions produisait 170 predictions
  // reparties sur 10 seances de bourse : tous les paris d'un meme jour subissent le meme marche
  // et gagnent ou perdent largement ensemble. Les compter comme 170 tirages independants donne
  // des intervalles beaucoup trop etroits, et fait conclure la ou il n'y a rien a conclure.

  it("avertit quand les cas se concentrent sur peu de grappes", async () => {
    const r = await evaluate(sain({ cluster: (it: Cas) => `jour${it.id % 8}` }, 160));
    const m = reserve(r, /grappes seulement/);
    assert.ok(m, "160 cas sur 8 grappes doivent declencher l'avertissement");
    assert.match(m, /TROP ETROITS|TROP ÉTROITS/);
    assert.match(m, /plus proche de 8 que de 160/);
  });

  it("se tait quand chaque cas est sa propre grappe", async () => {
    const r = await evaluate(sain({ cluster: (it: Cas) => `cas${it.id}` }));
    assert.ok(!reserve(r, /grappes seulement/));
  });

  it("ne dit rien quand l'adaptateur ne declare aucune grappe", async () => {
    // Comportement historique : sans declaration, chaque cas est suppose independant. C'est
    // souvent faux, et le pack ne peut pas le deviner tout seul — il ne doit donc pas pretendre
    // le savoir.
    assert.ok(!reserve(await evaluate(sain()), /grappes seulement/));
  });

  it("une methode cluster qui plante ne fait pas perdre la mesure", async () => {
    const r = await evaluate(sain({ cluster: () => { throw new Error("boum"); } }));
    assert.equal(r.errors, 0);
    assert.ok(r.n > 0);
  });
});
