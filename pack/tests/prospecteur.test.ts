// Tests du prospecteur et du générateur de code.
//
// Ce qui est vérifié ici n'est pas « il trouve des fichiers », mais : il ne s'arroge jamais le
// droit de décider ce qu'est la vérité terrain, il dit toujours ce qu'il a deviné, il n'écrit
// jamais rien sans qu'on le lui demande, et il n'escamote aucune source en silence.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { classer, prospecter } from "../scaffold/prospecteur.ts";
import { genererDepuisGisement } from "../scaffold/generateur.ts";

function projetJetable(): string {
  return mkdtempSync(join(tmpdir(), "prospect-"));
}

describe("classement des colonnes", () => {
  it("reconnaît les quatre rôles qui comptent", () => {
    assert.equal(classer("direction").role, "prediction");
    assert.equal(classer("confidence").role, "prediction");
    assert.equal(classer("ret_5d").role, "issue");
    assert.equal(classer("pnl_pct").role, "issue");
    assert.equal(classer("ticker").role, "identite");
    assert.equal(classer("report_day").role, "temps");
  });

  it("une référence reste une référence, même si son nom contient « ret »", () => {
    // « bench_1d » et « ret_1d » se ressemblent. Les confondre ferait comparer le système à
    // lui-même — et produirait invariablement « aucune différence ».
    assert.equal(classer("bench_1d").role, "reference");
    assert.equal(classer("benchmark_exit_price").role, "reference");
    assert.equal(classer("ret_1d").role, "issue");
  });

  it("ne prétend rien sur une colonne qu'il ne reconnaît pas", () => {
    assert.equal(classer("payload").role, "inconnu");
    assert.equal(classer("xyz_42").role, "inconnu");
  });
});

describe("prospection", () => {
  it("trouve une prédiction, une issue et une référence dans un JSON", () => {
    const d = projetJetable();
    writeFileSync(join(d, "picks.json"), JSON.stringify([
      { ticker: "AAA", direction: "up", confidence: 0.8, ret_1d: 1.2, bench_1d: 0.4, day: "2026-01-01" },
      { ticker: "BBB", direction: "down", confidence: 0.6, ret_1d: -0.5, bench_1d: 0.2, day: "2026-01-02" },
    ]), "utf-8");

    const p = prospecter(d);
    assert.equal(p.gisements.length, 1);
    const g = p.gisements[0];
    assert.equal(g.note, 100);
    assert.ok(g.colonnes.some((c) => c.nom === "ret_1d" && c.role === "issue"));
    assert.ok(g.colonnes.some((c) => c.nom === "bench_1d" && c.role === "reference"));
  });

  it("dit ce qui MANQUE, pas seulement ce qu'il a trouvé", () => {
    const d = projetJetable();
    // Des prédictions, mais rien pour savoir si elles étaient justes.
    writeFileSync(join(d, "signaux.json"), JSON.stringify(
      Array.from({ length: 50 }, (_, i) => ({ id: i, direction: "up", confidence: 0.5 })),
    ), "utf-8");

    const p = prospecter(d);
    assert.equal(p.gisements.length, 1);
    assert.ok(
      p.gisements[0].manques.some((m) => /issue observée/.test(m)),
      "l'absence d'issue doit être signalée : sans elle, rien n'est mesurable",
    );
    assert.match(p.conclusion, /aucune ne réunit|référence/i);
  });

  it("signale qu'un effectif est trop faible pour conclure", () => {
    const d = projetJetable();
    writeFileSync(join(d, "peu.json"), JSON.stringify([
      { id: 1, direction: "up", ret_1d: 1, bench_1d: 0 },
      { id: 2, direction: "up", ret_1d: -1, bench_1d: 0 },
    ]), "utf-8");
    assert.ok(prospecter(d).gisements[0].manques.some((m) => /en dessous de 30/.test(m)));
  });

  it("écarte les sauvegardes, et dit pourquoi", () => {
    const d = projetJetable();
    // Nom réel rencontré sur un projet : « bourse.db.bak-20260903-174714 ».
    writeFileSync(join(d, "base.db.bak-20260903-174714"), "pas vraiment une base", "utf-8");
    const p = prospecter(d);
    assert.ok(p.ecartes.some((e) => /sauvegarde/.test(e.raison)));
  });

  it("ne descend pas dans node_modules", () => {
    const d = projetJetable();
    mkdirSync(join(d, "node_modules", "truc"), { recursive: true });
    writeFileSync(join(d, "node_modules", "truc", "data.json"), JSON.stringify([
      { id: 1, direction: "up", ret_1d: 1, bench_1d: 0 },
    ]), "utf-8");
    assert.equal(prospecter(d).gisements.length, 0);
  });
});

