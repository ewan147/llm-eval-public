#!/usr/bin/env node
// eval-pack — trois commandes, aucune configuration.
//
//   node cli.ts run <adaptateur> [options]        mesure et affiche
//   node cli.ts audit <adaptateur> [options]      rapport HTML autonome, présentable à un client
//   node cli.ts compare <a> <b>                   dérive entre deux exécutions ou deux adaptateurs
//
// <adaptateur> est soit un nom du dossier adapters/ (« classifier »), soit un chemin vers un
// fichier .ts qui exporte un Adapter par défaut.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { detectDrift } from "./core/drift.ts";
import { setLang, type Lang } from "./core/i18n.ts";
import { evaluate, type EvalResult } from "./core/evaluate.ts";
import type { Adapter, EvalOptions } from "./core/types.ts";
import { renderConsole, renderDefectsConsole, renderDriftConsole } from "./report/console.ts";
import { renderDriftHtml, renderHtml } from "./report/html.ts";
import { comparableGroups, importLegacyDirectory } from "./protocols/legacy.ts";
import { compareMigration } from "./protocols/migration.ts";
import { runProtocol, type ProtocolRun } from "./protocols/runner.ts";
import { buildSeries } from "./protocols/series.ts";
import { makeModelFn, parseModelSpec, ping } from "./protocols/models.ts";
import { auditSuite, isUsable, stamp } from "./protocols/suite.ts";
import reliabilityV2 from "./protocols/suites/reliability-v2.ts";
import disciplinesV1 from "./protocols/suites/disciplines-v1.ts";

/** Les suites disponibles. `--suite` choisit ; par défaut, `reliability`. */
const SUITES = { reliability: reliabilityV2, disciplines: disciplinesV1 } as const;

function suiteChoisie(argv: string[]) {
  const i = argv.indexOf("--suite");
  const nom = i >= 0 ? argv[i + 1] : "reliability";
  const s = (SUITES as Record<string, typeof reliabilityV2>)[nom ?? "reliability"];
  return s ?? reliabilityV2;
}
import {
  renderMigrationHtml,
  renderMigrationMarkdown,
  renderRunMarkdown,
  renderSeriesMarkdown,
} from "./report/model-report.ts";
import { highlightsFromEval, highlightsFromProtocol, renderHighlightsMarkdown } from "./report/highlights.ts";
import {
  checkConsistency,
  renderScorecardMarkdown,
  scorecardFromEval,
  scorecardFromProtocol,
} from "./report/scorecard.ts";
import { renderDriftMarkdown, renderMarkdown } from "./report/markdown.ts";

const here = dirname(fileURLToPath(import.meta.url));

interface Flags {
  format: "console" | "md" | "html";
  lang: Lang;
  out?: string;
  save?: string;
  client?: string;
  scope?: string;
  defects: boolean;
  options: EvalOptions & { maxCalls?: number; maxEur?: number; maxMs?: number };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const flags = parseFlags(argv);
  // La langue doit être posée AVANT la première évaluation : les verdicts sont construits pendant
  // le calcul, pas au rendu.
  setLang(flags.lang);

