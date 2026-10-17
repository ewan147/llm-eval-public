// Écrire le code qui lit les données trouvées par le prospecteur.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// Ce module produit un adaptateur RÉEL : il ouvre la vraie base, lit la vraie table, utilise les
// vrais noms de colonnes. Rien à remplir pour qu'il tourne.
//
// Ce qu'il ne fait toujours pas, et ne fera jamais : décider à votre place ce que « avoir raison »
// veut dire. Ce choix est écrit en haut du fichier généré, en évidence, avec son alternative juste
// en dessous. Un générateur qui trancherait en silence produirait un pourcentage dépourvu de sens
// que personne ne pourrait détecter — il aurait l'air parfaitement normal.
// ═════════════════════════════════════════════════════════════════════════════════════════════

import type { Colonne, Gisement } from "./prospecteur.ts";

export interface CodeGenere {
  code: string;
  /** Les décisions prises par le générateur. L'appelant DOIT les montrer. */
  suppositions: string[];
}

/**
 * Apparie une issue et une référence portant sur le MÊME horizon.
 *
 * `ret_5d` va avec `bench_5d`, jamais avec `bench_1d`. Comparer un rendement à cinq jours au
 * rendement d'un indice à un jour produirait un écart qui ne mesure que la différence d'horizon —
 * invisible dans le résultat, et impossible à retrouver après coup.
 */
function apparier(
  issues: Colonne[],
  references: Colonne[],
): { issue?: Colonne; reference: Colonne | null; horizon: string | null } {
  const suffixe = (n: string) => /[_-]?(\d+\s*[a-z]*)$/i.exec(n)?.[1]?.toLowerCase() ?? null;

  for (const i of issues) {
    const s = suffixe(i.nom);
    if (s === null) continue;
    const r = references.find((x) => suffixe(x.nom) === s);
    if (r) return { issue: i, reference: r, horizon: s };
  }
  return { issue: issues[0], reference: references[0] ?? null, horizon: null };
}

interface Champs {
  identifiant?: Colonne;
  date?: Colonne;
  sens?: Colonne;
  confiance?: Colonne;
  issue?: Colonne;
  reference: Colonne | null;
  horizon: string | null;
  suppositions: string[];
}

export function genererDepuisGisement(g: Gisement, dossierProjet: string): CodeGenere {
  const predictions = g.colonnes.filter((c) => c.role === "prediction");
  const issues = g.colonnes.filter((c) => c.role === "issue");
  const references = g.colonnes.filter((c) => c.role === "reference");
  const identites = g.colonnes.filter((c) => c.role === "identite");
  const temps = g.colonnes.filter((c) => c.role === "temps");

  const { issue, reference, horizon } = apparier(issues, references);
  // Une colonne de confiance ouvre la calibration — « quand il dit 70 %, a-t-il raison 70 % du
  // temps ? ». C'est souvent là que se cachent les vrais défauts : on la privilégie.
  const confiance = predictions.find((c) => /confidence|confiance|proba|score/i.test(c.nom));
  const sens = predictions.find((c) => /direction|signal|sens|pick/i.test(c.nom));
  const identifiant = identites.find((c) => c.nom !== "id") ?? identites[0];
  const date = temps[0];

  const suppositions: string[] = [
    `« avoir raison » a été défini comme : ${issue?.nom ?? "(aucune colonne d'issue)"} > 0.`,
    reference
      ? `la référence à battre est ${reference.nom} > 0${horizon ? ` — même horizon (${horizon})` : ""}.`
      : "AUCUNE référence trouvée : le pack refusera de conclure à la compétence.",
  ];
  if (confiance) suppositions.push(`${confiance.nom} est lue comme une probabilité.`);
  if (sens) suppositions.push(`${sens.nom} est lue comme le sens de la prédiction, et sert de tranche.`);

  const champs: Champs = { identifiant, date, sens, confiance, issue, reference, horizon, suppositions };
  const source = `${dossierProjet.replace(/\\/g, "/")}/${g.chemin}`;

  return {
    code: g.origine === "json" ? codeJson(g, source, champs) : codeSqlite(g, source, champs),
    suppositions,
  };
}

// ── L'en-tête, commun aux deux formats ────────────────────────────────────────────────────────