describe("génération de code", () => {
  const gisementComplet = () => {
    const d = projetJetable();
    writeFileSync(join(d, "picks.json"), JSON.stringify(
      Array.from({ length: 40 }, (_, i) => ({
        ticker: `T${i}`, direction: i % 2 ? "up" : "down", confidence: 0.7,
        ret_1d: i % 3 ? 1 : -1, ret_5d: 2, bench_1d: i % 4 ? 0.5 : -0.5, bench_5d: 1,
        day: "2026-01-01",
      })),
    ), "utf-8");
    return { dossier: d, gisement: prospecter(d).gisements[0] };
  };

  it("annonce TOUTES ses suppositions", () => {
    const { dossier, gisement } = gisementComplet();
    const { suppositions, code } = genererDepuisGisement(gisement, dossier);

    // Un générateur qui rendrait du code sans dire ce qu'il a deviné laisserait croire qu'il n'a
    // rien deviné. C'est le point le plus important de ce module.
    assert.ok(suppositions.length >= 2);
    assert.ok(suppositions.some((s) => /avoir raison/.test(s)));
    for (const s of suppositions) assert.ok(code.includes(s), `« ${s} » doit figurer dans le code`);
    assert.match(code, /AVANT DE CROIRE LE MOINDRE CHIFFRE/);
  });

  it("apparie l'issue et la référence sur le même horizon", () => {
    const { dossier, gisement } = gisementComplet();
    const { suppositions } = genererDepuisGisement(gisement, dossier);
    // ret_1d doit aller avec bench_1d, jamais avec bench_5d : sinon l'écart mesuré serait une
    // différence d'horizon déguisée en performance.
    const issue = suppositions.find((s) => /avoir raison/.test(s))!;
    const ref = suppositions.find((s) => /référence à battre/.test(s))!;
    const horizon = (t: string) => /_(\d+d)\b/.exec(t)?.[1];
    assert.equal(horizon(issue), horizon(ref));
  });

  it("la référence ne reçoit JAMAIS de probabilité", () => {
    const { dossier, gisement } = gisementComplet();
    const { code } = genererDepuisGisement(gisement, dossier);
    // On regarde ce que la méthode RENVOIE, pas si le mot « prob » apparaît : le code contient un
    // commentaire qui explique justement son absence, et un test qui interdirait d'en parler
    // interdirait d'expliquer. Même piège que pour `chcp` dans le lanceur.
    const bloc = code.slice(code.indexOf("baseline("), code.indexOf("baseline(") + 800);
    const retour = /return \{[^}]*\}/.exec(bloc)?.[0] ?? "";
    assert.ok(retour.length > 0, "la référence doit renvoyer quelque chose");
    assert.ok(!/prob/.test(retour), `la référence ne doit pas produire de probabilité : ${retour}`);
  });

  it("le code généré est exécutable et lit les vraies données", async () => {
    const { dossier, gisement } = gisementComplet();
    const { code } = genererDepuisGisement(gisement, dossier);
    const fichier = join(dossier, "adapter.ts");
    writeFileSync(fichier, code, "utf-8");

    const mod = await import(`${new URL(`file:///${fichier.replace(/\\/g, "/")}`).href}?t=${Date.now()}`);
    const a = mod.default;
    const items = await a.loadItems();
    assert.equal(items.length, 40);
    assert.ok(a.predict(items[0]) !== undefined);
    assert.ok(["gagnant", "perdant"].includes(a.truth(items[0]).label));
    assert.ok(["gagnant", "perdant"].includes(a.baseline(items[0]).label));
  });

  it("sans référence trouvée, le code le dit au lieu d'en inventer une", () => {
    const d = projetJetable();
    writeFileSync(join(d, "sans-ref.json"), JSON.stringify(
      Array.from({ length: 40 }, (_, i) => ({ id: i, direction: "up", ret_1d: i % 2 ? 1 : -1 })),
    ), "utf-8");
    const g = prospecter(d).gisements[0];
    const { code, suppositions } = genererDepuisGisement(g, d);
    assert.ok(suppositions.some((s) => /AUCUNE référence/.test(s)));
    assert.match(code, /AUCUNE RÉFÉRENCE N'A ÉTÉ TROUVÉE/);
    assert.ok(!/^\s*baseline\(/m.test(code), "aucune référence ne doit être fabriquée");
  });
});
