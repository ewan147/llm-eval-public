// Sortie console : dense, alignée, lisible dans un terminal de 96 colonnes.

import type { EvalResult } from "../core/evaluate.ts";
import type { DriftReport } from "../core/drift.ts";
import { F, MODE_LABEL, P, S, t } from "../core/i18n.ts";
import { planStatement } from "../core/power.ts";
import { brief, ci, num, pc, pts, verdictBadge } from "./shared.ts";
import { renderAmeliorationsConsole } from "./ameliorations.ts";

const W = 96;
const rule = (c = "─") => c.repeat(W);

export function renderConsole(r: EvalResult): string {
  const L: string[] = [];

  // ── 1. Verdict ───────────────────────────────────────────────────────────────────────────
  L.push(rule("═"));
  L.push(`${t(S.evaluation)} — ${r.adapter}`);
  L.push(rule("═"));
  L.push("");
  L.push(`[${verdictBadge(r)}]`);
  L.push("");
  L.push(...wrap(r.headline, W));
  L.push("");

  if (r.refusal) {
    L.push(rule());
    L.push(t(S.refusalTitle));
    L.push(rule());
    L.push(...wrap(r.refusal.reason, W));
    L.push("");
    L.push(t(S.acceptedBaselines));
    for (const a of r.refusal.accepted) L.push(`  · ${a}`);
    L.push("");
  }

  // ── 2. Comparaison à la référence ────────────────────────────────────────────────────────
  L.push(rule());
  L.push(t(S.comparison));
  L.push(rule());
  if (r.contrastive) {
    const c = r.contrastive;
    L.push(`verdict                  ${c.verdict}`);
    L.push(`cas appariés / écartés   ${c.n} / ${c.unmatched}`);
    if (c.binary) {
      L.push(`taux système             ${ci(c.binary.systemRate, 4, true)}`);
      L.push(`taux référence           ${ci(c.binary.baselineRate, 4, true)}`);
      L.push(`écart apparié            ${ci(c.binary.rateDifference, 4, true)}`);
      const m = c.binary.mcnemar;
      L.push(
        `McNemar                  système seul ${m.systemOnly}, référence seule ${m.baselineOnly}, `
        + `p = ${m.pValue.toFixed(4)} (${m.method})`,
      );
    }
    if (c.probabilistic) {
      const p = c.probabilistic;
      L.push(`Brier système            ${ci(p.systemBrier)}`);
      L.push(`Brier référence          ${ci(p.baselineBrier)}`);
      L.push(`écart de Brier apparié   ${ci(p.brierDifference, 5)}   (négatif = système meilleur)`);
      L.push(`log-loss système / réf.  ${num(p.systemLogLoss)} / ${num(p.baselineLogLoss)}`);
      L.push(`skill vs référence       ${pc(p.skillScore)}`);
    }
    if (c.anchoring) {
      L.push("");
      L.push("ancrage (mesuré sans consulter les vérités terrain)");
      L.push(`  écart médian           ${pc(c.anchoring.medianAbsoluteDistance)}`);
      L.push(`  corrélation            ${num(c.anchoring.correlation)}`);
      L.push(`  part à moins de 2 pts  ${pc(c.anchoring.shareWithin2pts)}`);
      L.push(...wrap(`  → ${c.anchoring.statement}`, W));
    }
    L.push("");
    L.push(...wrap(`→ ${c.statement}`, W));
  } else {
    L.push(...wrap(t(S.noBaseline), W));
  }
  L.push("");

  L.push(t(S.trivialFloors));
  L.push(`  taux de base             ${pc(r.trivial.positiveRate)}`);
  if (r.trivial.majorityLabelAccuracy !== null) {
    L.push(`  étiquette majoritaire    ${pc(r.trivial.majorityLabelAccuracy)}   battue : ${yn(r.trivial.beatsMajorityLabel)}`);
    L.push(`  réponse au hasard        ${pc(r.trivial.randomLabelAccuracy ?? 0)}`);
  } else {
    L.push(`  ${t(F.majorityLabel).padEnd(24)} ${t(P.noLabels)}`);
  }
  if (r.trivial.climatologyBrier !== null) {
    const note =
      r.trivial.beatsClimatology === null
        ? t(P.degenerateFloor)
        : `battu : ${yn(r.trivial.beatsClimatology)}`;
    L.push(`  Brier du taux de base    ${num(r.trivial.climatologyBrier)}   ${note}`);
  }
  L.push(`  Brier d'une réponse au hasard  ${num(r.trivial.randomBrier)}`);
  L.push("");

  // ── 3. Métriques ─────────────────────────────────────────────────────────────────────────
  L.push(rule());
  L.push(t(S.metrics));
  L.push(rule());
  L.push(`cas évalués              ${r.n}${r.errors ? `   (+${r.errors} en erreur, exclus)` : ""}`);
  L.push(`${t(F.mode).padEnd(24)} ${r.modes.map((m) => t(MODE_LABEL[m] ?? { fr: m, en: m })).join(", ") || "—"}`);
  if (r.binary) {
    L.push(`taux de réussite         ${ci(r.binary.successRate, 4, true)}`);
  } else {
    L.push(...wrap(`${t(F.successRate).padEnd(24)} ${t(P.successRateNotApplicable)}`, W, "                         "));
  }

  if (r.probabilistic) {
    const p = r.probabilistic;
    L.push(`Brier                    ${ci(p.brier)}`);
    L.push(`log-loss                 ${num(p.logLoss)}`);
    L.push(`ECE / MCE                ${pc(p.ece)} / ${pc(p.mce)}`);
    L.push(`confiance annoncée       ${pc(p.overall.predicted)}   réalisé ${pc(p.overall.actual)}   biais ${pts(p.overall.bias)}`);
    L.push(`éventail de confiance    ${p.spread.distinct} valeurs distinctes, de ${pc(p.spread.min)} à ${pc(p.spread.max)}`);
    L.push("");
    L.push("décomposition (Brier = fiabilité − résolution + incertitude)");
    L.push(`  fiabilité              ${num(p.decomposition.reliability)}   (plus bas = mieux)`);
    L.push(`  résolution             ${num(p.decomposition.resolution)}   (plus haut = mieux)`);
    L.push(`  incertitude            ${num(p.decomposition.uncertainty)}   (le bruit du problème)`);
    L.push(`  skill vs taux de base  ${pc(p.decomposition.skill)}`);
    L.push("");
    L.push("courbe de calibration");
    L.push("  tranche         n      annoncé   réalisé     biais   conclusif");
    for (const s of p.curve) {
      L.push(
        `  ${s.label.padEnd(13)} ${String(s.n).padStart(5)}   ${pc(s.predicted).padStart(7)}`
        + `   ${pc(s.actual).padStart(7)}   ${pts(s.bias).padStart(8)}   ${s.conclusive ? "oui" : "NON"}`,
      );
    }
  } else {
    L.push("");
    L.push(...wrap(t(P.noConfidence), W));
  }
  L.push("");

  // ── 3b. Métriques de rang ────────────────────────────────────────────────────────────────
  if (r.ranking) {
    L.push(rule());
    L.push(t(S.ranking));
    L.push(rule());
    const sys = r.ranking.system;
    const base = r.ranking.baseline;
    L.push(`                         ${t(F.system).padStart(9)}   ${base ? t(F.baseline).padStart(9) : ""}`);
    const line = (label: string, a: number, b: number | undefined) =>
      L.push(
        `  ${label.padEnd(23)}${a.toFixed(3).padStart(9)}   `
        + (b === undefined ? "" : b.toFixed(3).padStart(9)),
      );
    line(`hit@${sys.k}`, sys.hitAtK, base?.hitAtK);
    line(`${t(F.recallAtK)}`, sys.recallAtK, base?.recallAtK);
    line(t(F.mrr), sys.mrr, base?.mrr);
    line(`NDCG@${sys.k}`, sys.ndcgAtK, base?.ndcgAtK);
    L.push("");
    L.push(...wrap(`→ ${r.ranking.diagnosis}`, W));
    L.push("");
  }

  // ── 3c. Puissance : que faire quand on n'a pas pu trancher ───────────────────────────────
  if (r.power) {
    L.push(rule());
    L.push(t(S.power));
    L.push(rule());
    L.push(`${t(F.achievedPower).padEnd(24)} ${pc(r.power.achieved)}`);
    L.push("");
    L.push(...wrap(planStatement(r.power.plan), W));
    L.push("");
  }

  // ── 4. Ventilation ───────────────────────────────────────────────────────────────────────
  L.push(rule());
  L.push(t(S.byCategory));
  L.push(rule());
  if (!r.binary || r.binary.byCategory.length === 0) {
    L.push(...wrap(t(P.noRankingBreakdown), W));
  } else {
    L.push("  catégorie                      n     réussite        intervalle       conclusif");
    for (const c of r.binary.byCategory) {
      L.push(
        `  ${(c.category || "(sans catégorie)").padEnd(28)} ${String(c.n).padStart(4)}`
        + `   ${pc(c.rate.value).padStart(7)}   ${(`${pc(c.rate.low)} – ${pc(c.rate.high)}`).padStart(18)}`
        + `   ${c.conclusive ? "oui" : "NON"}`,
      );
    }
  }
  L.push("");

  // ── 5. Écartés ───────────────────────────────────────────────────────────────────────────
  L.push(rule());
  L.push(t(S.underpowered));
  L.push(rule());
  if (r.underpowered.length === 0) {
    L.push(t(P.nothingUnderpowered));
  } else {
    for (const u of r.underpowered) {
      L.push(`  ${u.scope.padEnd(22)} ${u.label.padEnd(18)} n = ${String(u.n).padStart(4)}  (seuil ${u.required})`);
    }
    L.push("");
    L.push(...wrap(t(P.underpoweredWarning), W));
  }
  L.push("");

  // ── 6. Réserves ──────────────────────────────────────────────────────────────────────────
  L.push(rule());
  L.push(t(S.reservations));
  L.push(rule());
  for (const [i, res] of r.reservations.entries()) {
    L.push(...wrap(`${i + 1}. ${res}`, W, "   "));
  }
  L.push("");

  // ── 7. Points d'amélioration ─────────────────────────────────────────────────────────────
  //
  // Un rapport qui s'arrête au verdict a rempli la moitié de son contrat : « MOINS BON que sa
  // référence » est vrai, utile, et ne dit pas par où commencer. Cette section conclut, et elle
  // est produite pour TOUTE analyse — pas sur demande.
  L.push(renderAmeliorationsConsole(r));
  L.push("");

  // ── 8. Reproductibilité ──────────────────────────────────────────────────────────────────
  const rp = r.reproducibility;
  L.push(rule());
  L.push(t(S.reproducibility));
  L.push(rule());
  L.push(`commande                 ${rp.command}`);
  L.push(`exécuté le               ${rp.runAt}`);
  L.push(`version du pack / Node   ${rp.packVersion} / ${rp.nodeVersion}`);
  L.push(`empreinte des données    ${rp.dataFingerprint}`);
  L.push(`graine / bootstrap       ${rp.seed} / ${rp.bootstrapSamples} rééchantillonnages`);
  L.push(`seuils                   minObs = ${rp.minObs}, minPaired = ${rp.minPaired}, k = ${rp.k}`);
  L.push(rule("═"));

  return L.join("\n");
}

