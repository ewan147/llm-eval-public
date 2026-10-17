// Rapport HTML autonome — le livrable commercial.
//
// Contraintes tenues : un seul fichier, aucune dépendance, aucun CDN, aucun script. Il s'ouvre
// hors ligne, il s'imprime, et il se lit sans connaissance technique. Le graphique de calibration
// est du SVG écrit à la main : une bibliothèque de graphes ici serait une dépendance réseau, donc
// un fichier qui casse chez le client.

import type { DriftReport } from "../core/drift.ts";
import type { Defect, EvalResult } from "../core/evaluate.ts";
import { planStatement } from "../core/power.ts";
import { brief, ci, full, num, pc, pts, verdictBadge } from "./shared.ts";
import { ameliorations } from "./ameliorations.ts";

export interface HtmlOptions {
  /** Mode audit : page de garde, défauts détaillés, suites à donner. */
  audit?: boolean;
  /** Nom du client ou du destinataire, affiché en page de garde. */
  client?: string;
  /** Périmètre de la mission, en une ou deux phrases. */
  scope?: string;
  /** Nombre maximal de défauts détaillés. */
  maxDefects?: number;
}

export function renderHtml(r: EvalResult, o: HtmlOptions = {}): string {
  const maxDefects = o.maxDefects ?? 25;
  const title = o.audit ? `Audit d'évaluation — ${r.adapter}` : `Évaluation — ${r.adapter}`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${o.audit ? cover(r, o) : ""}
<main>
${o.audit ? "" : `<h1>${esc(title)}</h1>`}

${verdictBlock(r)}
${r.refusal ? refusalBlock(r) : ""}
${contrastiveBlock(r)}
${trivialBlock(r)}
${metricsBlock(r)}
${rankingBlock(r)}
${powerBlock(r)}
${categoriesBlock(r)}
${underpoweredBlock(r)}
${o.audit ? defectsBlock(r, maxDefects) : ""}
${reservationsBlock(r)}
${ameliorationsBlock(r)}
${o.audit ? nextStepsBlock(r) : ""}
${reproBlock(r)}

<footer>
  <p>Produit par <strong>eval-pack ${esc(r.reproducibility.packVersion)}</strong> — zéro dépendance,
  intervalles par bootstrap, refus de verdict sans référence.</p>
</footer>
</main>
</body>
</html>`;
}

// ── Page de garde ─────────────────────────────────────────────────────────────────────────────

function cover(r: EvalResult, o: HtmlOptions): string {
  const d = new Date(r.reproducibility.runAt);
  const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return `<section class="cover">
  <p class="kicker">Rapport d'audit</p>
  <h1>Évaluation de ${esc(r.adapter)}</h1>
  ${o.client ? `<p class="client">Établi pour ${esc(o.client)}</p>` : ""}
  <p class="date">${esc(date)}</p>

  <dl class="cover-facts">
    <dt>Système évalué</dt><dd>${esc(r.adapter)}</dd>
    <dt>Périmètre</dt><dd>${esc(o.scope ?? `${r.n} cas évalués, fournis par l'adaptateur.`)}</dd>
    <dt>Méthode</dt><dd>Comparaison appariée à une référence, intervalles de confiance par bootstrap
      (${r.reproducibility.bootstrapSamples} rééchantillonnages), refus de conclure sous
      ${r.reproducibility.minObs} observations par tranche.</dd>
    <dt>Verdict</dt><dd><strong>${esc(verdictBadge(r))}</strong></dd>
    <dt>Empreinte des données</dt><dd class="mono">${esc(r.reproducibility.dataFingerprint)}</dd>
  </dl>

  <p class="cover-note">Ce rapport indique explicitement ce qu'il ne mesure pas. La section
  <em>Réserves</em> fait partie du résultat, pas de l'habillage.</p>
</section>`;
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────────

function verdictBlock(r: EvalResult): string {
  const cls = r.refusal
    ? "refused"
    : r.contrastive?.verdict === "BAT"
      ? "good"
      : r.contrastive?.verdict === "MOINS BON"
        ? "bad"
        : "neutral";
  return `<section>
  <h2>1. Verdict</h2>
  <div class="verdict ${cls}">
    <p class="badge">${esc(verdictBadge(r))}</p>
    <p class="headline">${esc(r.headline)}</p>
  </div>
</section>`;
}

function refusalBlock(r: EvalResult): string {
  const f = r.refusal!;
  return `<section class="callout">
  <h3>Pourquoi aucun verdict n'est rendu</h3>
  <p>${esc(f.reason)}</p>
  <p><strong>Références acceptées — il y en a toujours une :</strong></p>
  <ul>${f.accepted.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
</section>`;
}

function contrastiveBlock(r: EvalResult): string {
  if (!r.contrastive) {
    return `<section>
  <h2>2. Comparaison à la référence</h2>
  <p class="empty"><strong>Aucune.</strong> C'est la mesure manquante la plus grave : sans elle,
  tous les chiffres qui suivent sont des scores absolus, et un score absolu ne dit rien.
  Un score de 0,16 est excellent sur une question à 50/50 et médiocre sur une question à 95/5.</p>
</section>`;
  }
  const c = r.contrastive;
  const rows: string[] = [
    row("Cas appariés", String(c.n)),
    row("Cas sans réponse de la référence", String(c.unmatched)),
  ];
  if (c.binary) {
    rows.push(
      row("Taux de réussite — système", ci(c.binary.systemRate, 4, true)),
      row("Taux de réussite — référence", ci(c.binary.baselineRate, 4, true)),
      row("Écart apparié", ci(c.binary.rateDifference, 4, true)),
      row(
        "Test de McNemar",
        `p = ${c.binary.mcnemar.pValue.toFixed(4)} · ${c.binary.mcnemar.systemOnly} cas gagnés, `
        + `${c.binary.mcnemar.baselineOnly} perdus`,
      ),
    );
  }
  if (c.probabilistic) {
    const p = c.probabilistic;
    rows.push(
      row("Brier — système", ci(p.systemBrier)),
      row("Brier — référence", ci(p.baselineBrier)),
      row("Écart de Brier apparié", `${ci(p.brierDifference, 5)} <span class="hint">(négatif = système meilleur)</span>`),
      row("Log-loss système / référence", `${num(p.systemLogLoss)} / ${num(p.baselineLogLoss)}`),
      row("Skill vs référence", pc(p.skillScore)),
    );
  }

  const anchor = c.anchoring
    ? `<div class="callout">
    <h3>Ancrage — le système reproduit-il sa référence ?</h3>
    <p class="hint">Mesuré <strong>sans consulter une seule vérité terrain</strong> : disponible dès
    le premier jour d'un projet, avant le moindre résultat.</p>
    <table>
      ${row("Écart médian système / référence", pc(c.anchoring.medianAbsoluteDistance))}
      ${row("Corrélation", num(c.anchoring.correlation))}
      ${row("Part des cas à moins de 2 points", pc(c.anchoring.shareWithin2pts))}
    </table>
    <p class="${c.anchoring.anchored ? "warn" : ""}">${esc(c.anchoring.statement)}</p>
  </div>`
    : "";

  return `<section>
  <h2>2. Comparaison à la référence</h2>
  <p class="statement">${esc(c.statement)}</p>
  <table>${rows.join("")}</table>
  ${anchor}
</section>`;
}

function trivialBlock(r: EvalResult): string {
  const t = r.trivial;
  return `<section>
  <h3>Planchers gratuits</h3>
  <p class="hint">Les battre est <strong>nécessaire</strong>. Ça n'a jamais été suffisant : le
  système à l'origine de ce pack battait le taux de base de 29,2 % et ne valait rien.</p>
  <table>
    ${row("Taux de base", pc(t.positiveRate))}
    ${t.majorityLabelAccuracy !== null
      ? row("Étiquette majoritaire", `${pc(t.majorityLabelAccuracy)} — battue : ${yn(t.beatsMajorityLabel)}`)
        + row("Réponse au hasard", pc(t.randomLabelAccuracy ?? 0))
      : row("Étiquette majoritaire", `<span class="hint">sans objet : les vérités terrain ne portent pas d'étiquette.</span>`)}
    ${t.climatologyBrier !== null ? row("Brier du taux de base", `${num(t.climatologyBrier!)} — battu : ${yn(t.beatsClimatology)}`) : ""}
    ${row("Brier d'une réponse au hasard", num(t.randomBrier))}
  </table>
</section>`;
}

function metricsBlock(r: EvalResult): string {
  const rows = [
    row("Cas évalués", `${r.n}${r.errors ? ` <span class="warn">(+${r.errors} en erreur, exclus)</span>` : ""}`),
    row("Mode de résolution", esc(r.modes.join(", ") || "—")),
    r.binary
      ? row("Taux de réussite", ci(r.binary.successRate, 4, true))
      : row(
          "Taux de réussite",
          `<span class="hint">sans objet en mode « événement » : l'issue ne dépend pas du système,
           toute sa qualité est dans la probabilité annoncée.</span>`,
        ),
  ];
  if (r.probabilistic) {
    const p = r.probabilistic;
    rows.push(
      row("Brier", ci(p.brier)),
      row("Log-loss", num(p.logLoss)),
      row("ECE / MCE", `${pc(p.ece)} / ${pc(p.mce)}`),
      row("Biais global", pts(p.overall.bias)),
      row("Fiabilité", `${num(p.decomposition.reliability)} <span class="hint">(plus bas = mieux)</span>`),
      row("Résolution", `${num(p.decomposition.resolution)} <span class="hint">(plus haut = mieux)</span>`),
      row("Incertitude", `${num(p.decomposition.uncertainty)} <span class="hint">(le bruit du problème)</span>`),
      row("Skill vs taux de base", pc(p.decomposition.skill)),
    );
  }

  const curve = r.probabilistic
    ? `<h3>Courbe de calibration</h3>
    ${calibrationSvg(r)}
    <table class="grid">
      <thead><tr><th>Tranche</th><th>n</th><th>Annoncé</th><th>Réalisé</th><th>Biais</th><th>Conclusif</th></tr></thead>
      <tbody>${r.probabilistic.curve
        .map(
          (s) => `<tr class="${s.conclusive ? "" : "muted"}"><td>${esc(s.label)}</td><td>${s.n}</td>
        <td>${pc(s.predicted)}</td><td>${pc(s.actual)}</td><td>${pts(s.bias)}</td>
        <td>${s.conclusive ? "oui" : '<span class="warn">non</span>'}</td></tr>`,
        )
        .join("")}</tbody>
    </table>`
    : `<p class="empty">Le système ne produit aucune confiance chiffrée : calibration, ECE et
    décomposition sont indisponibles. On sait s'il a raison, pas s'il sait quand il a tort.</p>`;

  return `<section>
  <h2>3. Métriques</h2>
  <p class="hint">Chaque valeur est donnée avec son intervalle de confiance à 95 %. Un chiffre sans
  intervalle est un chiffre qui ment.</p>
  <table>${rows.join("")}</table>
  ${curve}
</section>`;
}

/** Le diagramme de fiabilité, en SVG écrit à la main. Aucune bibliothèque, aucun réseau. */
function calibrationSvg(r: EvalResult): string {
  const curve = r.probabilistic?.curve ?? [];
  if (curve.length === 0) return "";
  const W = 420;
  const H = 300;
  const pad = 44;
  const x = (v: number) => pad + v * (W - pad - 12);
  const y = (v: number) => H - pad - v * (H - pad - 12);

  const diagonal = `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="diag"/>`;
  const pointsAll = curve.map((s) => `${x(s.predicted)},${y(s.actual)}`).join(" ");
  const line = `<polyline points="${pointsAll}" class="curve"/>`;
  const dots = curve
    .map(
      (s) =>
        `<circle cx="${x(s.predicted)}" cy="${y(s.actual)}" r="${s.conclusive ? 5 : 3}" `
        + `class="${s.conclusive ? "dot" : "dot weak"}"><title>${esc(s.label)} — n=${s.n}, annoncé ${pc(s.predicted)}, réalisé ${pc(s.actual)}</title></circle>`,
    )
    .join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (t) =>
        `<text x="${x(t)}" y="${H - pad + 16}" class="tick" text-anchor="middle">${(t * 100).toFixed(0)}%</text>`
        + `<text x="${pad - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${(t * 100).toFixed(0)}%</text>`,
    )
    .join("");

  return `<figure class="chart">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagramme de fiabilité">
  <rect x="${pad}" y="12" width="${W - pad - 12}" height="${H - pad - 12}" class="plot"/>
  ${diagonal}${line}${dots}${ticks}
  <text x="${(W + pad) / 2}" y="${H - 6}" class="axis" text-anchor="middle">confiance annoncée</text>
  <text x="12" y="${H / 2}" class="axis" text-anchor="middle" transform="rotate(-90 12 ${H / 2})">réussite observée</text>
</svg>
<figcaption>La diagonale est la calibration parfaite. Au-dessus : le système est trop prudent.
En dessous : trop confiant. Les points pâles sont sous le seuil d'observations et ne portent
aucune conclusion.</figcaption>
</figure>`;
}

