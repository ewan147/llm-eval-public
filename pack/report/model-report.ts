// Le rapport publiable — Markdown et HTML, par sortie de modèle et par migration.
//
// C'est l'artefact principal du protocole. Il est ÉCRIT, pas filmé : le dépôt et le rapport
// chiffré sont ce que partagent les gens qui achètent.
//
// Même contrainte que le rapport d'audit : zéro dépendance, zéro CDN, un seul fichier qui s'ouvre
// hors ligne et s'imprime.

import type { MigrationReport } from "../protocols/migration.ts";
import type { ProtocolRun } from "../protocols/runner.ts";
import { summarize } from "../protocols/runner.ts";
import type { Series } from "../protocols/series.ts";
import { accuracyTrend } from "../protocols/series.ts";

const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
const pts = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} pt`;

// ── Markdown ──────────────────────────────────────────────────────────────────────────────────

/** Le rapport d'une exécution unique : ce qu'on publie à la sortie d'un modèle. */
export function renderRunMarkdown(run: ProtocolRun): string {
  const s = summarize(run);
  const L: string[] = [];

  L.push(`# ${run.model} — suite « ${run.suite.id} » v${run.suite.version}`);
  L.push("");
  L.push(
    `Exécuté le ${run.runAt.slice(0, 10)} · ${s.n} cas · empreinte de suite \`${run.suite.fingerprint}\``,
  );
  L.push("");

  if (!run.complete) {
    L.push(`> **Exécution incomplète.** ${run.stoppedBecause}`);
    L.push("");
  }

  L.push("## Résultat");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  // « non mesure » et non « 0 % » : une execution entierement en panne ne dit rien du modele.
  L.push(s.accuracy === null
    ? `| Exactitude | **non mesuree** — aucun cas n'a pu etre juge (${s.panne} panne(s)) |`
    : `| Exactitude | **${pc(s.accuracy)}** sur ${s.measured} cas mesurables |`);
  L.push(`| Justes | ${s.juste} |`);
  L.push(`| Faux | ${s.faux} |`);
  L.push(`| Refus | ${s.refus} |`);
  L.push(`| Pannes (hors dénominateur) | ${s.panne} |`);
  if (s.selfAgreement !== null) {
    L.push(`| Accord avec soi-même sous reformulation | ${pc(s.selfAgreement)} |`);
  }
  if (s.totalEur !== null) L.push(`| Coût total | ${s.totalEur.toFixed(4)} |`);
  if (s.totalMs !== null) L.push(`| Durée totale | ${(s.totalMs / 1000).toFixed(1)} s |`);
  L.push("");

  L.push("## Par dimension");
  L.push("");
  L.push("| Dimension | n | Justes | Exactitude |");
  L.push("|---|---|---|---|");
  for (const d of s.byDimension) {
    L.push(`| ${d.dimension} | ${d.n} | ${d.juste} | ${d.accuracy === null ? "—" : pc(d.accuracy)} |`);
  }
  L.push("");

  const failures = run.results.filter((r) => r.verdict === "faux");
  if (failures.length > 0) {
    L.push(`## Cas d'échec (${failures.length}) — reproductibles`);
    L.push("");
    for (const f of failures.slice(0, 15)) {
      L.push(`**${f.caseId}** · ${f.dimension} · ${f.category}`);
      L.push("");
      L.push(`- Question : ${f.prompt}`);
      L.push(`- Réponse : \`${f.reply.replace(/`/g, "'").slice(0, 200)}\``);
      L.push(`- Pourquoi c'est un échec : ${f.why}`);
      L.push("");
    }
  }

  L.push("## Ce qui n'a pas été testé");
  L.push("");
  L.push("*Un banc qui tait ce qu'il ne mesure pas laisse croire qu'il a tout mesuré.*");
  L.push("");
  for (const e of run.exclusions) L.push(`- **${e.capability}** — ${e.reason}`);
  L.push("");

  if (run.suiteFindings.length > 0) {
    L.push("## Réserves sur la suite elle-même");
    L.push("");
    for (const f of run.suiteFindings) L.push(`- *(${f.severity})* ${f.caseId} — ${f.problem}`);
    L.push("");
  }

  L.push("## Reproductibilité");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push(`| Suite | ${run.suite.id} v${run.suite.version} |`);
  L.push(`| Empreinte des cas | \`${run.suite.fingerprint}\` |`);
  L.push(`| Cas | ${run.suite.caseCount} |`);
  L.push(`| Appels consommés | ${run.callsUsed} / ${run.budget.maxCalls} |`);
  L.push(`| Exécuté le | ${run.runAt} |`);
  L.push("");
  L.push(
    "Toute modification d'un cas change l'empreinte et rend cette exécution incomparable aux "
    + "suivantes. C'est voulu : c'est ce qui garantit que la série mesure le modèle et non le banc.",
  );
  L.push("");

  return L.join("\n");
}

