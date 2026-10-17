// Sortie Markdown : ce qu'on colle dans une pull request, un ticket, ou un README.
//
// Même contenu et même ordre que la console. La seule différence est la mise en forme.

import type { DriftReport } from "../core/drift.ts";
import type { EvalResult } from "../core/evaluate.ts";
import { planStatement } from "../core/power.ts";
import { brief, ci, num, pc, pts, verdictBadge } from "./shared.ts";
import { renderAmeliorationsMarkdown } from "./ameliorations.ts";

export function renderMarkdown(r: EvalResult, options: { defects?: boolean } = {}): string {
  const L: string[] = [];

  L.push(`# Évaluation — ${r.adapter}`);
  L.push("");
  L.push(`**${verdictBadge(r)}**`);
  L.push("");
  L.push(`> ${r.headline}`);
  L.push("");

  if (r.refusal) {
    L.push("## Refus de verdict");
    L.push("");
    L.push(r.refusal.reason);
    L.push("");
    L.push("Références acceptées — il y en a toujours une :");
    L.push("");
    for (const a of r.refusal.accepted) L.push(`- ${a}`);
    L.push("");
  }

  // ── Comparaison ──────────────────────────────────────────────────────────────────────────
  L.push("## Comparaison à la référence");
  L.push("");
  if (r.contrastive) {
    const c = r.contrastive;
    L.push(`**Verdict : ${c.verdict}** — ${c.statement}`);
    L.push("");
    L.push("| | valeur |");
    L.push("|---|---|");
    L.push(`| cas appariés | ${c.n} |`);
    L.push(`| cas sans réponse de la référence | ${c.unmatched} |`);
    if (c.binary) {
      L.push(`| taux de réussite — système | ${ci(c.binary.systemRate, 4, true)} |`);
      L.push(`| taux de réussite — référence | ${ci(c.binary.baselineRate, 4, true)} |`);
      L.push(`| écart apparié | ${ci(c.binary.rateDifference, 4, true)} |`);
      L.push(`| McNemar | p = ${c.binary.mcnemar.pValue.toFixed(4)} (${c.binary.mcnemar.method}), ${c.binary.mcnemar.systemOnly} vs ${c.binary.mcnemar.baselineOnly} cas discordants |`);
    }
    if (c.probabilistic) {
      const p = c.probabilistic;
      L.push(`| Brier — système | ${ci(p.systemBrier)} |`);
      L.push(`| Brier — référence | ${ci(p.baselineBrier)} |`);
      L.push(`| écart de Brier apparié | ${ci(p.brierDifference, 5)} |`);
      L.push(`| log-loss système / référence | ${num(p.systemLogLoss)} / ${num(p.baselineLogLoss)} |`);
      L.push(`| skill vs référence | ${pc(p.skillScore)} |`);
    }
    L.push("");
    if (c.anchoring) {
      L.push("### Ancrage");
      L.push("");
      L.push("*Mesuré sans consulter une seule vérité terrain — donc disponible dès le premier jour.*");
      L.push("");
      L.push(`- écart médian système / référence : **${pc(c.anchoring.medianAbsoluteDistance)}**`);
      L.push(`- corrélation : **${num(c.anchoring.correlation)}**`);
      L.push(`- part des cas à moins de 2 points : **${pc(c.anchoring.shareWithin2pts)}**`);
      L.push("");
      L.push(`> ${c.anchoring.statement}`);
      L.push("");
    }
  } else {
    L.push("**Aucune.** C'est la mesure manquante la plus grave : sans elle, tous les chiffres");
    L.push("ci-dessous sont des scores absolus, et un score absolu ne dit rien.");
    L.push("");
  }

  L.push("### Planchers gratuits");
  L.push("");
  L.push("*Les battre est nécessaire, jamais suffisant.*");
  L.push("");
  L.push("| plancher | valeur | battu ? |");
  L.push("|---|---|---|");
  L.push(`| taux de base | ${pc(r.trivial.positiveRate)} | — |`);
  if (r.trivial.majorityLabelAccuracy !== null) {
    L.push(`| étiquette majoritaire | ${pc(r.trivial.majorityLabelAccuracy)} | ${yn(r.trivial.beatsMajorityLabel)} |`);
    L.push(`| réponse au hasard | ${pc(r.trivial.randomLabelAccuracy ?? 0)} | — |`);
  } else {
    L.push("| étiquette majoritaire | *sans objet : pas d'étiquettes* | — |");
  }
  if (r.trivial.climatologyBrier !== null) {
    L.push(`| Brier du taux de base | ${num(r.trivial.climatologyBrier)} | ${yn(r.trivial.beatsClimatology)} |`);
  }
  L.push(`| Brier d'une réponse au hasard | ${num(r.trivial.randomBrier)} | — |`);
  L.push("");

  // ── Métriques ────────────────────────────────────────────────────────────────────────────
  L.push("## Métriques");
  L.push("");
  L.push(`Cas évalués : **${r.n}**${r.errors ? ` (+${r.errors} en erreur, exclus)` : ""} · mode(s) : ${r.modes.join(", ") || "—"}`);
  L.push("");
  L.push("| métrique | valeur [intervalle 95 %] |");
  L.push("|---|---|");
  if (r.binary) {
    L.push(`| taux de réussite | ${ci(r.binary.successRate, 4, true)} |`);
  } else {
    L.push("| taux de réussite | *sans objet en mode « événement »* |");
  }
  if (r.probabilistic) {
    const p = r.probabilistic;
    L.push(`| Brier | ${ci(p.brier)} |`);
    L.push(`| log-loss | ${num(p.logLoss)} |`);
    L.push(`| ECE | ${pc(p.ece)} |`);
    L.push(`| MCE | ${pc(p.mce)} |`);
    L.push(`| biais global | ${pts(p.overall.bias)} |`);
    L.push(`| fiabilité (plus bas = mieux) | ${num(p.decomposition.reliability)} |`);
    L.push(`| résolution (plus haut = mieux) | ${num(p.decomposition.resolution)} |`);
    L.push(`| incertitude | ${num(p.decomposition.uncertainty)} |`);
    L.push(`| skill vs taux de base | ${pc(p.decomposition.skill)} |`);
    L.push("");
    L.push("### Courbe de calibration");
    L.push("");
    L.push("| tranche | n | annoncé | réalisé | biais | conclusif |");
    L.push("|---|---|---|---|---|---|");
    for (const s of p.curve) {
      L.push(`| ${s.label} | ${s.n} | ${pc(s.predicted)} | ${pc(s.actual)} | ${pts(s.bias)} | ${s.conclusive ? "oui" : "**NON**"} |`);
    }
    L.push("");
  } else {
    L.push("");
    L.push("*Aucune confiance chiffrée : calibration, ECE et décomposition indisponibles.*");
    L.push("");
  }

  // ── Rang ─────────────────────────────────────────────────────────────────────────────────
  if (r.ranking) {
    const sys = r.ranking.system;
    const base = r.ranking.baseline;
    L.push("## Métriques de rang");
    L.push("");
    L.push(`| métrique | système | ${base ? "référence |" : ""}`);
    L.push(`|---|---|${base ? "---|" : ""}`);
    const row = (label: string, a: number, b: number | undefined) =>
      L.push(`| ${label} | ${a.toFixed(3)} |${b === undefined ? "" : ` ${b.toFixed(3)} |`}`);
    row(`hit@${sys.k}`, sys.hitAtK, base?.hitAtK);
    row(`rappel@${sys.k}`, sys.recallAtK, base?.recallAtK);
    row("MRR", sys.mrr, base?.mrr);
    row(`NDCG@${sys.k}`, sys.ndcgAtK, base?.ndcgAtK);
    L.push("");
    L.push(`> ${r.ranking.diagnosis}`);
    L.push("");
  }

  // ── Puissance ────────────────────────────────────────────────────────────────────────────
  if (r.power) {
    L.push("## Ce qu'il faudrait pour trancher");
    L.push("");
    L.push(`Puissance atteinte par l'échantillon courant : **${pc(r.power.achieved)}**.`);
    L.push("");
    L.push(planStatement(r.power.plan));
    L.push("");
  }

  // ── Ventilation ──────────────────────────────────────────────────────────────────────────
  L.push("## Ventilation par catégorie");
  L.push("");
  if (!r.binary || r.binary.byCategory.length === 0) {
    L.push("*Aucune ventilation disponible (mode « événement », ou `category?` non implémentée).*");
  } else {
    L.push("*Du pire au meilleur — c'est là qu'on voit où le système échoue.*");
    L.push("");
    L.push("| catégorie | n | réussite | intervalle 95 % | conclusif |");
    L.push("|---|---|---|---|---|");
    for (const c of r.binary.byCategory) {
      L.push(`| ${c.category || "(sans catégorie)"} | ${c.n} | ${pc(c.rate.value)} | ${pc(c.rate.low)} – ${pc(c.rate.high)} | ${c.conclusive ? "oui" : "**NON**"} |`);
    }
  }
  L.push("");

  // ── Écartés ──────────────────────────────────────────────────────────────────────────────
  L.push("## Écartés pour échantillon insuffisant");
  L.push("");
  if (r.underpowered.length === 0) {
    L.push("*Aucun : toutes les tranches et catégories atteignent le seuil.*");
  } else {
    L.push("| portée | libellé | n | seuil |");
    L.push("|---|---|---|---|");
    for (const u of r.underpowered) L.push(`| ${u.scope} | ${u.label} | ${u.n} | ${u.required} |`);
    L.push("");
    L.push("**Ces lignes sont affichées mais ne portent aucune conclusion.**");
  }
  L.push("");

  // ── Défauts (optionnel) ──────────────────────────────────────────────────────────────────
  if (options.defects && r.defects.length > 0) {
    L.push("## Défauts");
    L.push("");
    L.push("| gravité | type | cas | entrée | obtenu | attendu |");
    L.push("|---|---|---|---|---|---|");
    for (const d of r.defects.slice(0, 30)) {
      L.push(
        `| ${d.severity} | ${d.kind} | ${d.itemId} | ${md(brief(d.input, 80))} | `
        + `${md(brief(d.got, 80))} | ${md(brief(d.expected, 80))} |`,
      );
    }
    L.push("");
  }

  // ── Réserves ─────────────────────────────────────────────────────────────────────────────
  L.push("## Réserves — ce que cette mesure ne dit pas");
  L.push("");
  for (const res of r.reservations) L.push(`- ${res}`);
  L.push("");

  // ── Reproductibilité ─────────────────────────────────────────────────────────────────────
  const rp = r.reproducibility;
  L.push("## Reproductibilité");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push(`| commande | \`${rp.command}\` |`);
  L.push(`| exécuté le | ${rp.runAt} |`);
  L.push(`| version du pack | ${rp.packVersion} |`);
  L.push(`| Node | ${rp.nodeVersion} |`);
  L.push(`| empreinte des données | \`${rp.dataFingerprint}\` |`);
  L.push(`| graine | ${rp.seed} |`);
  L.push(`| rééchantillonnages bootstrap | ${rp.bootstrapSamples} |`);
  L.push(`| seuils | minObs = ${rp.minObs}, minPaired = ${rp.minPaired}, k = ${rp.k} |`);
  L.push("");

  // Produits pour TOUTE analyse : un rapport qui ne dit pas quoi faire laisse son lecteur seul.
  L.push("");
  L.push(renderAmeliorationsMarkdown(r));

  return L.join("\n");
}