function enTete(g: Gisement, source: string, c: Champs): string {
  const lignes = g.lignes !== null ? ` — ${g.lignes} lignes à la prospection` : "";
  return [
    `// Adaptateur d'évaluation — ÉCRIT PAR LE PROSPECTEUR le ${new Date().toISOString().slice(0, 10)}.`,
    "//",
    `// Source : ${source}`,
    `// Table  : ${g.nom}${lignes}`,
    "//",
    "// ═══════════════════════════════════════════════════════════════════════════════════════════",
    "// LES LIGNES À VÉRIFIER AVANT DE CROIRE LE MOINDRE CHIFFRE",
    "//",
    "// Le prospecteur a DEVINÉ ce qui suit en lisant des NOMS de colonnes. Il n'a aucun moyen de",
    "// savoir ce qu'elles contiennent. Si l'une de ces lignes est fausse, tout ce que produira ce",
    "// banc sera faux — et aura l'air parfaitement normal.",
    "//",
    ...c.suppositions.map((s) => `//   · ${s}`),
    "//",
    "// Une seule personne peut confirmer ou corriger : celle qui a écrit le système.",
    "// ═══════════════════════════════════════════════════════════════════════════════════════════",
  ].join("\n");
}

const PREDICT_DOC = [
  "  /**",
  "   * CE QUE LE SYSTÈME A ANNONCÉ.",
  "   *",
  "   * On ne rappelle pas le système : on lit ce qu'il a écrit à l'époque. C'est la seule façon",
  "   * d'évaluer des prédictions passées — le rappeler aujourd'hui lui donnerait des informations",
  "   * qu'il n'avait pas le jour de la prédiction, et le banc mesurerait une prescience inexistante.",
  "   */",
].join("\n");

function corpsPredict(c: Champs): string {
  if (!c.confiance) return '    return { label: "gagnant" };';
  return [
    `    const p = nombre(ligne[${JSON.stringify(c.confiance.nom)}]);`,
    "    // Une confiance donnée en pourcentage (0–100) est ramenée dans [0,1].",
    "    const prob = p === null ? undefined : p > 1 ? p / 100 : p;",
    '    return { label: "gagnant", prob };',
  ].join("\n");
}

function corpsBaseline(c: Champs, acces: string): string {
  if (!c.reference) {
    return [
      "  // AUCUNE RÉFÉRENCE N'A ÉTÉ TROUVÉE dans cette source. Le pack REFUSERA de conclure à la",
      "  // compétence tant que cette méthode n'existe pas, et il a raison : un taux de réussite de",
      "  // 60 % ne vaut rien tant qu'on ignore ce que « ne rien faire » aurait donné.",
      "  //",
      "  // Écrire ici la méthode la plus bête qui fait le même travail : « toujours la classe",
      "  // majoritaire », « la valeur d'hier », « suivre la tendance ».",
    ].join("\n");
  }
  return [
    "  /**",
    "   * LA RÉFÉRENCE À BATTRE : ce qu'on aurait obtenu sans ce système.",
    "   *",
    "   * VARIANTE PLUS SÉVÈRE, et souvent la bonne pour un système de sélection : définir la vérité",
    `   * comme « ${c.issue?.nom} > ${c.reference.nom} » — le choix a-t-il BATTU la référence — plutôt`,
    "   * que « le choix est-il monté ». Dans un marché haussier, la seconde question est flatteuse.",
    "   */",
    `  baseline(${acces}) {`,
    `    const b = nombre(ligne[${JSON.stringify(c.reference.nom)}]);`,
    "    const gagnant = b !== null && b > 0;",
    "    // PAS de `prob` ici, et c'est délibéré. Une référence est une RÈGLE, pas un prévisionniste :",
    "    // lui attribuer 0 ou 1 la ferait juger sur un score qui récompense la nuance, qu'elle n'a",
    "    // pas. Elle serait battue d'avance, et l'écart de Brier mesurerait son absence de nuance au",
    "    // lieu de la justesse du système. Le pack compare alors les taux de réussite, ce qui est la",
    "    // bonne question pour une règle.",
    '    return { label: gagnant ? "gagnant" : "perdant" };',
    "  },",
  ].join("\n");
}

const NOMBRE = [
  "const nombre = (v: unknown): number | null => {",
  '  const n = typeof v === "number" ? v : Number(v);',
  "  return Number.isFinite(n) ? n : null;",
  "};",
].join("\n");

// ── SQLite ────────────────────────────────────────────────────────────────────────────────────