/** Le rapport de migration : ce qu'un acheteur lit avant de changer de modèle. */
export function renderMigrationMarkdown(m: MigrationReport): string {
  const L: string[] = [];

  L.push(`# Migration ${m.from} → ${m.to}`);
  L.push("");
  L.push(`**${m.verdict}**`);
  L.push("");
  L.push(`> ${m.statement}`);
  L.push("");

  L.push(`*Comparabilité :* ${m.comparability.reason}`);
  L.push("");

  if (m.comparability.verdict === "REFUSÉ") {
    L.push("Aucune mesure comparative n'est publiée : elle serait fausse.");
    L.push("");
    return L.join("\n");
  }

  L.push("## Qualité");
  L.push("");
  L.push("| | valeur |");
  L.push("|---|---|");
  L.push(`| Cas appariés mesurables | ${m.paired} |`);
  if (m.accuracyBefore) {
    L.push(
      `| Exactitude ${m.from} | ${pc(m.accuracyBefore.value)} [${pc(m.accuracyBefore.low)} – ${pc(m.accuracyBefore.high)}] |`,
    );
  }
  if (m.accuracyAfter) {
    L.push(
      `| Exactitude ${m.to} | ${pc(m.accuracyAfter.value)} [${pc(m.accuracyAfter.low)} – ${pc(m.accuracyAfter.high)}] |`,
    );
  }
  L.push(`| Écart apparié | ${pts(m.accuracyDelta)} |`);
  L.push(`| McNemar | p = ${m.pValue !== null ? m.pValue.toFixed(4) : "—"} · ${m.significant ? "significatif" : "non significatif"} |`);
  L.push("");

  if (m.power) {
    L.push(`*Puissance :* ${m.power.assumption}`);
    L.push("");
  }

  L.push("## Coût");
  L.push("");
  L.push(`**${m.cost.verdict}** — ${m.cost.statement}`);
  L.push("");
  if (m.cost.ratio !== null) {
    L.push("| | avant | après |");
    L.push("|---|---|---|");
    L.push(
      `| Coût par réponse correcte | ${fmtCost(m.cost.before.eurPerCorrect ?? m.cost.before.msPerCorrect)} `
      + `| ${fmtCost(m.cost.after.eurPerCorrect ?? m.cost.after.msPerCorrect)} |`,
    );
    L.push(`| Rapport | — | ${m.cost.ratio.toFixed(2)} × |`);
    L.push("");
  }

  if (m.regressions.length > 0) {
    L.push(`## Régressions (${m.regressions.length}) — ce qui marchait et ne marche plus`);
    L.push("");
    L.push("*C'est la partie que personne d'autre ne publie, et la seule qui décide vraiment.*");
    L.push("");
    for (const r of m.regressions) {
      L.push(`**${r.caseId}** · ${r.dimension} · ${r.category}`);
      L.push("");
      L.push(`- Question : ${r.prompt}`);
      L.push(`- ${m.from} → \`${r.before.reply.slice(0, 160)}\` (${r.before.verdict})`);
      L.push(`- ${m.to} → \`${r.after.reply.slice(0, 160)}\` (${r.after.verdict})`);
      L.push("");
    }
  }

  if (m.fixes.length > 0) {
    L.push(`## Réparations (${m.fixes.length})`);
    L.push("");
    for (const r of m.fixes) {
      L.push(`- **${r.caseId}** (${r.dimension}) : ${r.before.verdict} → ${r.after.verdict}`);
    }
    L.push("");
  }

  L.push(`Cas inchangés : ${m.unchanged}`);
  L.push("");

  L.push("## Réserves");
  L.push("");
  for (const r of m.reservations) L.push(`- ${r}`);
  L.push("");

  return L.join("\n");
}

