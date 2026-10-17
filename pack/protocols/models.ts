// Les adaptateurs de MODÈLE — le seul endroit du pack qui parle à un fournisseur.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// OÙ CE FICHIER A LE DROIT D'EXISTER, ET POURQUOI PAS AILLEURS.
//
// `REGLES.md` §8 : « Pas d'appel à une API de LLM depuis core/. Le cœur ne fait que du calcul sur
// des données déjà produites. Les appels de modèle vivent dans les adaptateurs. »
//
// C'est donc ici, dans `protocols/`, et nulle part ailleurs. `core/` n'importe pas ce fichier, et
// ne le fera jamais : on doit pouvoir recalculer toutes les métriques d'un protocole à partir des
// résultats enregistrés, sans réseau et sans clé.
//
// TROIS FOURNISSEURS, ET UN QUATRIÈME QUI N'EN EST PAS UN :
//   ollama     un modèle local, sans clé, sans coût monétaire
//   openai     toute API compatible OpenAI (OpenAI, Groq, Together, vLLM, LM Studio…)
//   anthropic  l'API Messages
//   replay     rejoue des réponses enregistrées — pour tester le harnais sans dépenser un jeton
//
// AUCUNE CLÉ N'EST LUE AILLEURS QUE DANS L'ENVIRONNEMENT. Rien n'est écrit sur disque, rien n'est
// journalisé : les réponses conservées sont tronquées à 400 caractères par le lanceur.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { ModelFn, ModelReply } from "./runner.ts";

export type Provider = "ollama" | "openai" | "anthropic" | "replay";

export interface ModelSpec {
  provider: Provider;
  /** Identifiant du modèle chez le fournisseur : « qwen3:4b », « gpt-4o-mini »… */
  model: string;
  /** Point d'entrée. Une valeur par défaut raisonnable existe pour chaque fournisseur. */
  baseUrl?: string;
  /** Nom de la variable d'environnement portant la clé. Jamais la clé elle-même. */
  apiKeyEnv?: string;
  /** Délai maximal par appel, en millisecondes. */
  timeoutMs?: number;
  /**
   * Prix par million de jetons, pour que le coût par réponse correcte soit calculable.
   * Sans lui, seuls les jetons et la durée sont remontés.
   */
  eurPerMillionInput?: number;
  eurPerMillionOutput?: number;
}

/**
 * Analyse une spécification de modèle en ligne de commande.
 *
 * Formes acceptées : « ollama:qwen3:4b », « openai:gpt-4o-mini », « replay:chemin.json ».
 * Sans préfixe, on suppose Ollama — c'est le seul fournisseur qui ne demande aucune clé, donc le
 * seul qu'on puisse essayer sans rien configurer.
 */
export function parseModelSpec(raw: string): ModelSpec {
  const idx = raw.indexOf(":");
  const head = idx >= 0 ? raw.slice(0, idx) : "";
  const rest = idx >= 0 ? raw.slice(idx + 1) : raw;

  if (head === "ollama") return { provider: "ollama", model: rest };
  if (head === "openai") return { provider: "openai", model: rest, apiKeyEnv: "OPENAI_API_KEY" };
  if (head === "anthropic") {
    return { provider: "anthropic", model: rest, apiKeyEnv: "ANTHROPIC_API_KEY" };
  }
  if (head === "replay") return { provider: "replay", model: rest };
  return { provider: "ollama", model: raw };
}

/** Le coût monétaire d'un appel, s'il est calculable. */
function priceOf(spec: ModelSpec, inputTokens: number, outputTokens: number): number | undefined {
  if (spec.eurPerMillionInput === undefined && spec.eurPerMillionOutput === undefined) {
    return undefined;
  }
  return (
    (inputTokens / 1e6) * (spec.eurPerMillionInput ?? 0)
    + (outputTokens / 1e6) * (spec.eurPerMillionOutput ?? 0)
  );
}

/**
 * Construit la fonction d'interrogation d'un modèle.
 *
 * TOUTE ERREUR DEVIENT UNE `failure`, JAMAIS UNE EXCEPTION. C'est ce qui permet au lanceur de
 * distinguer « le modèle s'est trompé » de « on n'a pas pu lui demander » — et cette distinction
 * décide de ce qui entre ou non dans le dénominateur. Laisser remonter l'exception ferait planter
 * l'exécution entière sur une coupure réseau.
 */
