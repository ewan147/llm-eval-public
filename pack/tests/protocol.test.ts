import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareMigration } from "../protocols/migration.ts";
import {
  JUDGE_VERSION,
  judge,
  looksLikeRefusal,
  runProtocol,
  summarize,
  type ModelReply,
} from "../protocols/runner.ts";
import { buildSeries } from "../protocols/series.ts";
import {
  assertComparable,
  auditSuite,
  isUsable,
  stamp,
  suiteFingerprint,
  type Suite,
  type SuiteCase,
} from "../protocols/suite.ts";
import reliabilityV2 from "../protocols/suites/reliability-v2.ts";

function suiteOf(cases: SuiteCase[], over: Partial<Suite> = {}): Suite {
  return {
    id: "test",
    version: 1,
    description: "suite de test",
    exclusions: [],
    cases,
    ...over,
  };
}

const c = (over: Partial<SuiteCase> = {}): SuiteCase => ({
  id: "c1",
  dimension: "exactitude",
  prompt: "Quelle est la capitale administrative de l'Australie ?",
  expected: ["canberra"],
  category: "géo",
  source: "référence",
  ...over,
});

// ══ La suite figée ════════════════════════════════════════════════════════════════════════════

describe("suiteFingerprint", () => {
  it("est stable et indépendante de l'ordre des cas", () => {
    const a = suiteOf([c({ id: "a" }), c({ id: "b", prompt: "autre", expected: ["x"] })]);
    const b = suiteOf([c({ id: "b", prompt: "autre", expected: ["x"] }), c({ id: "a" })]);
    assert.equal(suiteFingerprint(a), suiteFingerprint(b));
  });

  it("CHANGE dès qu'un prompt change — c'est tout l'intérêt", () => {
    const a = suiteOf([c()]);
    const b = suiteOf([c({ prompt: "question reformulée" })]);
    assert.notEqual(suiteFingerprint(a), suiteFingerprint(b));
  });

  it("change dès qu'une preuve attendue change", () => {
    const a = suiteOf([c()]);
    const b = suiteOf([c({ expected: ["sydney"] })]);
    assert.notEqual(suiteFingerprint(a), suiteFingerprint(b));
  });

  it("NE change PAS quand seule la description ou une exclusion change", () => {
    // Corriger une faute de frappe ne doit pas invalider six mois de résultats.
    const a = suiteOf([c()], { description: "avant" });
    const b = suiteOf([c()], {
      description: "après",
      exclusions: [{ capability: "x", reason: "y" }],
    });
    assert.equal(suiteFingerprint(a), suiteFingerprint(b));
  });
});

describe("auditSuite — le contrôle de fuite", () => {
  it("REFUSE un cas dont la preuve attendue figure dans la question", () => {
    // Le faux succès réel du projet d'origine : « exécute echo JETON-4417 » puis chercher
    // JETON-4417. N'importe quelle paraphrase le fait passer sans rien exécuter.
    const s = suiteOf([
      c({
        id: "fuite",
        prompt: "Exécute la commande `echo JETON-TERMINAL-4417` et donne sa sortie.",
        expected: ["JETON-TERMINAL-4417"],
      }),
    ]);
    const f = auditSuite(s);
    assert.equal(isUsable(f), false);
    assert.match(f[0].problem, /figure déjà dans la question/);
  });

  it("détecte aussi une fuite passant par une reformulation", () => {
    const s = suiteOf([
      c({
        id: "fuite2",
        prompt: "Quelle est la capitale ?",
        paraphrases: ["Nomme la ville : est-ce Canberra ou Sydney ?"],
        expected: ["canberra"],
      }),
    ]);
    assert.equal(isUsable(auditSuite(s)), false);
  });

  it("laisse passer une réponse courte présente dans un choix binaire", () => {
    // « oui » et « non » figurent tous deux dans l'énoncé : aucun ne confère d'avantage.
    const s = suiteOf([
      c({ id: "binaire", prompt: "Le ciel est-il bleu ? Réponds par oui ou non.", expected: ["oui"] }),
    ]);
    assert.equal(isUsable(auditSuite(s)), true);
  });

  it("REFUSE un cas sans vérification objective", () => {
    const s = suiteOf([c({ id: "mou", expected: [] })]);
    assert.equal(isUsable(auditSuite(s)), false);
  });

  it("REFUSE deux cas de même identifiant", () => {
    const s = suiteOf([c({ id: "dup" }), c({ id: "dup", prompt: "autre", expected: ["z"] })]);
    assert.equal(isUsable(auditSuite(s)), false);
  });

  it("REFUSE un cas de robustesse sans reformulation", () => {
    const s = suiteOf([c({ id: "ro", dimension: "robustesse" })]);
    assert.equal(isUsable(auditSuite(s)), false);
  });

  it("avertit sans bloquer quand la vérité terrain n'a pas de provenance", () => {
    const f = auditSuite(suiteOf([c({ source: "" })]));
    assert.equal(isUsable(f), true);
    assert.equal(f[0].severity, "avertissement");
  });

  it("LA SUITE LIVRÉE est saine", () => {
    const f = auditSuite(reliabilityV2);
    assert.equal(isUsable(f), true, `suite v1 non utilisable : ${JSON.stringify(f)}`);
    assert.ok(reliabilityV2.cases.length >= 30);
    assert.ok(reliabilityV2.exclusions.length >= 3, "les exclusions de sécurité doivent être déclarées");
  });
});