/** La série longitudinale, en Markdown. */
export function renderSeriesMarkdown(series: Series): string {
  const L: string[] = [];
  L.push("# Série longitudinale");
  L.push("");
  L.push(`> ${series.statement}`);
  L.push("");

  for (const seg of series.segments) {
    L.push(
      `## ${seg.suiteId} v${seg.suiteVersion} — \`${seg.fingerprint}\` (${seg.caseCount} cas)`,
    );
    L.push("");
    L.push(seg.comparable
      ? "*Plusieurs modèles mesurés sur ces mêmes cas : comparaison possible.*"
      : "*Un seul modèle sur ces cas : rien à comparer dans ce segment.*");
    L.push("");
    L.push("| Date | Modèle | Exactitude | Justes / mesurables | Pannes | Complet |");
    L.push("|---|---|---|---|---|---|");
    for (const p of seg.points) {
      L.push(
        `| ${p.runAt.slice(0, 10)} | ${p.model} | ${p.summary.accuracy === null ? "—" : pc(p.summary.accuracy)} | `
        + `${p.summary.juste} / ${p.summary.measured} | ${p.summary.panne} | ${p.complete ? "oui" : "**non**"} |`,
      );
    }
    L.push("");

    const trend = accuracyTrend(seg);
    if (!trend.readable && seg.points.length >= 2) {
      L.push(
        `*Tendance non lisible : ${seg.points.length} points. Relier deux points donne toujours une `
        + "droite parfaite — c'est une comparaison, pas une trajectoire.*",
      );
      L.push("");
    } else if (trend.readable) {
      L.push(`*Tendance sur ${trend.points.length} points : ${pts(trend.delta)} d'exactitude.*`);
      L.push("");
    }
  }

  return L.join("\n");
}

function fmtCost(v: number | null): string {
  if (v === null) return "—";
  if (!Number.isFinite(v)) return "∞";
  return v.toFixed(2);
}

// ── HTML autonome ─────────────────────────────────────────────────────────────────────────────