function rankingBlock(r: EvalResult): string {
  if (!r.ranking) return "";
  const sys = r.ranking.system;
  const base = r.ranking.baseline;
  const row = (label: string, a: number, b: number | undefined) =>
    `<tr><td>${esc(label)}</td><td>${a.toFixed(3)}</td>${b === undefined ? "" : `<td>${b.toFixed(3)}</td>`}</tr>`;
  return `<section>
  <h3>Métriques de rang</h3>
  <p class="hint">hit@k est binaire et jette la moitié de l'information : il ne distingue pas un
  document pertinent placé en première position d'un document placé en cinquième. MRR et NDCG le
  font.</p>
  <table class="grid">
    <thead><tr><th>Métrique</th><th>Système</th>${base ? "<th>Référence</th>" : ""}</tr></thead>
    <tbody>
      ${row(`hit@${sys.k}`, sys.hitAtK, base?.hitAtK)}
      ${row(`rappel@${sys.k}`, sys.recallAtK, base?.recallAtK)}
      ${row("MRR", sys.mrr, base?.mrr)}
      ${row(`NDCG@${sys.k}`, sys.ndcgAtK, base?.ndcgAtK)}
    </tbody>
  </table>
  <p class="statement">${esc(r.ranking.diagnosis)}</p>
</section>`;
}

