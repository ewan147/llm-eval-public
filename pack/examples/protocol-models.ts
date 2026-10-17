// Exécution de bout en bout du protocole sur des modèles RÉELS, et double présentation.
//
//   node examples/protocol-models.ts
//
// Lit les exécutions enregistrées par `cli.ts protocol run` et produit, pour la même mesure :
//   · le rapport technique (destiné à un client),
//   · le score public (destiné à un lecteur non technique),
//   · le bêtisier reproductible,
//   · le verdict de migration entre les deux modèles.
//
// Le contrôle de cohérence tourne à chaque fois : si les deux lectures se contredisaient, ce
// script s'arrêterait plutôt que de publier.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareMigration } from "../protocols/migration.ts";
import { summarize, type ProtocolRun } from "../protocols/runner.ts";
import { buildSeries } from "../protocols/series.ts";
import { highlightsFromProtocol, renderHighlightsMarkdown } from "../report/highlights.ts";
import {
  renderMigrationHtml,
  renderMigrationMarkdown,
  renderRunMarkdown,
  renderSeriesMarkdown,
} from "../report/model-report.ts";
import { renderScorecardMarkdown, scorecardFromProtocol } from "../report/scorecard.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "sorties-protocole");
mkdirSync(OUT, { recursive: true });

const rule = (c = "─") => c.repeat(96);
const pc = (v: number) => `${(v * 100).toFixed(1)} %`;

const FILES = ["qwen3-4b.json", "gemma3-4b.json"];
const runs: ProtocolRun[] = [];
for (const f of FILES) {
  const p = resolve(OUT, f);
  if (!existsSync(p)) {
    console.error(`Manquant : ${f}. Lancer d'abord :`);
    console.error(`  node cli.ts protocol run ollama:… --save examples/sorties-protocole/${f}`);
    process.exit(1);
  }
  runs.push(JSON.parse(readFileSync(p, "utf-8")) as ProtocolRun);
}

// ══ 1. Les deux exécutions ════════════════════════════════════════════════════════════════════
console.log(rule("═"));
console.log("EXÉCUTIONS RÉELLES — suite figée reliability v1");
console.log(rule("═"));
console.log("");
console.log("  modèle                 n  juste faux refus panne  exact.   durée   jetons  juge");
console.log("  " + rule().slice(0, 92));
for (const r of runs) {
  const s = summarize(r);
  const ms = s.totalMs ?? 0;
  const tok = r.results.reduce(
    (a, x) => a + (x.cost?.inputTokens ?? 0) + (x.cost?.outputTokens ?? 0),
    0,
  );
  console.log(
    `  ${r.model.padEnd(20)} ${String(s.n).padStart(3)} ${String(s.juste).padStart(6)} `
    + `${String(s.faux).padStart(4)} ${String(s.refus).padStart(5)} ${String(s.panne).padStart(5)} `
    + `${(s.accuracy === null ? "\u2014" : pc(s.accuracy)).padStart(7)} ${(ms / 60000).toFixed(1).padStart(6)}m ${String(tok).padStart(7)}  v${r.judgeVersion}`,
  );
}

console.log("");
console.log("  par dimension");
for (const r of runs) {
  const s = summarize(r);
  const line = s.byDimension
    .map((d) => `${d.dimension} ${d.juste}/${d.n}`)
    .join("  ·  ");
  console.log(`  ${r.model.padEnd(20)} ${line}`);
}

// ══ 2. Migration ══════════════════════════════════════════════════════════════════════════════
const migration = compareMigration(runs[0], runs[1]);
console.log("");
console.log(rule("═"));
console.log(`MIGRATION ${migration.from} → ${migration.to}`);
console.log(rule("═"));
console.log("");
console.log(`  [${migration.verdict}]`);
console.log("");
for (const l of wrap(migration.statement, 92)) console.log("  " + l);
console.log("");
console.log(`  comparabilité   ${migration.comparability.verdict}`);
console.log(`  cas appariés    ${migration.paired}`);
if (migration.accuracyBefore && migration.accuracyAfter) {
  console.log(`  avant           ${pc(migration.accuracyBefore.value)} [${pc(migration.accuracyBefore.low)} – ${pc(migration.accuracyBefore.high)}]`);
  console.log(`  après           ${pc(migration.accuracyAfter.value)} [${pc(migration.accuracyAfter.low)} – ${pc(migration.accuracyAfter.high)}]`);
}
console.log(`  écart           ${(migration.accuracyDelta * 100).toFixed(1)} pt · McNemar p = ${migration.pValue?.toFixed(4) ?? "—"}`);
console.log(`  régressions     ${migration.regressions.length}   réparations ${migration.fixes.length}`);
console.log(`  coût            [${migration.cost.verdict}]`);
if (migration.cost.ratio !== null) {
  console.log(`                  rapport ${migration.cost.ratio.toFixed(2)} ×`);
}

if (migration.regressions.length > 0) {
  console.log("");
  console.log("  CE QUI MARCHAIT ET NE MARCHE PLUS");
  for (const r of migration.regressions.slice(0, 6)) {
    console.log(`    · ${r.caseId} (${r.dimension}) — ${r.prompt.slice(0, 70)}…`);
  }
}

if (migration.power) {
  console.log("");
  for (const l of wrap("  " + migration.power.assumption, 92)) console.log("  " + l);
}

// ══ 3. Double présentation, avec contrôle de cohérence ════════════════════════════════════════
console.log("");
console.log(rule("═"));
console.log("DOUBLE PRÉSENTATION — même mesure, deux lectures");
console.log(rule("═"));

for (const r of runs) {
  const card = scorecardFromProtocol(r);
  const reel = highlightsFromProtocol(r, card.runId);

  // Le lien entre les deux formats : même identifiant d'exécution, même empreinte.
  if (card.dataFingerprint !== r.suite.fingerprint) {
    throw new Error("le score public ne porte pas sur la même exécution que le rapport technique");
  }

  const slug = r.model.replace(/[^a-z0-9]+/gi, "-");
  writeFileSync(resolve(OUT, `${slug}.technique.md`), renderRunMarkdown(r), "utf-8");
  writeFileSync(resolve(OUT, `${slug}.public.md`), renderScorecardMarkdown(card), "utf-8");
  writeFileSync(resolve(OUT, `${slug}.betisier.md`), renderHighlightsMarkdown(reel), "utf-8");

  console.log("");
  console.log(`  ${r.model}  ·  exécution ${card.runId}`);
  for (const s of card.scores) {
    const v = s.value ?? "pas assez de données";
    console.log(`    ${s.label.padEnd(38)} ${v}`);
  }
  console.log(`    ${"bêtisier".padEnd(38)} ${reel.items.length} cas incontestables`);
}

// ══ 4. Série ══════════════════════════════════════════════════════════════════════════════════
const series = buildSeries(runs);
console.log("");
console.log(rule("═"));
console.log("SÉRIE LONGITUDINALE");
console.log(rule("═"));
console.log("");
for (const l of wrap(series.statement, 92)) console.log("  " + l);

writeFileSync(resolve(OUT, "migration-reelle.md"), renderMigrationMarkdown(migration), "utf-8");
writeFileSync(resolve(OUT, "migration-reelle.html"), renderMigrationHtml(migration), "utf-8");
writeFileSync(resolve(OUT, "serie-reelle.md"), renderSeriesMarkdown(series), "utf-8");

console.log("");
console.log(`Rapports écrits dans ${OUT}`);
console.log(rule("═"));

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}