/** Les défauts, pour la console. Séparé : `run` ne les montre pas, `audit` oui. */
export function renderDefectsConsole(r: EvalResult, limit = 15): string {
  const L: string[] = [rule(), `DÉFAUTS — ${r.defects.length} trouvé(s), les ${Math.min(limit, r.defects.length)} plus graves`, rule()];
  if (r.defects.length === 0) {
    L.push("Aucun défaut : tous les cas sont corrects et confiants.");
    return L.join("\n");
  }
  for (const d of r.defects.slice(0, limit)) {
    L.push("");
    L.push(`[${d.severity.toUpperCase()}] ${d.kind} — ${d.itemId}${d.category ? ` (${d.category})` : ""}`);
    L.push(`  entrée   ${brief(d.input)}`);
    L.push(`  obtenu   ${brief(d.got)}${d.confidence !== undefined ? `   (confiance ${pc(d.confidence)})` : ""}`);
    L.push(`  attendu  ${brief(d.expected)}`);
    L.push(...wrap(`  pourquoi ${d.why}`, W, "           "));
  }
  return L.join("\n");
}

export function renderDriftConsole(d: DriftReport): string {
  const L: string[] = [];
  L.push(rule("═"));
  L.push(`DÉRIVE — ${d.before.adapter} → ${d.after.adapter}`);
  L.push(rule("═"));
  L.push("");
  L.push(`[${d.verdict}]`);
  L.push("");
  L.push(...wrap(d.statement, W));
  L.push("");
  L.push(`avant     ${d.before.runAt}   n = ${d.before.n}   réussite ${pc(d.before.rate)}   empreinte ${d.before.fingerprint}`);
  L.push(`après     ${d.after.runAt}   n = ${d.after.n}   réussite ${pc(d.after.rate)}   empreinte ${d.after.fingerprint}`);
  L.push(`mêmes données : ${d.sameData ? "OUI" : "NON"}`);
  L.push("");
  L.push(`cas appariés            ${d.paired}`);
  L.push(`écart apparié           ${pts(d.difference)} ± ${pts(d.margin)}`);
  L.push(`régressions             ${d.regressions.length}${d.regressions.length ? ` : ${d.regressions.slice(0, 12).join(", ")}${d.regressions.length > 12 ? "…" : ""}` : ""}`);
  L.push(`réparations             ${d.fixes.length}${d.fixes.length ? ` : ${d.fixes.slice(0, 12).join(", ")}${d.fixes.length > 12 ? "…" : ""}` : ""}`);
  L.push(rule("═"));
  return L.join("\n");
}

function yn(v: boolean | null): string {
  return v === null ? "non applicable" : v ? "oui" : "NON";
}

function wrap(text: string, width: number, indent = ""): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      lines.push(line);
      line = indent + w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}