/** Le rapport de migration en HTML, présentable tel quel. Aucun CDN, aucun script. */
export function renderMigrationHtml(m: MigrationReport): string {
  const cls =
    m.verdict === "MIGRER" ? "good" : m.verdict === "NE PAS MIGRER" ? "bad" : "neutral";

  const regressions = m.regressions.length === 0
    ? '<p class="empty">Aucune régression : aucun cas qui passait n\'échoue désormais.</p>'
    : m.regressions.map((r) => `<article class="case">
  <header><strong>${esc(r.caseId)}</strong> <span class="tag">${esc(r.dimension)}</span>
  <span class="tag">${esc(r.category)}</span></header>
  <dl>
    <dt>Question</dt><dd>${esc(r.prompt)}</dd>
    <dt>${esc(m.from)}</dt><dd><pre class="ok">${esc(r.before.reply.slice(0, 300))}</pre></dd>
    <dt>${esc(m.to)}</dt><dd><pre class="ko">${esc(r.after.reply.slice(0, 300))}</pre></dd>
  </dl>
</article>`).join("");

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Migration ${esc(m.from)} → ${esc(m.to)}</title>
<style>${CSS}</style></head><body><main>

<p class="kicker">Rapport de migration</p>
<h1>${esc(m.from)} → ${esc(m.to)}</h1>

<div class="verdict ${cls}">
  <p class="badge">${esc(m.verdict)}</p>
  <p class="headline">${esc(m.statement)}</p>
</div>

<section>
  <h2>Comparabilité</h2>
  <p class="${m.comparability.verdict === "REFUSÉ" ? "warn" : "hint"}">${esc(m.comparability.reason)}</p>
</section>

${m.comparability.verdict === "REFUSÉ" ? "" : `
<section>
  <h2>Qualité</h2>
  <table>
    <tr><th>Cas appariés mesurables</th><td>${m.paired}</td></tr>
    ${m.accuracyBefore ? `<tr><th>Exactitude ${esc(m.from)}</th><td>${pc(m.accuracyBefore.value)} [${pc(m.accuracyBefore.low)} – ${pc(m.accuracyBefore.high)}]</td></tr>` : ""}
    ${m.accuracyAfter ? `<tr><th>Exactitude ${esc(m.to)}</th><td>${pc(m.accuracyAfter.value)} [${pc(m.accuracyAfter.low)} – ${pc(m.accuracyAfter.high)}]</td></tr>` : ""}
    <tr><th>Écart apparié</th><td>${pts(m.accuracyDelta)}</td></tr>
    <tr><th>McNemar</th><td>p = ${m.pValue !== null ? m.pValue.toFixed(4) : "—"} · ${m.significant ? "significatif" : "non significatif"}</td></tr>
  </table>
</section>

<section>
  <h2>Coût</h2>
  <p class="statement"><strong>${esc(m.cost.verdict)}</strong> — ${esc(m.cost.statement)}</p>
</section>

<section>
  <h2>Régressions (${m.regressions.length})</h2>
  <p class="hint">Ce qui marchait avec ${esc(m.from)} et ne marche plus avec ${esc(m.to)}.
  C'est la partie que personne d'autre ne publie, et la seule qui décide vraiment.</p>
  ${regressions}
</section>
`}

<section class="reservations">
  <h2>Réserves</h2>
  <p class="hint">Cette section fait partie du résultat.</p>
  <ol>${m.reservations.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>
</section>

<footer><p>Produit par eval-pack — suite figée, comparaison appariée, refus de comparer
deux suites différentes.</p></footer>
</main></body></html>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
:root{--ink:#1a1a1a;--muted:#6b6b6b;--line:#d9d9d9;--soft:#f7f7f5;--good:#1f6f4a;--bad:#a3281f;--warn:#8a5a00;--accent:#2b4a7d}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}
main{max-width:820px;margin:0 auto;padding:40px 28px 80px}
h1{font-size:2rem;margin:.1em 0 .6em}
h2{font-size:1.25rem;margin:2.2em 0 .5em;padding-bottom:.25em;border-bottom:1px solid var(--line)}
.kicker{text-transform:uppercase;letter-spacing:.14em;font-size:.75rem;color:var(--muted);margin:0}
.verdict{border:1px solid var(--line);border-left-width:5px;padding:1em 1.2em;margin:1.2em 0;background:var(--soft)}
.verdict.good{border-left-color:var(--good)}.verdict.bad{border-left-color:var(--bad)}
.verdict.neutral{border-left-color:var(--muted)}
.badge{margin:0 0 .4em;text-transform:uppercase;letter-spacing:.1em;font-size:.72rem;font-weight:700;color:var(--muted)}
.headline{margin:0;font-size:1.1rem}
table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:.95rem}
th,td{text-align:left;padding:.42em .7em;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--muted);width:36%}
.hint{color:var(--muted);font-size:.9rem}
.warn{color:var(--warn);font-weight:600}
.statement{border-left:3px solid var(--accent);padding-left:.9em}
.empty{color:var(--muted);background:var(--soft);padding:.8em 1em;border-left:3px solid var(--line)}
.case{border:1px solid var(--line);border-left:4px solid var(--bad);padding:.9em 1.1em;margin:1em 0;break-inside:avoid}
.case header{display:flex;gap:.6em;align-items:baseline;margin-bottom:.6em;flex-wrap:wrap}
.tag{font-size:.75rem;color:var(--muted);font-family:system-ui,sans-serif}
.case dl{display:grid;grid-template-columns:110px 1fr;gap:.35em .9em;margin:0}
.case dt{color:var(--muted);font-size:.85rem;font-weight:600}
.case dd{margin:0;min-width:0}
pre{margin:0;padding:.45em .6em;background:var(--soft);border:1px solid var(--line);white-space:pre-wrap;
  word-break:break-word;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:.85em}
pre.ok{border-left:3px solid var(--good)}pre.ko{border-left:3px solid var(--bad)}
.reservations ol li{margin:.5em 0}
footer{margin-top:3em;padding-top:1em;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
@media print{main{max-width:none;padding:0 12mm}.case,table{page-break-inside:avoid}h2{page-break-after:avoid}}
@media (max-width:640px){.case dl{grid-template-columns:1fr}th{width:auto}}
`;
