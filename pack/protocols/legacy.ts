// Import des exécutions ANTÉRIEURES au protocole — les premiers points de la série longitudinale.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CE MODULE EXISTE, ET POURQUOI IL MARQUE CE QU'IL IMPORTE.
//
// Le projet d'origine a réalisé 7 exécutions horodatées sur plusieurs modèles avant que le
// protocole n'existe. Ce sont de vraies mesures, sur de vraies réponses, avec de vraies vérités
// terrain. Les jeter serait absurde : la série longitudinale a commencé là.
//
// Mais elles n'ont PAS été produites par une suite figée. Elles portent sur 18, 6, 6, 4, 1, 11 et
// 4 cas — des ensembles différents, constitués au fil de l'eau. Deux d'entre elles seulement
// portent exactement sur les mêmes six cas.
//
// D'où la règle appliquée ici : **on importe, et on marque**. Chaque exécution importée reçoit une
// empreinte dérivée de SES PROPRES cas, jamais celle de la suite v1. Conséquence directe et
// voulue : `assertComparable()` refusera de comparer une exécution ancienne à une exécution du
// protocole, et refusera aussi de comparer entre elles deux anciennes exécutions portant sur des
// cas différents. Le refus n'est pas une limitation de cet import — c'est son résultat le plus
// utile.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { CaseResult, ProtocolRun } from "./runner.ts";
import type { SuiteStamp } from "./suite.ts";

/** Format d'une exécution du banc d'exactitude du projet d'origine. */
interface LegacyFactualRun {
  modele?: string;
  resultats?: Array<{
    cas?: string;
    variante?: string;
    secondes?: number;
    verdict?: string;
    attendu?: string;
    obtenu?: string;
    source?: string;
  }>;
}

/** Format d'une exécution du banc de capacités. */
interface LegacyCapabilityRun {
  modele?: string;
  resultats?: Array<{
    id?: string;
    capacite?: string;
    verdict?: string;
    secondes?: number;
    detail?: string;
  }>;
}

/**
 * Traduction des verdicts d'origine vers ceux du protocole.
 *
 * `echec_outil` devient `panne` et non `faux` : le modèle gemma3:4b ne supportait pas les outils,
 * l'API a renvoyé HTTP 400, et le modèle n'a jamais vu la question. Le compter comme une mauvaise
 * réponse lui attribuerait une faute qui n'est pas la sienne — c'est précisément la distinction
 * que `summarize()` maintient en sortant les pannes du dénominateur.
 */
function translateVerdict(v: string | undefined): CaseResult["verdict"] {
  switch ((v ?? "").toLowerCase()) {
    case "juste":
    case "ok":
      return "juste";
    case "faux":
      return "faux";
    case "sans_reponse":
      return "refus";
    case "echec_outil":
    case "panne":
    case "illisible":
      return "panne";
    case "echec":
      return "faux";
    default:
      return "panne";
  }
}

/** L'empreinte des cas RÉELLEMENT couverts par une exécution ancienne. */
function fingerprintOf(caseIds: string[]): string {
  const h = createHash("sha256");
  for (const id of [...caseIds].sort()) {
    h.update(id);
    h.update("␟");
  }
  return h.digest("hex").slice(0, 16);
}

/** Nom de modèle normalisé : le projet d'origine notait « (défaut) », « défaut » ou rien. */
function normalizeModel(raw: string | undefined, fallback: string): string {
  const m = (raw ?? "").trim();
  if (m === "" || m === "(défaut)" || m === "défaut" || m === "defaut") {
    // Le modèle par défaut d'Ollama à cette date, documenté dans les en-têtes des deux bancs.
    return "qwen3:4b (défaut non déclaré)";
  }
  return m;
}

/**
 * Importe un fichier d'exécution ancien.
 *
 * L'identifiant de suite porte `legacy-` en préfixe : il ne collisionne donc jamais avec une suite
 * du protocole, et le refus de comparaison est garanti par construction plutôt que par vigilance.
 */
