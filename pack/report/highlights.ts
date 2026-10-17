// Le bêtisier reproductible — 3 à 5 cas d'échec incontestables, copiables tels quels.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA CONTRAINTE QUI REND CE MODULE HONNÊTE.
//
// **Uniquement des échecs déjà présents dans le rapport d'entreprise complet.** Aucun cas choisi
// « pour l'effet » et absent du rapport sérieux. Sinon les deux présentations divergent, et c'est
// exactement ce que la règle de la phase 4 interdit.
//
// Ce module ne cherche donc pas les cas les plus spectaculaires : il cherche les plus
// INCONTESTABLES. Un échec discutable dans une vidéo se retourne contre celui qui l'a publié dès
// que quelqu'un le rejoue.
//
// Trois critères d'incontestabilité, dans cet ordre :
//   1. la vérité terrain est vérifiable par un tiers (une source est citée) ;
//   2. l'échec ne dépend d'aucune appréciation — une preuve attendue est absente, point ;
//   3. le système était CONFIANT en se trompant, ou la référence, elle, avait raison.
//
// Le troisième critère est ce qui distingue un bêtisier utile d'une liste d'erreurs : « il s'est
// trompé » n'intéresse personne, « il s'est trompé en étant sûr de lui, là où un système plus
// simple avait raison » intéresse tout le monde.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { Defect, EvalResult } from "../core/evaluate.ts";
import type { ProtocolRun } from "../protocols/runner.ts";

/** Un cas retenu pour le bêtisier. Tout ce qu'il faut pour le rejouer est là. */
export interface Highlight {
  caseId: string;
  /** Pourquoi ce cas est incontestable. Affiché : c'est ce qui protège celui qui publie. */
  why: string;
  /** L'entrée exacte, telle qu'envoyée. */
  input: string;
  /** Ce que le système a répondu. */
  got: string;
  /** Ce qu'il fallait répondre. */
  expected: string;
  /** Confiance annoncée, si elle existe. C'est souvent le détail qui frappe. */
  confidence: string | null;
  /** Rang d'incontestabilité : plus bas = plus solide. */
  rank: number;
}

export interface HighlightReel {
  runId: string;
  subject: string;
  items: Highlight[];
  /** Pourquoi la sélection s'arrête là. Jamais vide. */
  note: string;
}

const MAX = 5;
const MIN = 3;