function powerBlock(r: EvalResult): string {
  if (!r.power) return "";
  return `<section class="callout">
  <h3>Ce qu'il faudrait pour trancher</h3>
  <p class="hint">Le seuil disait qu'il n'y avait pas assez de cas. Ceci dit combien il en faut,
  à partir de la variance réellement observée.</p>
  <table>
    ${row("Puissance atteinte", pc(r.power.achieved))}
    ${row("Cas disponibles", String(r.power.plan.available))}
    ${row("Cas requis", Number.isFinite(r.power.plan.required) ? String(r.power.plan.required) : "—")}
    ${row("À ajouter", Number.isFinite(r.power.plan.missing) ? String(r.power.plan.missing) : "—")}
  </table>
  <p>${esc(planStatement(r.power.plan))}</p>
</section>`;
}

function categoriesBlock(r: EvalResult): string {
  if (!r.binary || r.binary.byCategory.length === 0) {
    return `<section><h2>4. Ventilation par catégorie</h2>
    <p class="empty">Aucune catégorie fournie par l'adaptateur (méthode <code>category?</code> non
    implémentée). C'est la ligne la plus rentable à ajouter : elle transforme « le système réussit
    78 % » en « le système échoue sur telle famille de cas ».</p></section>`;
  }
  const maxN = Math.max(...r.binary!.byCategory.map((c) => c.n));
  return `<section>
  <h2>4. Ventilation par catégorie</h2>
  <p class="hint">Triée du pire au meilleur. C'est ici qu'on voit <em>où</em> le système échoue,
  et non pas seulement <em>combien</em>.</p>
  <table class="grid">
    <thead><tr><th>Catégorie</th><th>n</th><th>Réussite</th><th>Intervalle 95 %</th><th></th><th>Conclusif</th></tr></thead>
    <tbody>${r.binary!.byCategory
      .map(
        (c) => `<tr class="${c.conclusive ? "" : "muted"}">
      <td>${esc(c.category || "(sans catégorie)")}</td>
      <td>${c.n}</td>
      <td>${pc(c.rate.value)}</td>
      <td class="mono">${pc(c.rate.low)} – ${pc(c.rate.high)}</td>
      <td class="barcell">${bar(c.rate.value, c.rate.low, c.rate.high, c.n / maxN)}</td>
      <td>${c.conclusive ? "oui" : '<span class="warn">non</span>'}</td>
    </tr>`,
      )
      .join("")}</tbody>
  </table>
</section>`;
}