export function renderDriftMarkdown(d: DriftReport): string {
  const L: string[] = [];
  L.push(`# Dérive — ${d.before.adapter} → ${d.after.adapter}`);
  L.push("");
  L.push(`**${d.verdict}**`);
  L.push("");
  L.push(`> ${d.statement}`);
  L.push("");
  L.push("| | avant | après |");
  L.push("|---|---|---|");
  L.push(`| exécuté le | ${d.before.runAt} | ${d.after.runAt} |`);
  L.push(`| cas | ${d.before.n} | ${d.after.n} |`);
  L.push(`| réussite | ${pc(d.before.rate)} | ${pc(d.after.rate)} |`);
  L.push(`| empreinte des données | \`${d.before.fingerprint}\` | \`${d.after.fingerprint}\` |`);
  L.push("");
  L.push(`Mêmes données : **${d.sameData ? "oui" : "non"}** · cas appariés : ${d.paired} · écart ${pts(d.difference)} ± ${pts(d.margin)}`);
  L.push("");
  if (d.regressions.length > 0) {
    L.push(`### Régressions (${d.regressions.length})`);
    L.push("");
    L.push(d.regressions.map((x) => `\`${x}\``).join(", "));
    L.push("");
  }
  if (d.fixes.length > 0) {
    L.push(`### Réparations (${d.fixes.length})`);
    L.push("");
    L.push(d.fixes.map((x) => `\`${x}\``).join(", "));
    L.push("");
  }
  return L.join("\n");
}

function yn(v: boolean | null): string {
  return v === null ? "non applicable" : v ? "oui" : "**non**";
}

/** Échappe les caractères qui casseraient une cellule de tableau Markdown. */
function md(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