  switch (command) {
    case "run": {
      const target = positional(argv, 1);
      if (!target) return fail("`run` attend un adaptateur.\n" + USAGE);
      const result = await runAdapter(target, flags.options);
      emit(result, flags, false);
      if (flags.save) saveRun(result, flags.save);
      // Code de sortie : 1 quand le pack REFUSE de conclure ou quand le système est moins bon.
      // C'est ce qui permet de brancher `run` sur une CI sans écrire de script d'analyse.
      return result.refusal || result.contrastive?.verdict === "MOINS BON" ? 1 : 0;
    }

    case "audit": {
      const target = positional(argv, 1);
      if (!target) return fail("`audit` attend un adaptateur.\n" + USAGE);
      const result = await runAdapter(target, flags.options);
      const out = flags.out ?? `audit-${slug(result.adapter)}.html`;
      write(out, renderHtml(result, {
        audit: true,
        client: flags.client,
        scope: flags.scope,
      }));
      console.error(renderConsole(result));
      console.error("");
      console.error(renderDefectsConsole(result));
      console.error("");
      console.error(`Rapport d'audit écrit : ${out}`);
      if (flags.save) saveRun(result, flags.save);
      return 0;
    }

    case "compare": {
      const a = positional(argv, 1);
      const b = positional(argv, 2);
      if (!a || !b) return fail("`compare` attend deux arguments.\n" + USAGE);
      const before = await loadOrRun(a, flags.options);
      const after = await loadOrRun(b, flags.options);
      const drift = detectDrift(before, after);
      if (flags.format === "html") {
        const out = flags.out ?? "drift.html";
        write(out, renderDriftHtml(drift));
        console.error(`Rapport de dérive écrit : ${out}`);
      } else if (flags.format === "md") {
        output(renderDriftMarkdown(drift), flags.out);
      } else {
        output(renderDriftConsole(drift), flags.out);
      }
      return drift.verdict === "DÉGRADATION" ? 1 : 0;
    }

    case "protocol":
      return await protocolCommand(positional(argv, 1), argv, flags);

    case "chess":
    case "echecs":
      return await commandeEchecs(positional(argv, 1), argv, flags);

    case "prospect":
    case "prospecter": {
      const cible = positional(argv, 1);
      if (!cible) return fail("`prospect` attend un dossier de projet.");
      const { prospecter } = await import("./scaffold/prospecteur.ts");
      const { genererDepuisGisement } = await import("./scaffold/generateur.ts");
      const dossier = absolute(cible);

      console.log(`Prospection de ${dossier}`);
      console.log("");
      const p = prospecter(dossier);

      if (p.gisements.length === 0) {
        console.log("Aucune source de données exploitable.");
        console.log("");
        console.log(p.conclusion);
        return 1;
      }

      console.log("note  source   table / fichier                  lignes   ce qui a été reconnu");
      console.log("".padEnd(96, "-"));
      for (const g of p.gisements.slice(0, 15)) {
        const roles = ["prediction", "issue", "reference"]
          .filter((r) => g.colonnes.some((c) => c.role === r))
          .join(" + ") || "rien d'exploitable";
        console.log(
          `${String(g.note).padStart(4)}  ${g.origine.padEnd(8)} ${g.nom.slice(0, 30).padEnd(31)} `
          + `${(g.lignes === null ? "schéma" : String(g.lignes)).padStart(6)}   ${roles}`,
        );
      }

      const meilleur = p.gisements[0];
      console.log("");
      console.log(`Détail du meilleur gisement : ${meilleur.nom}`);
      for (const role of ["prediction", "issue", "reference", "temps", "identite"] as const) {
        const cols = meilleur.colonnes.filter((c) => c.role === role);
        if (cols.length === 0) continue;
        console.log(`  ${role.padEnd(11)} ${cols.map((c) => c.nom).join(", ")}`);
      }
      if (meilleur.manques.length > 0) {
        console.log("");
        console.log("  Ce qui manque :");
        for (const m of meilleur.manques) console.log(`    · ${m}`);
      }

      if (p.ecartes.length > 0) {
        console.log("");
        console.log(`${p.ecartes.length} fichier(s) écarté(s). Les cinq premiers :`);
        for (const e of p.ecartes.slice(0, 5)) console.log(`  · ${e.chemin} — ${e.raison}`);
      }

      console.log("");
      for (const l of decouper(p.conclusion, 92)) console.log(l);

      // `--generer` écrit l'adaptateur. Sans ce drapeau, la prospection ne touche à rien.
      if (argv.includes("--generer") || argv.includes("--generate")) {
        const { code, suppositions } = genererDepuisGisement(meilleur, dossier);
        const dossierEval = resolvePath(dossier, "eval");
        mkdirSync(dossierEval, { recursive: true });
        const fichier = resolvePath(dossierEval, `adapter-${slug(meilleur.nom)}.ts`);
        write(fichier, code);
        console.log("");
        console.log(`Adaptateur écrit : ${fichier}`);
        console.log("");
        console.log("CE QUE LE GÉNÉRATEUR A DEVINÉ, et qu'il faut vérifier :");
        for (const sup of suppositions) console.log(`  · ${sup}`);
        console.log("");
        console.log(`  node cli.ts run ${fichier}`);
      } else {
        console.log("");
        console.log("Rien n'a été écrit. Ajouter --generer pour produire l'adaptateur.");
      }
      return 0;
    }

    case "init": {
      const cible = positional(argv, 1);
      if (!cible) return fail(`\`init\` attend un dossier de projet.\n${USAGE}`);
      const { diagnostiquer, genererAdaptateur } = await import("./scaffold/adaptateur.ts");
      const dossier = absolute(cible);
      const d = diagnostiquer(dossier);
      console.log(`Projet : ${dossier}`);
      if (d.indices.length > 0) console.log(`Ce qui a été reconnu : ${d.indices.join(", ")}`);
      console.log(`Famille supposée : ${d.famille}`);
      if (d.adaptateurs.length > 0) {
        console.log("");
        console.log("Adaptateurs déjà présents :");
        for (const a of d.adaptateurs) console.log(`  · ${a}`);
      }
      const r = genererAdaptateur(dossier, { force: flags.defects });
      console.log("");
      console.log(r.message);
      if (r.ok) {
        console.log("");
        console.log("Il tourne déjà, et il REFUSE de conclure — c'est voulu :");
        console.log(`  node cli.ts run ${r.fichier}`);
        console.log("");
        console.log("Les quatre TODO à remplir sont vos cas, votre système, votre vérité");
        console.log("terrain, et la référence à battre. Le reste est déjà fait.");
      }
      return r.ok ? 0 : 1;
    }

    case "scorecard": {
      const target = positional(argv, 1);
      if (!target) return fail("`scorecard` attend un adaptateur.");
      const result = await runAdapter(target, flags.options);
      const card = scorecardFromEval(result);

      // Garde-fou de la phase 4 : les deux lectures ne doivent jamais se contredire.
      const problems = checkConsistency(result, card);
      if (problems.length > 0) {
        console.error("INCOHÉRENCE entre le score public et le rapport d'entreprise :");
        for (const p of problems) console.error(`  · ${p}`);
        return 2;
      }

      const reel = highlightsFromEval(result, card.runId);
      output(`${renderScorecardMarkdown(card)}
${renderHighlightsMarkdown(reel)}`, flags.out);
      return 0;
    }

    default:
      return fail(`Commande inconnue : ${command}\n${USAGE}`);
  }
}