/** Barre horizontale avec l'intervalle dessiné : la largeur de l'intervalle se voit d'un coup d'œil. */
function bar(value: number, low: number, high: number, weight: number): string {
  const w = 120;
  const h = Math.max(6, Math.round(4 + weight * 6));
  return `<svg viewBox="0 0 ${w} 14" width="${w}" height="14" class="bar" role="img">
    <line x1="${low * w}" y1="7" x2="${high * w}" y2="7" class="bar-ci"/>
    <rect x="0" y="${7 - h / 2}" width="${Math.max(1, value * w)}" height="${h}" class="bar-fill"/>
  </svg>`;
}

function underpoweredBlock(r: EvalResult): string {
  if (r.underpowered.length === 0) {
    return `<section><h2>5. Écartés pour échantillon insuffisant</h2>
    <p class="empty">Aucun : toutes les tranches et catégories atteignent le seuil de
    ${r.reproducibility.minObs} observations.</p></section>`;
  }
  return `<section>
  <h2>5. Écartés pour échantillon insuffisant</h2>
  <p class="hint">Ces lignes sont affichées mais ne portent <strong>aucune conclusion</strong>.
  Le projet à l'origine de ce pack a produit des ajustements à partir de tranches à n = 5, 4 et 6 ;
  c'est la première erreur consignée dans son journal.</p>
  <table class="grid">
    <thead><tr><th>Portée</th><th>Libellé</th><th>n</th><th>Seuil requis</th></tr></thead>
    <tbody>${r.underpowered
      .map((u) => `<tr><td>${esc(u.scope)}</td><td>${esc(u.label)}</td><td class="warn">${u.n}</td><td>${u.required}</td></tr>`)
      .join("")}</tbody>
  </table>
</section>`;
}