export function makeModelFn(spec: ModelSpec): ModelFn {
  switch (spec.provider) {
    case "ollama":
      return ollama(spec);
    case "openai":
      return openaiCompatible(spec);
    case "anthropic":
      return anthropic(spec);
    case "replay":
      return replay(spec);
  }
}

function keyOf(spec: ModelSpec): string | null {
  if (!spec.apiKeyEnv) return null;
  const v = process.env[spec.apiKeyEnv];
  return v && v.trim() !== "" ? v : null;
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Estimation de jetons quand le fournisseur n'en renvoie pas. Grossière, et déclarée comme telle. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Ollama : local, sans clé ──────────────────────────────────────────────────────────────────

function ollama(spec: ModelSpec): ModelFn {
  const base = spec.baseUrl ?? "http://127.0.0.1:11434";
  const timeout = spec.timeoutMs ?? 300_000;

  return async (prompt: string): Promise<ModelReply> => {
    const started = Date.now();
    try {
      const res = await withTimeout(timeout, (signal) =>
        fetch(`${base}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: spec.model, prompt, stream: false }),
          signal,
        }),
      );
      if (!res.ok) {
        return { text: "", failure: `HTTP ${res.status} : ${(await res.text()).slice(0, 200)}` };
      }
      const json = (await res.json()) as {
        response?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const inputTokens = json.prompt_eval_count ?? estimateTokens(prompt);
      const outputTokens = json.eval_count ?? estimateTokens(json.response ?? "");
      return {
        text: json.response ?? "",
        cost: {
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - started,
          eur: priceOf(spec, inputTokens, outputTokens),
        },
      };
    } catch (err) {
      return { text: "", failure: describe(err, base) };
    }
  };
}

// ── API compatible OpenAI ─────────────────────────────────────────────────────────────────────

function openaiCompatible(spec: ModelSpec): ModelFn {
  const base = spec.baseUrl ?? "https://api.openai.com/v1";
  const timeout = spec.timeoutMs ?? 120_000;

  return async (prompt: string): Promise<ModelReply> => {
    const key = keyOf(spec);
    if (!key) {
      return {
        text: "",
        failure:
          `Clé absente : la variable d'environnement ${spec.apiKeyEnv} n'est pas définie. `
          + "Le pack ne lit aucune clé ailleurs que dans l'environnement.",
      };
    }
    const started = Date.now();
    try {
      const res = await withTimeout(timeout, (signal) =>
        fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: spec.model,
            messages: [{ role: "user", content: prompt }],
          }),
          signal,
        }),
      );
      if (!res.ok) {
        return { text: "", failure: `HTTP ${res.status} : ${(await res.text()).slice(0, 200)}` };
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      const inputTokens = json.usage?.prompt_tokens ?? estimateTokens(prompt);
      const outputTokens = json.usage?.completion_tokens ?? estimateTokens(text);
      return {
        text,
        cost: {
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - started,
          eur: priceOf(spec, inputTokens, outputTokens),
        },
      };
    } catch (err) {
      return { text: "", failure: describe(err, base) };
    }
  };
}

// ── API Anthropic ─────────────────────────────────────────────────────────────────────────────

function anthropic(spec: ModelSpec): ModelFn {
  const base = spec.baseUrl ?? "https://api.anthropic.com/v1";
  const timeout = spec.timeoutMs ?? 120_000;

  return async (prompt: string): Promise<ModelReply> => {
    const key = keyOf(spec);
    if (!key) {
      return {
        text: "",
        failure: `Clé absente : la variable d'environnement ${spec.apiKeyEnv} n'est pas définie.`,
      };
    }
    const started = Date.now();
    try {
      const res = await withTimeout(timeout, (signal) =>
        fetch(`${base}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: spec.model,
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
          }),
          signal,
        }),
      );
      if (!res.ok) {
        return { text: "", failure: `HTTP ${res.status} : ${(await res.text()).slice(0, 200)}` };
      }
      const json = (await res.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (json.content ?? []).map((c) => c.text ?? "").join("");
      const inputTokens = json.usage?.input_tokens ?? estimateTokens(prompt);
      const outputTokens = json.usage?.output_tokens ?? estimateTokens(text);
      return {
        text,
        cost: {
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - started,
          eur: priceOf(spec, inputTokens, outputTokens),
        },
      };
    } catch (err) {
      return { text: "", failure: describe(err, base) };
    }
  };
}

