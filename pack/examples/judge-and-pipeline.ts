// Les deux analyses que le rapport standard ne couvre pas : le juge, et la cascade.
//
//   node examples/judge-and-pipeline.ts
//
// Toutes deux répondent à des questions que le contrat à quatre membres ne pose pas directement,
// et toutes deux se calculent SANS VÉRITÉ TERRAIN pour leur partie la plus utile.

import { anchoring } from "../core/baseline.ts";
import { confusion } from "../core/agreement.ts";
import { evaluate } from "../core/evaluate.ts";
import { ablationInstruction, pipelineAnchoring } from "../core/pipeline.ts";
import { renderConsole } from "../report/console.ts";
import judgeAdapter, { ANSWERS, judgeAnalysis } from "../adapters/judge.ts";

const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
const rule = (c = "─") => c.repeat(96);

// ══ 1. Le juge, évalué comme n'importe quel autre système ═════════════════════════════════════
console.log(renderConsole(await evaluate(judgeAdapter, { bootstrapSamples: 2000 })));

// ══ 2. Ce que le rapport standard ne dit pas sur un juge ══════════════════════════════════════
const { agreement: acc, falseAccepts: fa, generatorAnchoring } = judgeAnalysis();

console.log("");
console.log(rule("═"));
console.log("ANALYSE PROPRE AU JUGE");
console.log(rule("═"));
console.log("");
console.log("accord corrigé du hasard");
console.log(`  accord brut            ${pc(acc.rawAgreement)}`);
console.log(`  attendu par hasard     ${pc(acc.expectedAgreement)}`);
console.log(`  kappa de Cohen         ${acc.kappa.toFixed(3)}`);
console.log("");
console.log(`→ ${acc.interpretation}`);
console.log("");

console.log("distribution des étiquettes");
for (const d of acc.labelDistribution) {
  console.log(`  ${d.label.padEnd(14)} juge ${pc(d.judgeShare).padStart(7)}   humain ${pc(d.humanShare).padStart(7)}`);
}
console.log("");

console.log("matrice de confusion (humain → juge)");
for (const c of confusion(
  ANSWERS.map((a) => ({
    itemId: a.id,
    judge: a.fluent ? (a.generatorConfidence >= 0.8 ? "correcte" : "incorrecte") : "incorrecte",
    human: a.human,
  })),
)) {
  const flag = c.human !== c.judge ? "  ← désaccord" : "";
  console.log(`  humain ${c.human.padEnd(12)} juge ${c.judge.padEnd(12)} n=${String(c.n).padStart(3)}  ${pc(c.share).padStart(7)}${flag}`);
}
console.log("");

console.log("faux acceptés — le seul type d'erreur réellement coûteux");
console.log(`  ${fa.n} réponses FAUSSES validées par le juge, soit ${pc(fa.rate)} des réponses fausses`);
console.log(`  identifiants : ${fa.itemIds.join(", ")}`);
console.log("");
console.log("  Un juge trop sévère fait perdre du temps. Un juge trop indulgent laisse passer en");
console.log("  production des réponses fausses — et le tableau de bord reste vert.");
console.log("");

const judgeAnchor = anchoring(generatorAnchoring);
console.log("le juge note-t-il, ou paraphrase-t-il son générateur ?");
console.log(`  écart médian           ${pc(judgeAnchor.medianAbsoluteDistance)}`);
console.log(`  corrélation            ${judgeAnchor.correlation.toFixed(4)}`);
console.log("");
console.log(`→ ${judgeAnchor.statement}`);

// ══ 3. Ancrage en cascade sur un pipeline à trois étages ══════════════════════════════════════
//
// Les valeurs sont les confiances de chaque étage sur les mêmes cas. Le générateur suit d'assez
// près le récupérateur ; le juge, lui, recopie le générateur.
const retrieverScores = ANSWERS.map((a) => a.generatorConfidence * 0.9 + 0.05);
const generatorScores = ANSWERS.map((a, i) => a.generatorConfidence + ((i % 5) - 2) * 0.03);
const judgeScores = generatorAnchoring.map((g) => g.prob);

const pipe = pipelineAnchoring([
  { name: "récupérateur", values: retrieverScores, cost: 1 },
  { name: "générateur", values: generatorScores, cost: 10 },
  { name: "juge", values: judgeScores, cost: 8 },
]);

console.log("");
console.log(rule("═"));
console.log("ANCRAGE EN CASCADE — récupérateur → générateur → juge");
console.log(rule("═"));
console.log("");
for (const l of pipe.links) {
  console.log(
    `  ${l.from.padEnd(14)} → ${l.to.padEnd(14)} `
    + `écart médian ${pc(l.anchoring.medianAbsoluteDistance).padStart(7)}   `
    + `corrélation ${l.anchoring.correlation.toFixed(4)}   `
    + (l.redundant ? "RELAIS" : "apporte quelque chose"),
  );
}
console.log("");
console.log(`→ ${pipe.verdict}`);
console.log("");
console.log(`→ ${ablationInstruction(pipe)}`);

// ══ 4. Le même détecteur, sur un pipeline CONSTRUIT pour être redondant ═══════════════════════
//
// Le scénario ci-dessus ne déclenche pas le détecteur, et c'est un résultat en soi : ces trois
// étages font chacun quelque chose. Mais un lecteur a besoin de voir l'alarme sonner au moins une
// fois pour savoir à quoi elle ressemble.
//
// Celui-ci est donc FABRIQUÉ : le « reclassement » reprend le récupérateur en le bougeant de
// quelques millièmes, et le « vérificateur » recopie le reclassement. C'est le cas typique d'un
// étage ajouté par prudence qui ne change jamais rien.
const redondant = pipelineAnchoring([
  { name: "récupérateur", values: retrieverScores, cost: 1 },
  { name: "reclassement", values: retrieverScores.map((v, i) => v + ((i % 3) - 1) * 0.002), cost: 6 },
  { name: "vérificateur", values: retrieverScores.map((v, i) => v + ((i % 4) - 2) * 0.003), cost: 9 },
]);

console.log("");
console.log(rule("═"));
console.log("LE MÊME DÉTECTEUR, SUR UN PIPELINE CONSTRUIT POUR ÊTRE REDONDANT");
console.log(rule("═"));
console.log("");
for (const l of redondant.links) {
  console.log(
    `  ${l.from.padEnd(14)} → ${l.to.padEnd(14)} `
    + `écart médian ${pc(l.anchoring.medianAbsoluteDistance).padStart(7)}   `
    + `corrélation ${l.anchoring.correlation.toFixed(4)}   `
    + (l.redundant ? "RELAIS" : "apporte quelque chose"),
  );
}
console.log("");
console.log(`→ ${redondant.verdict}`);
console.log("");
console.log(`→ ${ablationInstruction(redondant)}`);
console.log(rule("═"));