function defectsBlock(r: EvalResult, max: number): string {
  if (r.defects.length === 0) {
    return `<section><h2>6. Défauts trouvés</h2>
    <p class="empty">Aucun défaut : tous les cas sont corrects, et aucun ne l'est avec une confiance
    anormalement basse.</p></section>`;
  }
  const counts = { critique: 0, majeur: 0, mineur: 0 };
  for (const d of r.defects) counts[d.severity]++;

  return `<section class="defects">
  <h2>6. Défauts trouvés</h2>
  <p class="hint">Classés par gravité. Chacun est reproductible tel quel : entrée exacte, sortie
  obtenue, sortie attendue. Une erreur <em>confiante</em> est classée plus grave qu'une erreur
  hésitante, parce qu'un système en aval la traitera comme un fait.</p>
  <p class="counts">
    <span class="chip critique">${counts.critique} critique${counts.critique > 1 ? "s" : ""}</span>
    <span class="chip majeur">${counts.majeur} majeur${counts.majeur > 1 ? "s" : ""}</span>
    <span class="chip mineur">${counts.mineur} mineur${counts.mineur > 1 ? "s" : ""}</span>
    ${r.defects.length > max ? `<span class="hint">— les ${max} plus graves sont détaillés ci-dessous.</span>` : ""}
  </p>
  ${r.defects.slice(0, max).map(defectCard).join("")}
</section>`;
}

function defectCard(d: Defect): string {
  return `<article class="defect ${d.severity}">
  <header>
    <span class="chip ${d.severity}">${esc(d.severity)}</span>
    <strong>${esc(d.kind)}</strong>
    <span class="mono id">${esc(d.itemId)}</span>
    ${d.category ? `<span class="cat">${esc(d.category)}</span>` : ""}
    ${d.confidence !== undefined ? `<span class="conf">confiance ${pc(d.confidence)}</span>` : ""}
  </header>
  <dl>
    <dt>Entrée</dt><dd><pre>${esc(full(d.input))}</pre></dd>
    <dt>Obtenu</dt><dd><pre class="got">${esc(full(d.got))}</pre></dd>
    <dt>Attendu</dt><dd><pre class="expected">${esc(full(d.expected))}</pre></dd>
  </dl>
  <p class="why">${esc(d.why)}</p>
</article>`;
}

/**
 * Les points d'amélioration, rendus pour TOUTE analyse.
 *
 * Placés juste après les réserves, et avant la reproductibilité : le lecteur vient d'apprendre ce
 * que la mesure ne dit pas, il doit enchaîner sur ce qu'il peut en faire. Chaque point porte la
 * mesure qui le déclenche — un conseil sans chiffre derrière n'a pas sa place dans un rapport de
 * mesure, aussi raisonnable soit-il.
 */
function ameliorationsBlock(r: EvalResult): string {
  const liste = ameliorations(r);
  if (liste.length === 0) {
    return `<section class="ameliorations">
  <h2>Points d'amélioration</h2>
  <p class="rien">Aucun point : rien dans cette mesure ne déclenche de recommandation. Ce n'est
  pas un satisfecit, c'est l'absence de signal.</p>
</section>`;
  }
  const items = liste.map((a) => `<li class="prio-${a.priorite}">
    <div class="titre"><span class="badge">${esc(a.priorite.toUpperCase())}</span> ${esc(a.titre)}</div>
    <div class="constat">${esc(a.constat)}</div>
    <div class="pourquoi">${esc(a.pourquoi)}</div>
    <div class="preuve">mesure : <code>${esc(a.preuve)}</code></div>
  </li>`).join("");
  return `<section class="ameliorations">
  <h2>Points d'amélioration &mdash; que faire de ce résultat</h2>
  <ol>${items}</ol>
</section>`;
}