// ── Le protocole d'évaluation des modèles ─────────────────────────────────────────────────────

/**
 * `protocol audit`   vérifie la suite figée AVANT de dépenser le moindre appel
 * `protocol import`  importe des exécutions antérieures comme points de série
 * `protocol compare` compare deux exécutions enregistrées
 * `protocol series`  affiche la série longitudinale
 */
async function protocolCommand(
  sub: string | undefined,
  argv: string[],
  flags: Flags,
): Promise<number> {
  switch (sub) {
    case "ping": {
      const spec = parseModelSpec(positional(argv, 2) ?? "");
      if (!spec.model) return fail("`protocol ping` attend un modèle, ex. ollama:qwen3:4b");
      const r = await ping(spec);
      console.log(`${spec.provider}:${spec.model} — ${r.ok ? "OK" : "INJOIGNABLE"}`);
      console.log(`  ${r.detail}`);
      return r.ok ? 0 : 1;
    }

    case "run": {
      const raw = positional(argv, 2);
      if (!raw) return fail("`protocol run` attend un modèle, ex. ollama:qwen3:4b");
      const spec = parseModelSpec(raw);
      const maxCalls = flags.options.maxCalls ?? 200;

      // Garde-fou : la suite est auditée avant le premier appel, donc avant la première dépense.
      const suite = suiteChoisie(argv);
      const findings = auditSuite(suite);
      if (!isUsable(findings)) {
        console.error("Suite refusée avant tout appel :");
        for (const f of findings) console.error(`  [${f.severity}] ${f.caseId} — ${f.problem}`);
        return 1;
      }

      const st = stamp(suite);
      console.error(`Suite ${st.id} v${st.version} (${st.caseCount} cas, ${st.fingerprint})`);
      console.error(`Modèle ${spec.provider}:${spec.model} · plafond ${maxCalls} appels`);
      console.error("");

      const run = await runProtocol({
        suite,
        model: `${spec.provider}:${spec.model}`,
        ask: makeModelFn(spec),
        budget: { maxCalls, maxEur: flags.options.maxEur, maxMs: flags.options.maxMs },
      });

      const out = flags.save ?? `run-${spec.model.replace(/[^a-z0-9]+/gi, "-")}.json`;
      write(out, `${JSON.stringify(run, null, 1)}
`);
      console.error(`Exécution sauvegardée : ${out}`);
      console.error("");
      output(renderRunMarkdown(run), flags.out);
      return run.complete ? 0 : 1;
    }

    case "scorecard": {
      const file = positional(argv, 2);
      if (!file) return fail("`protocol scorecard` attend un fichier d'exécution.");
      const card = scorecardFromProtocol(loadRun(file));
      output(renderScorecardMarkdown(card), flags.out);
      return 0;
    }

    case "highlights": {
      const file = positional(argv, 2);
      if (!file) return fail("`protocol highlights` attend un fichier d'exécution.");
      const run = loadRun(file);
      const reel = highlightsFromProtocol(run, `${run.suite.fingerprint}-${run.runAt.slice(0, 10)}`);
      output(renderHighlightsMarkdown(reel), flags.out);
      return 0;
    }

    case "audit": {
      const suite = suiteChoisie(argv);
      const findings = auditSuite(suite);
      const st = stamp(suite);
      console.log(`Suite « ${st.id} » v${st.version} — ${st.caseCount} cas`);
      console.log(`Empreinte des cas : ${st.fingerprint}`);
      console.log("");
      if (findings.length === 0) {
        console.log("Aucun problème : aucune preuve attendue ne figure dans son propre énoncé.");
      } else {
        for (const f of findings) console.log(`  [${f.severity}] ${f.caseId} — ${f.problem}`);
      }
      console.log("");
      console.log("Capacités volontairement non testées :");
      for (const e of suite.exclusions) console.log(`  · ${e.capability} — ${e.reason}`);
      return isUsable(findings) ? 0 : 1;
    }

    case "import": {
      const dir = positional(argv, 2);
      if (!dir) return fail("`protocol import` attend un dossier d'exécutions.");
      const runs = importLegacyDirectory(dir);
      const out = flags.out ?? "runs-importees.json";
      write(out, `${JSON.stringify(runs, null, 1)}\n`);
      console.log(`${runs.length} exécution(s) importée(s) → ${out}`);
      for (const g of comparableGroups(runs)) {
        const flag = g.models.length >= 2 ? "COMPARABLE" : "un seul modèle";
        console.log(`  ${g.fingerprint}  ${String(g.caseCount).padStart(3)} cas · ${flag} · ${g.models.join(" / ")}`);
      }
      return 0;
    }

    case "compare": {
      const fileA = positional(argv, 2);
      const fileB = positional(argv, 3);
      if (!fileA || !fileB) return fail("`protocol compare` attend deux fichiers d'exécution.");
      const a = loadRun(fileA);
      const b = loadRun(fileB);
      const m = compareMigration(a, b);
      if (flags.format === "html") {
        const out = flags.out ?? "migration.html";
        write(out, renderMigrationHtml(m));
        console.error(`Rapport de migration écrit : ${out}`);
      } else {
        output(renderMigrationMarkdown(m), flags.out);
      }
      return m.verdict === "NE PAS MIGRER" || m.verdict === "COMPARAISON REFUSÉE" ? 1 : 0;
    }

    case "series": {
      const file = positional(argv, 2);
      if (!file) return fail("`protocol series` attend un fichier d'exécutions importées.");
      const runs = JSON.parse(readFileSync(absolute(file), "utf-8")) as ProtocolRun[];
      output(renderSeriesMarkdown(buildSeries(runs)), flags.out);
      return 0;
    }

    case "report": {
      const file = positional(argv, 2);
      if (!file) return fail("`protocol report` attend un fichier d'exécution.");
      output(renderRunMarkdown(loadRun(file)), flags.out);
      return 0;
    }

    default:
      return fail(
        `Sous-commande inconnue. Attendu : audit · import · compare · series · report.\n${USAGE}`,
      );
  }
}