export function importLegacyRun(path: string, fileName: string): ProtocolRun | null {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as LegacyFactualRun & LegacyCapabilityRun;
  const rows = raw.resultats ?? [];
  if (rows.length === 0) return null;

  const isCapability = fileName.startsWith("capacites-");
  const results: CaseResult[] = rows.map((r, i) => {
    const anyRow = r as Record<string, unknown>;
    const caseId = String(anyRow.cas ?? anyRow.id ?? `legacy-${i + 1}`);
    const verdict = translateVerdict(anyRow.verdict as string | undefined);
    const seconds = typeof anyRow.secondes === "number" ? anyRow.secondes : undefined;
    return {
      caseId,
      dimension: isCapability ? "capacite" : "exactitude",
      category: String(anyRow.variante ?? anyRow.capacite ?? "—"),
      verdict,
      prompt: `(énoncé non conservé par le banc d'origine — cas « ${caseId} »)`,
      reply: String(anyRow.obtenu ?? anyRow.detail ?? "").slice(0, 400),
      why:
        `Verdict d'origine « ${String(anyRow.verdict ?? "?")} », attendu `
        + `« ${String(anyRow.attendu ?? "—")} ».`,
      cost: seconds !== undefined ? { latencyMs: seconds * 1000 } : undefined,
      selfAgreement: null,
    };
  });

  const caseIds = results.map((r) => r.caseId);
  const suite: SuiteStamp = {
    id: `legacy-${isCapability ? "capacites" : "exactitude"}`,
    version: 0,
    fingerprint: fingerprintOf(caseIds),
    caseCount: caseIds.length,
  };

  // L'horodatage est dans le nom de fichier : 2026-09-02T22-26-28-564Z.json
  const stampMatch = fileName.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  const runAt = stampMatch
    ? `${stampMatch[1]}T${stampMatch[2]}:${stampMatch[3]}:${stampMatch[4]}.000Z`
    : new Date(0).toISOString();

  return {
    model: normalizeModel(raw.modele, fileName),
    runAt,
    suite,
    results,
    complete: true,
    stoppedBecause: null,
    callsUsed: results.length,
    budget: { maxCalls: results.length },
    exclusions: [
      {
        capability: "tâches planifiées, contrôle machine, délégation",
        reason:
          "Exclues à la source par le banc d'origine : effets qui survivent au test. "
          + "L'exclusion est reprise telle quelle.",
      },
    ],
    suiteFindings: [
      {
        severity: "avertissement",
        caseId: "(suite entière)",
        problem:
          "Exécution ANTÉRIEURE au protocole : les cas n'ont pas été figés ni versionnés, et les "
          + "énoncés n'ont pas été conservés. Utilisable comme point de série, jamais comme "
          + "référence de comparaison face à une exécution du protocole.",
      },
    ],
  };
}

/** Importe toutes les exécutions anciennes d'un dossier, les plus récentes en dernier. */
export function importLegacyDirectory(dir: string): ProtocolRun[] {
  const runs: ProtocolRun[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const run = importLegacyRun(join(dir, f), f);
    if (run) runs.push(run);
  }
  return runs;
}

/**
 * Regroupe les exécutions importées par empreinte.
 *
 * Le résultat dit d'un coup d'œil ce qui est comparable à quoi — et c'est presque toujours moins
 * que ce qu'on croyait.
 */
export function comparableGroups(
  runs: ProtocolRun[],
): Array<{ fingerprint: string; caseCount: number; models: string[]; runs: ProtocolRun[] }> {
  const groups = new Map<string, ProtocolRun[]>();
  for (const r of runs) {
    const list = groups.get(r.suite.fingerprint);
    if (list) list.push(r);
    else groups.set(r.suite.fingerprint, [r]);
  }
  return [...groups.entries()]
    .map(([fingerprint, list]) => ({
      fingerprint,
      caseCount: list[0].suite.caseCount,
      models: [...new Set(list.map((r) => r.model))],
      runs: list,
    }))
    .sort((a, b) => b.runs.length - a.runs.length);
}