function reservationsBlock(r: EvalResult): string {
  return `<section class="reservations">
  <h2>${r.defects.length >= 0 ? "7" : "6"}. Réserves — ce que cette mesure ne dit pas</h2>
  <p class="hint">Cette section fait partie du résultat. Un rapport d'évaluation qui ne dit pas ses
  limites est un rapport qui ment.</p>
  <ol>${r.reservations.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
</section>`;
}

function nextStepsBlock(r: EvalResult): string {
  const steps: string[] = [];

  if (r.refusal) {
    steps.push(
      "Fournir une référence contrastive et relancer. C'est la seule action qui transforme ce "
      + "rapport descriptif en verdict. Le moins cher : réévaluer avec le prompt ou le modèle "
      + "précédent en `baseline`.",
    );
  }
  if (r.contrastive?.anchoring?.anchored) {
    steps.push(
      "Rompre l'ancrage : identifier ce que le système reçoit de sa référence en entrée, et mesurer "
      + "ce qu'il vaut sans. Tant que la corrélation reste au-dessus de 0,98, aucun réglage ne le "
      + "fera dépasser sa référence.",
    );
  }
  if (r.underpowered.length > 0) {
    steps.push(
      `Compléter l'échantillon sur ${r.underpowered.length} tranche(s) ou catégorie(s) sous le seuil `
      + `de ${r.reproducibility.minObs}. Ce sont les seules zones sur lesquelles rien n'est affirmé.`,
    );
  }
  if (!r.probabilistic) {
    steps.push(
      "Faire produire au système une confiance chiffrée. Sans elle, on ne peut pas décider quand "
      + "lui faire confiance : toute la calibration est hors de portée.",
    );
  } else if (r.probabilistic.spread.distinct <= 3) {
    steps.push(
      "Élargir l'éventail des confiances produites : le système n'en utilise que "
      + `${r.probabilistic.spread.distinct}, ce qui rend sa résolution nulle ou quasi nulle par construction.`,
    );
  }
  if (!r.binary || r.binary.byCategory.length === 0) {
    steps.push(
      "Renseigner `category?` dans l'adaptateur (une ligne). Elle transforme un taux global en "
      + "diagnostic : quelles familles de cas échouent.",
    );
  }
  const worst = r.binary?.byCategory.find((c) => c.conclusive);
  if (worst) {
    steps.push(
      `Traiter en priorité la catégorie « ${worst.category || "(sans catégorie)"} », la plus faible `
      + `des catégories concluantes (${pc(worst.rate.value)} de réussite sur ${worst.n} cas).`,
    );
  }
  steps.push(
    "Rejouer cette évaluation après chaque changement, et comparer avec `eval-pack compare` : "
    + "l'empreinte des données garantit qu'on mesure le système et non un changement de jeu de test.",
  );

  return `<section>
  <h2>8. Ce qu'il faudrait mesurer ensuite</h2>
  <ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
</section>`;
}

function reproBlock(r: EvalResult): string {
  const p = r.reproducibility;
  return `<section>
  <h2>9. Reproductibilité</h2>
  <p class="hint">Deux exécutions qui affichent la même empreinte ont vu exactement les mêmes
  entrées, prédictions et vérités. C'est ce qui permet de dire si un écart vient du système ou du
  jeu de test.</p>
  <table>
    ${row("Commande", `<code>${esc(p.command)}</code>`)}
    ${row("Exécuté le", esc(p.runAt))}
    ${row("Version du pack", esc(p.packVersion))}
    ${row("Node", esc(p.nodeVersion))}
    ${row("Empreinte des données", `<span class="mono">${esc(p.dataFingerprint)}</span>`)}
    ${row("Graine pseudo-aléatoire", String(p.seed))}
    ${row("Rééchantillonnages bootstrap", String(p.bootstrapSamples))}
    ${row("Seuils", `minObs = ${p.minObs} · minPaired = ${p.minPaired} · k = ${p.k}`)}
  </table>
</section>`;
}

export function renderDriftHtml(d: DriftReport): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dérive — ${esc(d.before.adapter)}</title><style>${CSS}</style></head>
<body><main>
<h1>Dérive — ${esc(d.before.adapter)} → ${esc(d.after.adapter)}</h1>
<div class="verdict ${d.verdict === "DÉGRADATION" ? "bad" : d.verdict === "AMÉLIORATION" ? "good" : "neutral"}">
  <p class="badge">${esc(d.verdict)}</p>
  <p class="headline">${esc(d.statement)}</p>
