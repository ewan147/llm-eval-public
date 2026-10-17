// Exécution complète de bout en bout, sur les six adaptateurs livrés.
//
//   node examples/run-all.ts
//
// Produit : un résumé console, un rapport Markdown et un audit HTML par adaptateur, deux
// exécutions sauvegardées, et une comparaison de dérive. Tout ce que le README et les guides
// montrent sort d'ici — rien n'est recopié à la main.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { detectDrift } from "../core/drift.ts";
import { evaluate, type EvalResult } from "../core/evaluate.ts";
import type { Adapter } from "../core/types.ts";
import { renderDriftConsole } from "../report/console.ts";
import { renderHtml } from "../report/html.ts";
import { renderMarkdown } from "../report/markdown.ts";
import { verdictBadge } from "../report/shared.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "sorties");
mkdirSync(OUT, { recursive: true });

const CIBLES = [
  { fichier: "../adapters/forecast.ts", court: "forecast" },
  { fichier: "../adapters/classifier.ts", court: "classifier" },
  { fichier: "../adapters/agent-task.ts", court: "agent-task" },
  { fichier: "../adapters/rag.ts", court: "rag" },
  { fichier: "./moderation.ts", court: "moderation" },
  { fichier: "../adapters/judge.ts", court: "judge" },
];

const pc = (v: number) => `${(v * 100).toFixed(1)} %`;

async function charger(chemin: string): Promise<Adapter<unknown>> {
  const mod = (await import(pathToFileURL(resolve(here, chemin)).href)) as { default: unknown };
  const raw = mod.default;
  return (typeof raw === "function" ? (raw as () => unknown)() : raw) as Adapter<unknown>;
}

const resultats: Array<{ court: string; r: EvalResult }> = [];

for (const cible of CIBLES) {
  const adaptateur = await charger(cible.fichier);
  const r = await evaluate(adaptateur, { bootstrapSamples: 2000 });
  resultats.push({ court: cible.court, r });

  writeFileSync(resolve(OUT, `${cible.court}.md`), renderMarkdown(r, { defects: true }), "utf-8");
  writeFileSync(
    resolve(OUT, `${cible.court}.audit.html`),
    renderHtml(r, { audit: true, scope: `${r.n} cas fournis par l'adaptateur.` }),
    "utf-8",
  );
}

// ── Résumé ────────────────────────────────────────────────────────────────────────────────────
const L: string[] = [];
L.push("═".repeat(96));
L.push("EXÉCUTION COMPLÈTE — six adaptateurs");
L.push("═".repeat(96));
L.push("");
L.push("  adaptateur     n      verdict                        détail");
L.push("  " + "─".repeat(92));

for (const { court, r } of resultats) {
  const detail = r.contrastive
    ? `${r.contrastive.n} cas appariés`
      + (r.contrastive.probabilistic
        ? `, Brier ${r.contrastive.probabilistic.systemBrier.value.toFixed(4)} contre `
          + `${r.contrastive.probabilistic.baselineBrier.value.toFixed(4)}`
        : `, McNemar p = ${r.contrastive.binary?.mcnemar.pValue.toFixed(4) ?? "—"}`)
    : "aucune référence fournie";
  L.push(
    `  ${court.padEnd(13)} ${String(r.n).padStart(5)}  ${verdictBadge(r).padEnd(29)} ${detail}`,
  );
}

L.push("");
L.push("  Taux de réussite et intervalles");
L.push("  " + "─".repeat(92));
for (const { court, r } of resultats) {
  L.push(
    `  ${court.padEnd(13)} `
    + (r.binary
      ? `${pc(r.binary.successRate.value).padStart(7)}  [${pc(r.binary.successRate.low)} – ${pc(r.binary.successRate.high)}]`
      : `Brier ${r.probabilistic!.brier.value.toFixed(4)}  `
        + `[${r.probabilistic!.brier.low.toFixed(4)} – ${r.probabilistic!.brier.high.toFixed(4)}]`),
  );
}

// ── Dérive : deux versions du même agent, sur le même jeu de test ─────────────────────────────
const v1 = await evaluate(await charger("./agent-v1-only.ts"), { bootstrapSamples: 2000 });
const v2 = resultats.find((x) => x.court === "agent-task")!.r;
const drift = detectDrift(v1, v2);
writeFileSync(resolve(OUT, "v1.json"), JSON.stringify(v1, null, 1), "utf-8");
writeFileSync(resolve(OUT, "v2.json"), JSON.stringify(v2, null, 1), "utf-8");

L.push("");
L.push(renderDriftConsole(drift));
L.push("");
L.push(`Rapports écrits dans ${OUT}`);

const resume = L.join("\n");
writeFileSync(resolve(OUT, "resume.txt"), `${resume}\n`, "utf-8");
console.log(resume);