describe("assertComparable — le refus, pas l'avertissement", () => {
  it("accepte deux exécutions de même empreinte", () => {
    const s = stamp(suiteOf([c()]));
    assert.equal(assertComparable(s, s).verdict, "COMPARABLE");
  });

  it("REFUSE deux suites d'identifiants différents", () => {
    const a = stamp(suiteOf([c()], { id: "alpha" }));
    const b = stamp(suiteOf([c()], { id: "beta" }));
    assert.equal(assertComparable(a, b).verdict, "REFUSÉ");
  });

  it("REFUSE la même suite dont les cas ont changé", () => {
    const a = stamp(suiteOf([c()]));
    const b = stamp(suiteOf([c({ prompt: "modifié" })], { version: 2 }));
    const r = assertComparable(a, b);
    assert.equal(r.verdict, "REFUSÉ");
    assert.match(r.reason, /Il n'y en a pas de troisième/);
  });
});

// ══ Le lanceur ════════════════════════════════════════════════════════════════════════════════

const reply = (text: string, over: Partial<ModelReply> = {}): ModelReply => ({ text, ...over });

describe("judge — vérification objective, jamais à l'œil", () => {
  it("accepte une preuve attendue présente", () => {
    assert.equal(judge(c(), reply("La capitale est Canberra.")).verdict, "juste");
  });

  it("refuse une réponse plausible sans la preuve", () => {
    assert.equal(judge(c(), reply("C'est une grande ville australienne.")).verdict, "faux");
  });

  // ── v3 : ce que `forbidden` a le droit de faire ────────────────────────────────────────────
  //
  // La v2 rejetait toute réponse contenant un distracteur, où qu'il soit. Elle comptait donc FAUX
  // « la Volga, bien que le Danube soit plus connu » et « Wellington, bien qu'Auckland soit la
  // plus grande » : elle punissait le modèle qui EXPLIQUE pourquoi le piège est un piège. Le rôle
  // du distracteur est désormais de départager quand la preuve attendue est absente.

  it("un distracteur mentionné à côté de la bonne réponse ne la disqualifie pas", () => {
    const v = judge(
      c({ forbidden: ["sydney"] }),
      reply("Canberra, bien que beaucoup pensent à Sydney."),
    );
    assert.equal(v.verdict, "juste");
    // L'information n'est pas perdue pour autant : elle descend dans le motif.
    assert.match(v.why, /sydney/i);
  });

  it("un distracteur donné COMME réponse reste faux", () => {
    const v = judge(
      c({ forbidden: ["sydney"] }),
      reply("La capitale de l'Australie est Sydney."),
    );
    assert.equal(v.verdict, "faux");
    assert.match(v.why, /distracteur/i);
  });

  it("accepte la bonne réponse écrite dans une autre langue", () => {
    // Cas réel : « Le Océano Atlántico borde la côte ouest » compté FAUX par le juge v2, qui
    // cherchait « atlantic » dans un texte accentué. Mesurer l'orthographe n'était pas le but.
    const atlantique = c({ expected: ["atlantique", "atlantic"] });
    assert.equal(judge(atlantique, reply("Le Océano Atlántico.")).verdict, "juste");
    assert.equal(judge(atlantique, reply("O Oceano Atlântico.")).verdict, "juste");
    assert.equal(judge(atlantique, reply("C'est la mer Noire.")).verdict, "faux");
  });

  it("une preuve courte est cherchée comme mot entier, pas en sous-chaîne", () => {
    // Sans cette règle, attendre « non » accepterait « annonce » et attendre « oui »
    // accepterait « enfouis » : le banc compterait juste sur un mot qui n'est pas la réponse.
    assert.equal(judge(c({ expected: ["non"] }), reply("Cela annonce une suite.")).verdict, "faux");
    assert.equal(judge(c({ expected: ["non"] }), reply("Non.")).verdict, "juste");
    assert.equal(judge(c({ expected: ["oui"] }), reply("Les restes sont enfouis.")).verdict, "faux");
    assert.equal(judge(c({ expected: ["oui"] }), reply("Oui, sans aucun doute.")).verdict, "juste");
  });

  it("une option « on ne peut pas savoir » offerte par l'énoncé n'est pas un refus", () => {
    // Trouvé sur une exécution réelle : le cas lo-05 propose « oui, non, ou impossible à
    // déterminer ». Un modèle qui répond « impossible à déterminer » a CHOISI une option et
    // s'est trompé. Le juge y voyait un refus et décrivait cette erreur comme de la prudence.
    const offert = c({ expected: ["oui"], leRefusEstUneReponse: true });
    assert.equal(judge(offert, reply("Impossible à déterminer.")).verdict, "faux");
    assert.equal(judge(offert, reply("Oui.")).verdict, "juste");

    // Sans le drapeau, le comportement d'origine tient : se taire n'est pas se tromper.
    const ordinaire = c({ expected: ["oui"] });
    assert.equal(judge(ordinaire, reply("Je ne sais pas.")).verdict, "refus");
  });

  it("une consigne de forme non tenue est fausse, même avec la bonne réponse", () => {
    const json = c({ expected: ["lisbonne"], format: ["json"] });
    // Bonne réponse, mauvais format : c'est un échec, et c'est tout l'intérêt de le mesurer.
    const enrobe = judge(json, reply('```json\n{"ville":"Lisbonne"}\n```'));
    assert.equal(enrobe.verdict, "faux");
    assert.match(enrobe.why, /forme/i);
    assert.equal(judge(json, reply('{"ville":"Lisbonne"}')).verdict, "juste");
  });

  it("la casse est vérifiée sur le texte brut, avant normalisation", () => {
    const maj = c({ expected: ["bleu"], format: ["majuscules"] });
    assert.equal(judge(maj, reply("BLEU")).verdict, "juste");
    assert.equal(judge(maj, reply("Bleu")).verdict, "faux");
  });

  it("le gras Markdown ne cache pas une preuve", () => {
    assert.equal(judge(c(), reply("La capitale est **Canberra**.")).verdict, "juste");
  });

  it("distingue un REFUS d'une erreur", () => {
    assert.equal(judge(c(), reply("Je ne sais pas.")).verdict, "refus");
  });

  it("un refus ATTENDU est une réussite", () => {
    const v = judge(c({ expectRefusal: true, expected: [] }), reply("Je n'ai pas cette information."));
    assert.equal(v.verdict, "juste");
  });

  it("INVENTER sur une question sans réponse est un échec, pas un demi-succès", () => {
    const v = judge(c({ expectRefusal: true, expected: [] }), reply("Le score était 3-1."));
    assert.equal(v.verdict, "faux");
    assert.match(v.why, /rien n'a l'air faux/);
  });

  it("une panne d'infrastructure n'est pas une mauvaise réponse", () => {
    const v = judge(c(), reply("", { failure: "HTTP 400 : modèle sans support des outils" }));
    assert.equal(v.verdict, "panne");
  });
});

describe("looksLikeRefusal — juge v2", () => {
  it("reconnaît une réponse vide", () => {
    assert.equal(looksLikeRefusal("   "), true);
  });

  it("reconnaît les formules usuelles, en français et en anglais", () => {
    assert.equal(looksLikeRefusal("Je ne sais pas."), true);
    assert.equal(looksLikeRefusal("I cannot answer that."), true);
  });

  it("RECONNAÎT LA RÉFUTATION DE PRÉMISSE — corrigé après une mesure fausse", () => {
    // Cas réels, relevés sur qwen3:4b. Le juge v1 les comptait comme des INVENTIONS alors que ce
    // sont des réponses MEILLEURES qu'un « je ne sais pas » : le modèle explique pourquoi la
    // question n'a pas de réponse. Le verdict mesurait l'étroitesse du contrôleur.
    assert.equal(
      looksLikeRefusal(
        "Il n'y a pas de match de football entre Vaasan Sport et Jokerit le 1er septembre 2026, "
        + "car Jokerit est une équipe de hockey sur glace.",
      ),
      true,
    );
    assert.equal(
      looksLikeRefusal("La commune de Trifouillis-les-Oies n'existe pas en France."),
      true,
    );
  });

  it("reconnaît un refus tronqué ou mal formé", () => {
    // Réponse réelle de qwen3:4b : « Je ne peux peux ». Le marqueur « ne peux pas » la ratait.
    assert.equal(looksLikeRefusal("Je ne peux peux"), true);
  });

  it("ne prend pas une vraie réponse pour un refus", () => {
    assert.equal(looksLikeRefusal("Canberra."), false);
    assert.equal(looksLikeRefusal("La capitale est Wellington, en Nouvelle-Zélande."), false);
  });

  it("une invention confiante reste un échec", () => {
    assert.equal(looksLikeRefusal("Le score était de 3-1 pour Vaasan Sport."), false);
  });
});

describe("versionnement du juge", () => {
  it("l'exécution enregistre la version du juge qui l'a produite", async () => {
    const run = await runProtocol({
      suite: suiteOf([c()]),
      model: "m",
      ask: async () => reply("canberra"),
      budget: { maxCalls: 10 },
    });
    assert.equal(run.judgeVersion, JUDGE_VERSION);
  });

  it("REFUSE de comparer deux exécutions jugées par des versions différentes", async () => {
    // Même suite, mêmes questions, mais critères de jugement différents : l'écart mesuré
    // mélangerait un changement de modèle et un changement de règle.
    const suite = suiteOf(
      Array.from({ length: 20 }, (_, i) =>
        c({ id: `q${i}`, prompt: `Question ${i} ?`, expected: [`r${i}`] }),
      ),
    );
    const a = await runProtocol({
      suite,
      model: "A",
      ask: async () => reply("r0"),
      budget: { maxCalls: 100 },
    });
    const b = { ...a, model: "B", judgeVersion: JUDGE_VERSION + 1 };
    const m = compareMigration(a, b);
    assert.equal(m.verdict, "COMPARAISON REFUSÉE");
    assert.match(m.comparability.reason, /versions de juge différentes/);
  });
});

describe("runProtocol", () => {
  const suite = suiteOf([
    c({ id: "a" }),
    c({ id: "b", prompt: "Combien font 17 fois 23 ?", expected: ["391"] }),
    c({ id: "d", prompt: "Quel est le plus long fleuve d'Europe ?", expected: ["volga"] }),
  ]);

  it("fait passer tous les cas quand le budget suffit", async () => {
    const run = await runProtocol({
      suite,
      model: "m",
      ask: async () => reply("canberra 391 volga"),
      budget: { maxCalls: 10 },
    });
    assert.equal(run.complete, true);
    assert.equal(run.results.length, 3);
    assert.equal(summarize(run).juste, 3);
  });

  it("S'ARRÊTE au plafond d'appels et déclare l'exécution INCOMPLÈTE", async () => {
    const run = await runProtocol({
      suite,
      model: "m",
      ask: async () => reply("canberra 391 volga"),
      budget: { maxCalls: 2 },
    });
    assert.equal(run.complete, false);
    assert.equal(run.callsUsed, 2);
    assert.match(run.stoppedBecause!, /Plafond d'appels/);
  });

  it("s'arrête au plafond de coût", async () => {
    const run = await runProtocol({
      suite,
      model: "m",
      ask: async () => reply("canberra", { cost: { eur: 5 } }),
      budget: { maxCalls: 10, maxEur: 6 },
    });
    assert.equal(run.complete, false);
    assert.match(run.stoppedBecause!, /Plafond de coût/);
  });

  it("NE CONSOMME AUCUN APPEL si la suite contient une fuite", async () => {
    let calls = 0;
    const fuite = suiteOf([
      c({ id: "f", prompt: "Réponds JETON-ABCD-9999.", expected: ["JETON-ABCD-9999"] }),
    ]);
    const run = await runProtocol({
      suite: fuite,
      model: "m",
      ask: async () => {
        calls++;
        return reply("JETON-ABCD-9999");
      },
      budget: { maxCalls: 10 },
    });
    assert.equal(calls, 0, "aucun appel ne doit être fait sur une suite qui fuit");
    assert.equal(run.results.length, 0);
    assert.match(run.stoppedBecause!, /avant le premier appel/);
  });

  it("mesure l'accord du modèle avec lui-même sur les reformulations", async () => {
    const ro = suiteOf([
      c({
        id: "ro",
        dimension: "robustesse",
        paraphrases: ["Autre formulation ?", "Encore une autre ?"],
      }),
    ]);
    let n = 0;
    const run = await runProtocol({
      suite: ro,
      model: "m",
      // Répond juste, juste, puis faux : accord 2/3.
      ask: async () => reply(n++ < 2 ? "canberra" : "sydney-ville"),
      budget: { maxCalls: 10 },
    });
    assert.ok(Math.abs(run.results[0].selfAgreement! - 2 / 3) < 1e-9);
  });
});

describe("summarize — les pannes sortent du dénominateur", () => {
  it("n'attribue pas au modèle une panne d'infrastructure", async () => {
    const suite = suiteOf([c({ id: "a" }), c({ id: "b", prompt: "autre ?", expected: ["zzz"] })]);
    const run = await runProtocol({
      suite,
      model: "m",
      ask: async (p) =>
        p.includes("autre") ? reply("", { failure: "HTTP 400" }) : reply("canberra"),
      budget: { maxCalls: 10 },
    });
    const s = summarize(run);
    assert.equal(s.panne, 1);
    assert.equal(s.measured, 1);
    assert.equal(s.accuracy, 1, "1 juste sur 1 mesurable, la panne ne compte pas comme un échec");
  });
});

// ══ Migration ═════════════════════════════════════════════════════════════════════════════════

async function runWith(model: string, answers: string[], suite: Suite) {
  let i = 0;
  return runProtocol({
    suite,
    model,
    ask: async () => reply(answers[i++] ?? ""),
    budget: { maxCalls: 100 },
  });
}

describe("compareMigration", () => {
  const suite = suiteOf(
    Array.from({ length: 20 }, (_, i) =>
      c({ id: `q${i}`, prompt: `Question numéro ${i} ?`, expected: [`reponse${i}`] }),
    ),
  );
  const allRight = Array.from({ length: 20 }, (_, i) => `reponse${i}`);

  it("REFUSE de comparer deux suites différentes, et ne publie aucun chiffre", async () => {
    const a = await runWith("A", allRight, suite);
    const autre = suiteOf([c({ id: "z", prompt: "z ?", expected: ["z"] })], { id: "autre" });
    const b = await runWith("B", ["z"], autre);
    const m = compareMigration(a, b);
    assert.equal(m.verdict, "COMPARAISON REFUSÉE");
    assert.equal(m.paired, 0);
    assert.equal(m.regressions.length, 0);
  });

  it("NOMME les régressions plutôt que de les noyer dans une moyenne", async () => {
    const a = await runWith("A", allRight, suite);
    const degrade = [...allRight];
    degrade[3] = "faux";
    degrade[7] = "faux";
    const b = await runWith("B", degrade, suite);
    const m = compareMigration(a, b);
    assert.equal(m.regressions.length, 2);
    assert.deepEqual(m.regressions.map((r) => r.caseId).sort(), ["q3", "q7"]);
    assert.equal(m.fixes.length, 0);
    assert.equal(m.unchanged, 18);
  });

  it("chaque régression porte l'énoncé et les deux réponses", async () => {
    const a = await runWith("A", allRight, suite);
    const degrade = [...allRight];
    degrade[0] = "hors sujet";
    const b = await runWith("B", degrade, suite);
    const reg = compareMigration(a, b).regressions[0];
    assert.equal(reg.caseId, "q0");
    assert.match(reg.prompt, /Question numéro 0/);
    assert.equal(reg.before.verdict, "juste");
    assert.equal(reg.after.verdict, "faux");
    assert.match(reg.after.reply, /hors sujet/);
  });

  it("ATTENDRE — et non ÉQUIVALENT — quand l'échantillon est trop mince", async () => {
    const a = await runWith("A", allRight, suite);
    const b = await runWith("B", allRight, suite);
    const m = compareMigration(a, b);
    assert.equal(m.verdict, "ATTENDRE");
    assert.match(m.statement, /on n'en sait rien|pas la puissance/);
  });

  it("NE PAS MIGRER sur une dégradation démontrée", async () => {
    const big = suiteOf(
      Array.from({ length: 200 }, (_, i) =>
        c({ id: `q${i}`, prompt: `Question ${i} ?`, expected: [`r${i}`] }),
      ),
    );
    const right = Array.from({ length: 200 }, (_, i) => `r${i}`);
    const wrong = right.map((v, i) => (i < 60 ? "faux" : v));
    const a = await runWith("A", right, big);
    const b = await runWith("B", wrong, big);
    const m = compareMigration(a, b);
    assert.equal(m.verdict, "NE PAS MIGRER");
    assert.equal(m.significant, true);
    assert.equal(m.regressions.length, 60);
  });

  it("MIGRER sur un gain démontré", async () => {
    const big = suiteOf(
      Array.from({ length: 200 }, (_, i) =>
        c({ id: `q${i}`, prompt: `Question ${i} ?`, expected: [`r${i}`] }),
      ),
    );
    const right = Array.from({ length: 200 }, (_, i) => `r${i}`);
    const poor = right.map((v, i) => (i < 60 ? "faux" : v));
    const a = await runWith("A", poor, big);
    const b = await runWith("B", right, big);
    const m = compareMigration(a, b);
    assert.equal(m.verdict, "MIGRER");
    assert.equal(m.fixes.length, 60);
  });

  it("les réserves ne sont jamais vides", async () => {
    const a = await runWith("A", allRight, suite);
    const b = await runWith("B", allRight, suite);
    assert.ok(compareMigration(a, b).reservations.length > 0);
  });
});

// ══ Série ═════════════════════════════════════════════════════════════════════════════════════

describe("buildSeries", () => {
  const suite = suiteOf([c()]);

  it("sépare les points par empreinte : jamais une courbe qui mélange deux suites", async () => {
    const a = await runWith("A", ["canberra"], suite);
    const autre = suiteOf([c({ prompt: "autre ?", expected: ["x"] })]);
    const b = await runWith("B", ["x"], autre);
    const s = buildSeries([a, b]);
    assert.equal(s.segments.length, 2);
    assert.equal(s.segments.every((seg) => !seg.comparable), true);
  });

  it("marque comparable un segment portant deux modèles", async () => {
    const a = await runWith("A", ["canberra"], suite);
    const b = await runWith("B", ["canberra"], suite);
    const s = buildSeries([a, b]);
    assert.equal(s.segments.length, 1);
    assert.equal(s.segments[0].comparable, true);
  });

  it("dit honnêtement qu'aucune comparaison n'est possible quand c'est le cas", async () => {
    const a = await runWith("A", ["canberra"], suite);
    const s = buildSeries([a]);
    assert.match(s.statement, /aucune comparaison|AUCUN segment/i);
  });

  it("CAS LIMITE série vide", () => {
    const s = buildSeries([]);
    assert.equal(s.totalPoints, 0);
    assert.match(s.statement, /vide/);
  });
});

describe("une execution sans cas mesurable ne vaut pas zero", () => {
  const execution = (verdicts: string[]) => ({
    model: "m",
    runAt: "2026-01-01T00:00:00.000Z",
    suite: { id: "s", version: 1, fingerprint: "abc", caseCount: verdicts.length, description: "" },
    judgeVersion: 3,
    complete: true,
    stoppedBecause: null,
    callsUsed: verdicts.length,
    budget: { maxCalls: 100 },
    exclusions: [],
    suiteFindings: [],
    results: verdicts.map((v, i) => ({
      caseId: `c${i}`, dimension: "exactitude", category: "x", verdict: v,
      prompt: "p", reply: "r", why: "w", selfAgreement: null,
    })),
  }) as never;

  it("rend null, et non 0, quand tout est en panne", () => {
    // AVANT : « exactitude 0,000 ». Le rapport annoncait 0 % de reussite pour un modele dont pas
    // une seule reponse n'avait pu etre jugee. C'est la confusion panne/faux, deja corrigee dans
    // le juge, qui revenait ici : 0/0 n'est pas zero, c'est « pas de mesure ».
    const s = summarize(execution(["panne", "panne", "panne"]));
    assert.equal(s.measured, 0);
    assert.equal(s.accuracy, null);
  });

  it("rend null sur une execution vide", () => {
    assert.equal(summarize(execution([])).accuracy, null);
  });

  it("calcule normalement des qu'un cas est mesurable", () => {
    const s = summarize(execution(["juste", "faux", "panne"]));
    assert.equal(s.measured, 2);
    assert.equal(s.accuracy, 0.5);
  });
});