</div>
<table class="grid">
<thead><tr><th></th><th>Avant</th><th>Après</th></tr></thead>
<tbody>
<tr><td>Exécuté le</td><td>${esc(d.before.runAt)}</td><td>${esc(d.after.runAt)}</td></tr>
<tr><td>Cas</td><td>${d.before.n}</td><td>${d.after.n}</td></tr>
<tr><td>Réussite</td><td>${pc(d.before.rate)}</td><td>${pc(d.after.rate)}</td></tr>
<tr><td>Empreinte des données</td><td class="mono">${esc(d.before.fingerprint)}</td><td class="mono">${esc(d.after.fingerprint)}</td></tr>
</tbody></table>
<table>
${row("Mêmes données", d.sameData ? "oui" : '<span class="warn">non</span>')}
${row("Cas appariés", String(d.paired))}
${row("Écart apparié", `${pts(d.difference)} ± ${pts(d.margin)}`)}
${row("Régressions", d.regressions.length ? `${d.regressions.length} — <span class="mono">${esc(d.regressions.slice(0, 30).join(", "))}</span>` : "0")}
${row("Réparations", d.fixes.length ? `${d.fixes.length} — <span class="mono">${esc(d.fixes.slice(0, 30).join(", "))}</span>` : "0")}
</table>
</main></body></html>`;
}

// ── Utilitaires ───────────────────────────────────────────────────────────────────────────────

function row(k: string, v: string): string {
  return `<tr><th>${k}</th><td>${v}</td></tr>`;
}

function yn(v: boolean | null): string {
  return v === null ? "non applicable" : v ? "oui" : '<span class="warn">non</span>';
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Feuille de style : sobre, imprimable, sans dépendance ─────────────────────────────────────

const CSS = `
:root{
  --ink:#1a1a1a; --muted:#6b6b6b; --line:#d9d9d9; --bg:#fff; --soft:#f7f7f5;
  --good:#1f6f4a; --bad:#a3281f; --warn:#8a5a00; --accent:#2b4a7d;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;}
main{max-width:820px;margin:0 auto;padding:40px 28px 80px}
h1{font-size:1.9rem;line-height:1.2;margin:0 0 .6em;font-weight:600}
h2{font-size:1.25rem;margin:2.4em 0 .5em;padding-bottom:.25em;border-bottom:1px solid var(--line);font-weight:600}
h3{font-size:1.05rem;margin:1.8em 0 .4em;font-weight:600}
p{margin:.6em 0}
section{margin-bottom:1.2em}
code,.mono,pre{font-family:"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;font-size:.86em}

.cover{min-height:78vh;display:flex;flex-direction:column;justify-content:center;
  max-width:820px;margin:0 auto;padding:60px 28px;border-bottom:2px solid var(--ink)}
.cover h1{font-size:2.5rem;margin:.1em 0 .3em}
.kicker{text-transform:uppercase;letter-spacing:.14em;font-size:.75rem;color:var(--muted);margin:0}
.client{font-size:1.15rem;margin:0}
.date{color:var(--muted);margin:.2em 0 2.4em}
.cover-facts{display:grid;grid-template-columns:200px 1fr;gap:.5em 1.5em;margin:0 0 2.4em;
  border-top:1px solid var(--line);padding-top:1.4em}
.cover-facts dt{font-weight:600;color:var(--muted);font-size:.9rem}
.cover-facts dd{margin:0}
.cover-note{color:var(--muted);font-size:.9rem;font-style:italic;max-width:52ch}

.verdict{border:1px solid var(--line);border-left-width:5px;padding:1em 1.2em;margin:1em 0;background:var(--soft)}
.verdict.good{border-left-color:var(--good)}
.verdict.bad{border-left-color:var(--bad)}
.verdict.refused{border-left-color:var(--warn)}
.verdict.neutral{border-left-color:var(--muted)}
.badge{margin:0 0 .4em;text-transform:uppercase;letter-spacing:.1em;font-size:.72rem;font-weight:700;color:var(--muted)}
.headline{margin:0;font-size:1.12rem;line-height:1.45}

.callout{border:1px solid var(--line);background:var(--soft);padding:.9em 1.2em;margin:1.2em 0}
.callout h3{margin-top:0}
.statement{font-size:1.02rem;border-left:3px solid var(--accent);padding-left:.9em;margin:1em 0}

table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:.95rem}
table th,table td{text-align:left;padding:.42em .7em;border-bottom:1px solid var(--line);vertical-align:top}
table th{font-weight:600;color:var(--muted);width:34%}
table.grid th{width:auto;color:var(--ink);border-bottom:2px solid var(--ink);white-space:nowrap}
table.grid td{font-variant-numeric:tabular-nums}
tr.muted td{color:var(--muted)}
.barcell{width:130px}
.bar-fill{fill:var(--accent);opacity:.75}
.bar-ci{stroke:var(--muted);stroke-width:1.5}

.hint{color:var(--muted);font-size:.9rem}
.warn{color:var(--warn);font-weight:600}
.empty{color:var(--muted);background:var(--soft);padding:.8em 1em;border-left:3px solid var(--line)}

.chart{margin:1.2em 0;text-align:center}
.chart svg{max-width:440px;width:100%;height:auto}
.plot{fill:none;stroke:var(--line)}
.diag{stroke:var(--muted);stroke-dasharray:4 4;stroke-width:1}
.curve{fill:none;stroke:var(--accent);stroke-width:2}
.dot{fill:var(--accent)}
.dot.weak{fill:var(--muted);opacity:.45}
.tick,.axis{font-family:system-ui,sans-serif;font-size:9px;fill:var(--muted)}
figcaption{color:var(--muted);font-size:.85rem;max-width:56ch;margin:.5em auto 0;text-align:left}

.counts{margin:.8em 0}
.chip{display:inline-block;padding:.12em .6em;border-radius:10px;font-size:.75rem;font-weight:700;
  font-family:system-ui,sans-serif;letter-spacing:.03em;margin-right:.5em}
.chip.critique{background:#f6dedb;color:var(--bad)}
.chip.majeur{background:#f7ecd6;color:var(--warn)}
.chip.mineur{background:#ececeb;color:var(--muted)}

.defect{border:1px solid var(--line);border-left-width:4px;padding:.9em 1.1em;margin:1em 0;background:#fff;
  break-inside:avoid;page-break-inside:avoid}
.defect.critique{border-left-color:var(--bad)}
.defect.majeur{border-left-color:var(--warn)}
.defect.mineur{border-left-color:var(--muted)}
.defect header{display:flex;flex-wrap:wrap;gap:.6em;align-items:baseline;margin-bottom:.6em}
.defect .id{color:var(--muted)}
.defect .cat{color:var(--muted);font-size:.85rem}
.defect .conf{margin-left:auto;color:var(--muted);font-size:.85rem}
.defect dl{display:grid;grid-template-columns:78px 1fr;gap:.35em .9em;margin:0}
.defect dt{color:var(--muted);font-size:.85rem;font-weight:600}
.defect dd{margin:0;min-width:0}
.defect pre{margin:0;padding:.45em .6em;background:var(--soft);border:1px solid var(--line);
  white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;max-height:15em;overflow:auto}
.defect pre.got{border-left:3px solid var(--bad)}
.defect pre.expected{border-left:3px solid var(--good)}
.defect .why{margin:.7em 0 0;font-size:.92rem;color:var(--muted)}

.reservations ol li{margin:.5em 0}
.ameliorations ol{padding-left:1.2em}
.ameliorations li{margin:1.1em 0}
.ameliorations .titre{font-weight:600;margin-bottom:.2em}
.ameliorations .badge{display:inline-block;font-size:.72em;letter-spacing:.06em;padding:.12em .5em;
  border-radius:3px;background:#eee;color:#444;vertical-align:.1em;margin-right:.4em}
.ameliorations .prio-bloquant .badge{background:#a32b1c;color:#fff}
.ameliorations .prio-important .badge{background:#8a6d1f;color:#fff}
.ameliorations .constat{margin:.2em 0}
.ameliorations .pourquoi{color:#444;margin:.3em 0}
.ameliorations .preuve{font-size:.85em;color:#777}
.ameliorations .rien{color:#666}

footer{margin-top:3em;padding-top:1em;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}

@media print{
  body{font-size:11pt}
  main{max-width:none;padding:0 12mm}
  .cover{min-height:auto;page-break-after:always;padding:0 12mm 12mm}
  h2{page-break-after:avoid}
  .defect,.chart,table{page-break-inside:avoid}
  .verdict{background:none}
  a{text-decoration:none;color:inherit}
}
@media (max-width:640px){
  .cover-facts{grid-template-columns:1fr;gap:.2em}
  .cover-facts dd{margin-bottom:.8em}
  .defect dl{grid-template-columns:1fr}
  table th{width:auto}
}
`;