// ── Rejeu : tester le harnais sans dépenser un jeton ───────────────────────────────────────────

/**
 * Rejoue des réponses enregistrées, indexées par prompt.
 *
 * Sert à deux choses : vérifier le harnais sans appeler personne, et rejouer exactement une
 * ancienne exécution pour prouver qu'un écart vient du modèle et non du protocole.
 */
function replay(spec: ModelSpec): ModelFn {
  let table: Record<string, string> | null = null;
  return async (prompt: string): Promise<ModelReply> => {
    if (table === null) {
      try {
        const { readFileSync } = await import("node:fs");
        table = JSON.parse(readFileSync(spec.model, "utf-8")) as Record<string, string>;
      } catch (err) {
        return { text: "", failure: `Fichier de rejeu illisible : ${describe(err, spec.model)}` };
      }
    }
    const hit = table[prompt];
    return hit === undefined
      ? { text: "", failure: "Aucune réponse enregistrée pour cet énoncé." }
      : { text: hit, cost: { latencyMs: 0 } };
  };
}

function describe(err: unknown, target: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort/i.test(msg)) return `Délai dépassé en interrogeant ${target}.`;
  if (/ECONNREFUSED|fetch failed/i.test(msg)) {
    return `Impossible de joindre ${target} — service arrêté ou adresse incorrecte. (${msg})`;
  }
  return msg;
}

/**
 * Les modèles réellement disponibles, par fournisseur.
 *
 * POURQUOI CE N'EST PAS UNE LISTE EN DUR. Une liste écrite à la main vieillit et propose des
 * modèles que la machine n'a pas ; l'utilisateur lance alors une suite qui échoue au premier
 * appel. On demande donc au fournisseur ce qu'il a. Pour les fournisseurs à clé, on ne fait
 * AUCUN appel : on dit seulement si la variable d'environnement attendue est renseignée — jamais
 * sa valeur.
 */
export async function discoverModels(): Promise<Array<{
  provider: Provider;
  models: string[];
  available: boolean;
  detail: string;
}>> {
  const out: Array<{ provider: Provider; models: string[]; available: boolean; detail: string }> = [];

  // Ollama : interrogeable sans clé, donc on peut lister pour de vrai.
  try {
    const base = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
    const r = await withTimeout(4000, (signal) => fetch(`${base}/api/tags`, { signal }));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = (await r.json()) as { models?: Array<{ name?: string }> };
    const models = (body.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string" && n !== "")
      .sort();
    out.push({
      provider: "ollama",
      models,
      available: models.length > 0,
      detail: models.length > 0
        ? `${models.length} modèle(s) installé(s) sur ${base}`
        : `Ollama répond sur ${base} mais aucun modèle n'est installé (« ollama pull … »).`,
    });
  } catch (err) {
    out.push({
      provider: "ollama",
      models: [],
      available: false,
      detail: describe(err, "Ollama"),
    });
  }

  // Fournisseurs à clé : on ne dépense rien pour savoir s'ils sont configurés.
  for (const [provider, envVar] of [
    ["openai", "OPENAI_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"],
  ] as Array<[Provider, string]>) {
    const set = (process.env[envVar] ?? "").trim() !== "";
    out.push({
      provider,
      models: [],
      available: set,
      detail: set
        ? `${envVar} est renseignée. Saisir le nom du modèle à la main, ex. ${provider}:…`
        : `${envVar} n'est pas renseignée — ce fournisseur est hors de portée.`,
    });
  }

  return out;
}

/** Vérifie qu'un modèle répond, avant de lancer une suite entière et de la payer. */
export async function ping(spec: ModelSpec): Promise<{ ok: boolean; detail: string }> {
  const ask = makeModelFn(spec);
  const started = Date.now();
  const reply = await ask("Réponds exactement par le mot : pret");
  const ms = Date.now() - started;
  if (reply.failure) return { ok: false, detail: reply.failure };
  return {
    ok: true,
    detail: `réponse en ${ms} ms — « ${reply.text.slice(0, 60).replace(/\s+/g, " ").trim()} »`,
  };
}