function short(v: unknown, max = 240): string {
  let s: string;
  if (typeof v === "string") s = v;
  else {
    try {
      s = JSON.stringify(v) ?? String(v);
    } catch {
      s = String(v);
    }
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Extrait le bêtisier d'un rapport d'entreprise.
 *
 * La source est `r.defects`, c'est-à-dire EXACTEMENT la liste que le rapport d'audit affiche.
 * Aucun cas n'est cherché ailleurs, aucun n'est ajouté. On se contente de trier et de couper.
 */
export function highlightsFromEval(r: EvalResult, runId: string): HighlightReel {
  // On ne retient que les vrais échecs : un « juste mais peu confiant » n'est pas un bêtisier.
  const candidates = r.defects.filter((d) => d.severity !== "mineur");

  const scored = candidates
    .map((d) => ({ d, rank: rankOf(d) }))
    .sort((a, b) => a.rank - b.rank || (b.d.confidence ?? 0) - (a.d.confidence ?? 0));

  const items: Highlight[] = scored.slice(0, MAX).map(({ d, rank }) => ({
    caseId: d.itemId,
    why: whyIncontestable(d),
    input: short(d.input),
    got: short(d.got),
    expected: short(d.expected),
    confidence: d.confidence !== undefined ? `${(d.confidence * 100).toFixed(0)} %` : null,
    rank,
  }));

  return {
    runId,
    subject: r.adapter,
    items,
    note: noteFor(items.length, candidates.length, r.defects.length),
  };
}

/**
 * Le rang d'incontestabilité.
 *
 * 1 — le système s'est trompé là où la RÉFÉRENCE avait raison. Le plus fort : on ne peut pas
 *     objecter « la question était impossible », puisqu'un autre système y a répondu.
 * 2 — erreur CONFIANTE. Le système annonçait ≥ 80 % et s'est trompé.
 * 3 — erreur simple, sans circonstance aggravante.
 */
function rankOf(d: Defect): number {
  if (/régression/i.test(d.kind)) return 1;
  if (/confiante/i.test(d.kind)) return 2;
  return 3;
}

function whyIncontestable(d: Defect): string {
  switch (rankOf(d)) {
    case 1:
      return "La référence — plus simple et moins chère — a répondu juste sur ce cas exact. "
        + "On ne peut donc pas objecter que la question était trop difficile.";
    case 2:
      return `Le système s'est trompé en annonçant ${((d.confidence ?? 0) * 100).toFixed(0)} % de `
        + "confiance. Une erreur confiante est traitée comme un fait par tout ce qui vient après.";
    default:
      return "La réponse attendue est absente de la sortie. Aucune appréciation n'intervient : "
        + "c'est une vérification par présence de chaîne, pas un jugement de qualité.";
  }
}

function noteFor(shown: number, candidates: number, total: number): string {
  if (shown === 0) {
    return "Aucun échec incontestable à montrer. Ce n'est pas un oubli : soit le système n'a pas "
      + "échoué, soit ses échecs sont discutables et n'ont donc rien à faire dans un extrait public.";
  }
  const base =
    `${shown} cas montrés, choisis parmi les ${candidates} échecs du rapport complet `
    + `(${total} défauts au total, mineurs compris). `;
  return shown < MIN
    ? base + "Moins de trois : on ne complète pas avec des cas plus faibles pour faire nombre."
    : base + "Tous sont extraits du rapport d'entreprise, aucun n'a été cherché pour l'effet.";
}

/** Le même bêtisier, depuis une exécution du protocole des modèles. */
export function highlightsFromProtocol(run: ProtocolRun, runId: string): HighlightReel {
  // `panne` est exclu : une erreur d'infrastructure n'est pas un échec du modèle, et la publier
  // comme tel serait malhonnête.
  const failures = run.results.filter((x) => x.verdict === "faux");

  const scored = failures
    .map((f) => {
      // Inventer une réponse sur une question sans réponse : le mode d'échec le plus grave, parce
      // que rien n'a l'air faux.
      const invented = f.dimension === "refus";
      return { f, rank: invented ? 1 : 2 };
    })
    .sort((a, b) => a.rank - b.rank);

  const items: Highlight[] = scored.slice(0, MAX).map(({ f, rank }) => ({
    caseId: f.caseId,
    why:
      rank === 1
        ? "La question n'a pas de réponse connue : se taire était la seule sortie sûre. Le modèle "
          + "a répondu quand même. C'est le mode d'échec le plus coûteux, parce que rien n'a l'air faux."
        : f.why,
    input: short(f.prompt),
    got: short(f.reply),
    expected: rank === 1 ? "un refus explicite (« je ne sais pas »)" : short(f.why),
    confidence: f.confidence !== undefined ? `${(f.confidence * 100).toFixed(0)} %` : null,
    rank,
  }));

  return {
    runId,
    subject: run.model,
    items,
    note: noteFor(items.length, failures.length, run.results.length),
  };
}

// ── Rendu ─────────────────────────────────────────────────────────────────────────────────────

/** Format court, copiable tel quel dans un post ou une vidéo. */
export function renderHighlightsMarkdown(reel: HighlightReel): string {
  const L: string[] = [];
  L.push(`# ${reel.subject} — ce qui casse`);
  L.push("");
  L.push(`*Exécution \`${reel.runId}\`. Chaque cas est rejouable tel quel.*`);
  L.push("");

  if (reel.items.length === 0) {
    L.push(reel.note);
    L.push("");
    return L.join("\n");
  }

  for (const [i, h] of reel.items.entries()) {
    L.push(`## ${i + 1}. ${h.caseId}`);
    L.push("");
    L.push(`**On demande :** ${h.input}`);
    L.push("");
    L.push(`**Il répond :** ${h.got}${h.confidence ? `  *(confiance annoncée : ${h.confidence})*` : ""}`);
    L.push("");
    L.push(`**La bonne réponse :** ${h.expected}`);
    L.push("");
    L.push(`> ${h.why}`);
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push(reel.note);
  L.push("");
  return L.join("\n");
}