function absolute(p: string): string {
  return isAbsolute(p) ? p : resolvePath(process.cwd(), p);
}

/** Charge une exécution : un fichier contenant un objet, ou un tableau dont on prend le premier. */
function loadRun(file: string): ProtocolRun {
  const parsed = JSON.parse(readFileSync(absolute(file), "utf-8")) as ProtocolRun | ProtocolRun[];
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error(`${file} ne contient aucune exécution.`);
    return parsed[0];
  }
  return parsed;
}

// ── Chargement d'un adaptateur ────────────────────────────────────────────────────────────────

/**
 * Résout un adaptateur : nom court du dossier `adapters/`, ou chemin vers un fichier.
 *
 * Le module doit exporter un `Adapter` en export par défaut, ou une fonction par défaut qui en
 * rend un. Les deux formes marchent pour qu'un adaptateur paramétré reste possible.
 */
async function loadAdapter(target: string): Promise<Adapter<unknown>> {
  const candidates = target.endsWith(".ts") || target.includes("/") || target.includes("\\")
    ? [isAbsolute(target) ? target : resolvePath(process.cwd(), target)]
    : [resolvePath(here, "adapters", `${target}.ts`), resolvePath(process.cwd(), `${target}.ts`)];

  let lastError: unknown;
  for (const path of candidates) {
    try {
      const mod = (await import(pathToFileURL(path).href)) as {
        default?: unknown;
        adapter?: unknown;
      };
      const raw = mod.default ?? mod.adapter;
      const resolved = typeof raw === "function" ? (raw as () => unknown)() : raw;
      if (isAdapter(resolved)) return resolved;
      throw new Error(
        `${path} n'exporte pas d'Adapter valide. Attendu : un export par défaut avec name, `
        + "loadItems, predict et truth.",
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Adaptateur introuvable : ${target}`);
}

function isAdapter(v: unknown): v is Adapter<unknown> {
  const a = v as Adapter<unknown> | null;
  return (
    !!a
    && typeof a === "object"
    && typeof a.name === "string"
    && typeof a.loadItems === "function"
    && typeof a.predict === "function"
    && typeof a.truth === "function"
  );
}

async function runAdapter(target: string, options: EvalOptions): Promise<EvalResult> {
  const adapter = await loadAdapter(target);
  return evaluate(adapter, options);
}

/** Un argument de `compare` est soit un fichier d'exécution sauvegardé, soit un adaptateur. */
async function loadOrRun(target: string, options: EvalOptions): Promise<EvalResult> {
  if (target.endsWith(".json")) {
    const path = isAbsolute(target) ? target : resolvePath(process.cwd(), target);
    return JSON.parse(readFileSync(path, "utf-8")) as EvalResult;
  }
  return runAdapter(target, options);
}

// ── Sortie ────────────────────────────────────────────────────────────────────────────────────

function emit(result: EvalResult, flags: Flags, forceDefects: boolean): void {
  const withDefects = flags.defects || forceDefects;
  if (flags.format === "html") {
    const out = flags.out ?? `rapport-${slug(result.adapter)}.html`;
    write(out, renderHtml(result, { audit: false }));
    console.error(`Rapport écrit : ${out}`);
    return;
  }
  if (flags.format === "md") {
    output(renderMarkdown(result, { defects: withDefects }), flags.out);
    return;
  }
  const text = withDefects
    ? `${renderConsole(result)}\n\n${renderDefectsConsole(result)}`
    : renderConsole(result);
  output(text, flags.out);
}

function output(text: string, out?: string): void {
  if (out) {
    write(out, text.endsWith("\n") ? text : `${text}\n`);
    console.error(`Écrit : ${out}`);
  } else {
    console.log(text);
  }
}

function write(path: string, content: string): void {
  const full = isAbsolute(path) ? path : resolvePath(process.cwd(), path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

/** Sauvegarde une exécution complète, pour `compare` plus tard. */
function saveRun(result: EvalResult, path: string): void {
  write(path, `${JSON.stringify(result, null, 1)}\n`);
  console.error(`Exécution sauvegardée : ${path}`);
}

// ── Arguments ─────────────────────────────────────────────────────────────────────────────────

function parseFlags(argv: string[]): Flags {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const int = (name: string): number | undefined => {
    const v = get(name);
    return v === undefined ? undefined : Number(v);
  };

  const format = (get("format") ?? "console") as Flags["format"];
  if (!["console", "md", "html"].includes(format)) {
    throw new Error(`--format doit valoir console, md ou html (reçu « ${format} »)`);
  }

  const lang = (get("lang") ?? "fr") as Lang;
  if (!["fr", "en"].includes(lang)) {
    throw new Error(`--lang doit valoir fr ou en (reçu « ${lang} »)`);
  }

  return {
    format,
    lang,
    out: get("out"),
    save: get("save"),
    client: get("client"),
    scope: get("scope"),
    defects: has("defects"),
    options: {
      minObs: int("min-obs"),
      bootstrapSamples: int("bootstrap"),
      seed: int("seed"),
      k: int("k"),
      concurrency: int("concurrency"),
      maxCalls: int("max-calls"),
      maxEur: int("max-eur"),
      maxMs: int("max-ms"),
      bins: get("bins")?.split(",").map(Number),
    },
  };
}

/** Le n-ième argument qui n'est ni une option ni la valeur d'une option. */
function positional(argv: string[], index: number): string | undefined {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (!BOOLEAN_FLAGS.has(argv[i])) i++;
      continue;
    }
    out.push(argv[i]);
  }
  return out[index];
}

const BOOLEAN_FLAGS = new Set(["--defects", "--ouvrir", "--open"]);

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "rapport";
}

function fail(message: string): number {
  console.error(message);
  return 2;
}

const USAGE = `eval-pack — évaluer un système d'IA sans se raconter d'histoires

  node cli.ts run <adaptateur> [options]
  node cli.ts audit <adaptateur> [options]
  node cli.ts compare <a> <b> [options]

  node cli.ts protocol audit                    vérifie la suite figée
  node cli.ts protocol import <dossier>         importe des exécutions passées
  node cli.ts protocol compare <a.json> <b.json>  verdict de migration
  node cli.ts protocol series <runs.json>       série longitudinale
  node cli.ts protocol ping <modèle>            le modèle répond-il ?
  node cli.ts protocol run <modèle>             passe la suite figée au modèle
  node cli.ts protocol report <run.json>        rapport d'une exécution
  node cli.ts protocol scorecard <run.json>     score public d'un modèle
  node cli.ts protocol highlights <run.json>    les cas d'échec les plus nets

  node cli.ts scorecard <adaptateur>            score public + bêtisier

  node cli.ts init <dossier>                    crée un squelette d'adaptateur pour un
                                                projet existant, prêt à tourner
  node cli.ts prospect <dossier> [--generer]    cherche dans le projet les données qui
                                                permettraient de l'évaluer, et écrit le code

  node cli.ts echecs audit                      vérifie les positions du banc d'échecs
  node cli.ts echecs run <modèle>               légalité, mat en 1, mat en 2
  node cli.ts echecs duel <modèle> <modèle>     N parties, couleurs alternées

<modèle>       ollama:qwen3:4b · openai:gpt-4o-mini · anthropic:claude-… · replay:fichier.json
               Sans préfixe, Ollama est supposé (seul fournisseur sans clé).

<adaptateur>   nom d'un fichier de adapters/ (« forecast ») ou chemin vers un .ts
               qui exporte un Adapter par défaut.
<a> <b>        pour compare : deux adaptateurs, ou deux fichiers .json produits
               par --save (c'est le mode détection de dérive).

Options
  --format console|md|html   sortie (défaut : console)
  --lang fr|en               langue des rapports (défaut : fr)
  --out <fichier>            écrire dans un fichier au lieu de la sortie standard
  --save <fichier.json>      sauvegarder l'exécution complète, pour compare
  --defects                  ajouter la liste des défauts (audit l'inclut toujours)
  --client <nom>             audit : destinataire affiché en page de garde
  --scope <texte>            audit : périmètre affiché en page de garde
  --suite <nom>              protocol : reliability (défaut) ou disciplines
  --max-calls <n>            plafond d'appels au modèle (défaut : 200)
  --max-eur <n>              plafond de coût monétaire
  --max-ms <n>               plafond de durée totale
  --min-obs <n>              seuil de conclusion par tranche (défaut : 30)
  --bootstrap <n>            rééchantillonnages (défaut : 2000)
  --seed <n>                 graine pseudo-aléatoire (défaut : 20260905)
  --k <n>                    profondeur pour la récupération@k (défaut : 5)
  --bins <a,b,c>             coupures de confiance (défaut : déciles)
  --concurrency <n>          appels parallèles à l'adaptateur (défaut : 8)

Code de sortie : 1 si le pack refuse de conclure faute de référence, ou si le
système est mesuré MOINS BON que sa référence. Utilisable tel quel en CI.`;

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 2;
  });

// ── Échecs ────────────────────────────────────────────────────────────────────────────────────

async function commandeEchecs(sub: string | undefined, argv: string[], flags: Flags): Promise<number> {
  const { auditerEchecs, CAS } = await import("./games/chess/epreuve.ts");
  const { duel, lancerEchecs } = await import("./games/chess/lanceur.ts");
  const { makeModelFn, parseModelSpec } = await import("./protocols/models.ts");

  switch (sub) {
    case "audit": {
      const defauts = auditerEchecs();
      console.log(`Banc d'échecs — ${CAS.length} positions`);
      console.log("");
      if (defauts.length === 0) {
        console.log("Aucun défaut : chaque position tient ce qu'elle annonce.");
        console.log("Les solutions ne sont pas stockées, elles sont recalculées par le moteur.");
      } else {
        for (const d of defauts) console.log(`  [refusé] ${d.casId} — ${d.probleme}`);
      }
      return defauts.length === 0 ? 0 : 1;
    }

    case "run": {
      const brut = positional(argv, 2);
      if (!brut) return fail("`echecs run` attend un modèle, ex. ollama:qwen3:4b");
      const spec = parseModelSpec(brut);
      const modele = `${spec.provider}:${spec.model}`;
      console.error(`Banc d'échecs · ${modele} · ${CAS.length} positions`);
      console.error("");

      const r = await lancerEchecs({
        modele,
        demander: makeModelFn(spec),
        maxAppels: flags.options.maxCalls ?? 100,
        maxMs: flags.options.maxMs,
        surAvancee: (e) => console.error(`  ${e.fait}/${e.total}  ${e.casId}  ${e.verdict}`),
      });

      console.error("");
      const s = r.resume;
      console.log(`modèle            ${r.modele}`);
      console.log(`juge d'échecs     v${r.versionJuge}`);
      console.log(`positions         ${s.n}`);
      console.log(`juste             ${s.juste}`);
      console.log(`légal mais faux   ${s.faux}`);
      console.log(`coup illégal      ${s.illegal}`);
      console.log(`aucun coup lisible ${s.illisible}`);
      console.log(`panne             ${s.panne}`);
      console.log(`taux de légalité  ${s.tauxLegalite === null ? "—" : (s.tauxLegalite * 100).toFixed(1) + " %"}`);
      console.log(`réponses vides    ${s.vide}`);
      console.log(`longueur médiane  ${s.longueurMediane} caractères`);
      if (s.longueurMediane > 200) {
        console.log("");
        console.log("  ATTENTION À LA LECTURE : la consigne demande le coup SEUL. Avec des réponses");
        console.log("  aussi longues, ce banc mesure d'abord un défaut de suivi de consigne, et non");
        console.log("  une ignorance des règles. Les verdicts « illisible » disent cela.");
      }
      console.log("");
      for (const e of s.parEpreuve) console.log(`  ${e.epreuve.padEnd(10)} ${e.juste}/${e.n}`);
      if (r.arreteParce) {
        console.log("");
        console.log(r.arreteParce);
      }
      if (flags.save) write(flags.save, `${JSON.stringify(r, null, 1)}
`);
      return r.complete ? 0 : 1;
    }

    case "duel": {
      const a = positional(argv, 2);
      const b = positional(argv, 3);
      if (!a || !b) return fail("`echecs duel` attend deux modèles.");
      const sa = parseModelSpec(a);
      const sb = parseModelSpec(b);
      const parties = flags.options.maxCalls ?? 5;

      console.error(`Duel : ${sa.model} contre ${sb.model} · ${parties} parties, couleurs alternées`);
      console.error("");

      const d = await duel(
        { nom: `${sa.provider}:${sa.model}`, demander: makeModelFn(sa) },
        { nom: `${sb.provider}:${sb.model}`, demander: makeModelFn(sb) },
        parties,
        { maxDemiCoups: 120, essais: 3 },
      );

      for (const [i, p] of d.parties.entries()) {
        console.log(`Partie ${i + 1} — ${p.blancs} (blancs) contre ${p.noirs} (noirs)`);
        console.log(`  ${p.resultat}  ·  ${p.demiCoupsJoues} demi-coups  ·  illégaux ${p.illegaux.blancs}/${p.illegaux.noirs}`);
        console.log(`  ${p.cause}`);
        if (p.coups.length > 0) console.log(`  ${p.coups.slice(0, 24).join(" ")}${p.coups.length > 24 ? " …" : ""}`);
        console.log("");
      }
      console.log(`Score  ${d.blancs} ${d.points.a} — ${d.points.b} ${d.noirs}`);
      console.log("");
      console.log(d.verdict);
      if (flags.save) write(flags.save, `${JSON.stringify(d, null, 1)}
`);
      return 0;
    }

    default:
      return fail("`echecs` attend : audit, run, duel.");
  }
}

/** Découpe un texte en lignes d'au plus `largeur` caractères, sans couper les mots. */
function decouper(texte: string, largeur: number): string[] {
  const out: string[] = [];
  let ligne = "";
  for (const mot of texte.split(/\s+/)) {
    if (ligne.length + mot.length + 1 > largeur) {
      out.push(ligne);
      ligne = mot;
    } else ligne = ligne ? `${ligne} ${mot}` : mot;
  }
  if (ligne) out.push(ligne);
  return out;
}