function codeSqlite(g: Gisement, source: string, c: Champs): string {
  const colonnes = [c.identifiant?.nom, c.date?.nom, c.sens?.nom, c.confiance?.nom,
    c.issue?.nom, c.reference?.nom].filter((x): x is string => typeof x === "string");
  const uniques = [...new Set(colonnes)];
  const select = uniques.map((n) => `"${n}"`).join(", ");
  const filtre = c.issue ? ` WHERE "${c.issue.nom}" IS NOT NULL` : "";

  const idExpr = c.identifiant
    ? `String(l[${JSON.stringify(c.identifiant.nom)}] ?? i)`
    : "String(i)";
  const idComplet = c.date
    ? `${idExpr} + "@" + String(l[${JSON.stringify(c.date.nom)}] ?? "")`
    : idExpr;

  return [
    enTete(g, source, c),
    "//",
    "// Lancer :   node <chemin-du-pack>/cli.ts run <ce-fichier>",
    "",
    'import { DatabaseSync } from "node:sqlite";',
    "",
    `const BASE = ${JSON.stringify(source)};`,
    `const REQUETE = ${JSON.stringify(`SELECT ${select} FROM "${g.nom}"${filtre}`)};`,
    "",
    "type Ligne = Record<string, unknown>;",
    "",
    "/**",
    " * Lecture SEULE de la base du projet.",
    " *",
    " * Un banc ne doit jamais écrire dans les données qu'il mesure, et une base ouverte en écriture",
    " * par erreur peut bloquer l'application elle-même pendant qu'elle tourne.",
    " */",
    "function lire(): Ligne[] {",
    "  const db = new DatabaseSync(BASE, { readOnly: true });",
    "  try {",
    "    return db.prepare(REQUETE).all() as Ligne[];",
    "  } finally {",
    "    db.close();",
    "  }",
    "}",
    "",
    NOMBRE,
    "",
    "const adaptateur = {",
    `  name: ${JSON.stringify(g.nom)},`,
    "",
    "  async loadItems() {",
    `    return lire().map((l, i) => ({ id: ${idComplet}, ligne: l }));`,
    "  },",
    "",
    PREDICT_DOC,
    "  async predict({ ligne }: { ligne: Ligne }) {",
    corpsPredict(c),
    "  },",
    "",
    "  /** CE QUI S'EST RÉELLEMENT PASSÉ. Voir l'avertissement en tête de fichier. */",
    "  truth({ ligne }: { ligne: Ligne }) {",
    `    const r = nombre(ligne[${JSON.stringify(c.issue?.nom ?? "")}]);`,
    "    const gagnant = r !== null && r > 0;",
    '    return { label: gagnant ? "gagnant" : "perdant", prob: gagnant ? 1 : 0 };',
    "  },",
    "",
    corpsBaseline(c, "{ ligne }: { ligne: Ligne }"),
    c.sens ? [
      "",
      "  /** Ventilation par sens de la prédiction : c'est souvent là qu'un système casse. */",
      "  category({ ligne }: { ligne: Ligne }) {",
      `    return String(ligne[${JSON.stringify(c.sens.nom)}] ?? "inconnu");`,
      "  },",
    ].join("\n") : "",
    "};",
    "",
    "export default adaptateur;",
    "",
  ].join("\n");
}

// ── JSON ──────────────────────────────────────────────────────────────────────────────────────

function codeJson(g: Gisement, source: string, c: Champs): string {
  const idExpr = c.identifiant
    ? `String(ligne[${JSON.stringify(c.identifiant.nom)}] ?? i)`
    : "String(i)";
  const cleIssue = JSON.stringify(c.issue?.nom ?? "");

  return [
    enTete(g, source, c),
    "//",
    "// Lancer :   node <chemin-du-pack>/cli.ts run <ce-fichier>",
    "",
    'import { readFileSync } from "node:fs";',
    "",
    `const FICHIER = ${JSON.stringify(source)};`,
    `const CLE = ${JSON.stringify(g.nom)};`,
    "",
    "type Ligne = Record<string, unknown>;",
    "",
    NOMBRE,
    "",
    "function lire(): Ligne[] {",
    '  const brut = JSON.parse(readFileSync(FICHIER, "utf-8"));',
    "  const liste = Array.isArray(brut) ? brut : brut?.[CLE];",
    "  return Array.isArray(liste) ? (liste as Ligne[]) : [];",
    "}",
    "",
    "const adaptateur = {",
    `  name: ${JSON.stringify(g.nom)},`,
    "",
    "  async loadItems() {",
    "    return lire()",
    `      .filter((l) => l[${cleIssue}] !== null && l[${cleIssue}] !== undefined)`,
    `      .map((ligne, i) => ({ id: ${idExpr}, ligne }));`,
    "  },",
    "",
    PREDICT_DOC,
    "  async predict({ ligne }: { ligne: Ligne }) {",
    corpsPredict(c),
    "  },",
    "",
    "  /** CE QUI S'EST RÉELLEMENT PASSÉ. Voir l'avertissement en tête de fichier. */",
    "  truth({ ligne }: { ligne: Ligne }) {",
    `    const r = nombre(ligne[${cleIssue}]);`,
    "    const gagnant = r !== null && r > 0;",
    '    return { label: gagnant ? "gagnant" : "perdant", prob: gagnant ? 1 : 0 };',
    "  },",
    "",
    corpsBaseline(c, "{ ligne }: { ligne: Ligne }"),
    c.sens ? [
      "",
      "  category({ ligne }: { ligne: Ligne }) {",
      `    return String(ligne[${JSON.stringify(c.sens.nom)}] ?? "inconnu");`,
      "  },",
    ].join("\n") : "",
    "};",
    "",
    "export default adaptateur;",
    "",
  ].join("\n");
}
