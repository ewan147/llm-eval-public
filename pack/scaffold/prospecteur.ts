// Le PROSPECTEUR : aller chercher, dans un projet, les données qui permettraient de l'évaluer.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// CE QU'IL FAIT, ET LA LIGNE QU'IL NE FRANCHIT PAS.
//
// Il fouille un projet — base SQLite, fichiers JSON, CSV, schémas Drizzle ou Prisma, migrations
// SQL — et cherche des traces de trois choses, et de trois seulement :
//
//   · une PRÉDICTION   — ce que le système a annoncé
//   · une ISSUE        — ce qui s'est réellement passé ensuite
//   · une RÉFÉRENCE    — ce qu'une méthode bête aurait annoncé
//
// Puis il ÉCRIT LE CODE qui lit ces données. Pas un squelette à trous : du code exécutable, avec
// les vrais noms de tables et de colonnes trouvés sur place.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA LIGNE QU'IL NE FRANCHIT PAS, et c'est la raison d'être de tout ce projet.
//
// Il ne DÉCIDE jamais laquelle des colonnes est la vérité terrain. Il propose, il classe, il
// explique pourquoi il propose — et il écrit en toutes lettres, dans le code qu'il génère, quelles
// correspondances sont des SUPPOSITIONS à vérifier.
//
// La raison est simple et elle est le cœur du problème : un outil qui choisit lui-même sa vérité
// terrain mesure son propre choix. Il trouvera toujours une colonne qui « ressemble » à un
// résultat, produira un pourcentage, et ce pourcentage n'aura aucun sens que personne ne pourra
// détecter — parce qu'il aura l'air parfaitement normal.
//
// C'est exactement le défaut que ce projet a corrigé six fois en une journée, sous une forme plus
// insidieuse : ici, personne ne relirait jamais les réponses, puisqu'il n'y en a pas.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// LECTURE SEULE, TOUJOURS. Les bases sont ouvertes en `readOnly`. Rien n'est jamais écrit dans le
// projet examiné, à l'exception du fichier d'adaptateur, dans `eval/`, et seulement sur demande
// explicite.
// ═════════════════════════════════════════════════════════════════════════════════════════════

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, relative } from "node:path";

export type Role = "prediction" | "issue" | "reference" | "temps" | "identite" | "inconnu";

export interface Colonne {
  nom: string;
  role: Role;
  /** Pourquoi ce rôle a été proposé. Rendu tel quel dans le rapport : une devinette s'explique. */
  motif: string;
  /** Exemple de valeur, quand la source permet d'en lire une. */
  exemple?: string;
}

export type Origine = "sqlite" | "json" | "csv" | "schema";

export interface Gisement {
  origine: Origine;
  /** Chemin du fichier, relatif au projet. */
  chemin: string;
  /** Table, ou nom du tableau JSON. */
  nom: string;
  lignes: number | null;
  colonnes: Colonne[];
  /** De 0 à 100. Ne mesure QUE la présence des trois rôles, jamais la qualité des données. */
  note: number;
  /** Ce qui manque pour que ce gisement soit évaluable. Vide = rien ne manque. */
  manques: string[];
}

export interface Prospection {
  dossier: string;
  gisements: Gisement[];
  /** Fichiers vus mais écartés, avec la raison. Un prospecteur muet sur ses rejets est suspect. */
  ecartes: Array<{ chemin: string; raison: string }>;
  /** Ce que la prospection permet d'affirmer, et surtout ce qu'elle ne permet pas. */
  conclusion: string;
}

// ── Reconnaissance des rôles ──────────────────────────────────────────────────────────────────
//
// Ces motifs sont des DEVINETTES assumées. Ils servent à proposer un ordre de lecture, jamais à
// conclure. Un nom de colonne ne dit pas ce qu'elle contient — seul son propriétaire le sait.

const MOTIFS: Array<{ role: Role; motif: RegExp; quoi: string }> = [
  { role: "reference", motif: /bench|baseline|reference|naif|naive|control|indice|market|marche/i,
    quoi: "ressemble à une référence de comparaison" },
  { role: "issue", motif: /^ret|return|rendement|actual|reel|r[ée]el|result|r[ée]sultat|outcome|pnl|realized|realis|truth|v[ée]rit|label|gain|perf|observed|issue|final|exit/i,
    quoi: "ressemble à une issue observée" },
  { role: "prediction", motif: /direction|signal|forecast|predict|pr[ée]vision|confidence|confiance|proba|score|pick|recommend|estimat|rating|note|target|objectif/i,
    quoi: "ressemble à une prédiction du système" },
  { role: "temps", motif: /date|day|jour|_at$|time|timestamp|periode|p[ée]riode|when/i,
    quoi: "porte une date" },
  { role: "identite", motif: /^id$|_id$|symbol|ticker|isin|^key$|^code$|^name$|^nom$|slug|uuid/i,
    quoi: "identifie la ligne" },
];

/**
 * Attribue un rôle à une colonne.
 *
 * L'ORDRE DES MOTIFS COMPTE, et il est délibéré. « bench_1d » contient « ret » mais c'est d'abord
 * une référence ; « confidence » contient « id » mais c'est d'abord une prédiction. On teste donc
 * du plus spécifique au plus général, et la première correspondance gagne.
 */
export function classer(nom: string): { role: Role; motif: string } {
  for (const m of MOTIFS) {
    if (m.motif.test(nom)) return { role: m.role, motif: m.quoi };
  }
  return { role: "inconnu", motif: "aucun motif reconnu" };
}

function noter(colonnes: Colonne[], lignes: number | null): { note: number; manques: string[] } {
  const a = (r: Role) => colonnes.some((c) => c.role === r);
  const manques: string[] = [];
  let note = 0;

  if (a("prediction")) note += 35;
  else manques.push("aucune colonne ne ressemble à une prédiction du système");

  if (a("issue")) note += 35;
  else manques.push("aucune colonne ne ressemble à une issue observée — sans elle, rien n'est mesurable");

  if (a("reference")) note += 20;
  else manques.push("aucune référence de comparaison : le pack REFUSERA de conclure à la compétence");

  if (a("temps")) note += 5;
  if (a("identite")) note += 5;

  if (lignes !== null) {
    if (lignes < 30) manques.push(`${lignes} lignes : en dessous de 30, le pack ne conclut pas`);
    else if (lignes < 100) manques.push(`${lignes} lignes : assez pour décrire, pas pour départager deux versions`);
  }

  return { note, manques };
}

// ── Exploration du projet ─────────────────────────────────────────────────────────────────────

const IGNORES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".cache", ".turbo",
  "vendor", "__pycache__", ".venv",
]);

/** Extensions de bases SQLite. Les `-wal` et `-shm` sont ignorés : ce ne sont pas des bases. */
const BASES = [".db", ".sqlite", ".sqlite3", ".db3"];

function parcourir(racine: string, profondeurMax = 4): string[] {
  const trouves: string[] = [];
  const pile: Array<{ dossier: string; profondeur: number }> = [{ dossier: racine, profondeur: 0 }];

  while (pile.length > 0) {
    const { dossier, profondeur } = pile.pop()!;
    let entrees;
    try {
      entrees = readdirSync(dossier, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entrees) {
      if (e.name.startsWith(".") && e.name !== ".eval") continue;
      const complet = join(dossier, e.name);
      if (e.isDirectory()) {
        if (IGNORES.has(e.name) || profondeur >= profondeurMax) continue;
        pile.push({ dossier: complet, profondeur: profondeur + 1 });
      } else {
        trouves.push(complet);
      }
    }
  }
  return trouves;
}

/**
 * Fouille un projet et rapporte les gisements de données évaluables.
 *
 * Ne modifie rien. Les bases sont ouvertes en lecture seule ; les fichiers volumineux ne sont lus
 * qu'en tête.
 */
export function prospecter(dossier: string, options: { tailleMaxJson?: number } = {}): Prospection {
  const tailleMaxJson = options.tailleMaxJson ?? 8_000_000;
  const gisements: Gisement[] = [];
  const ecartes: Array<{ chemin: string; raison: string }> = [];
  const fichiers = parcourir(dossier);

  for (const f of fichiers) {
    const rel = relative(dossier, f).replace(/\\/g, "/");
    const ext = extname(f).toLowerCase();

    // Une sauvegarde s'appelle souvent « base.db.bak-20260903 » : son extension est
    // « .bak-20260903 », donc le test par extension ne la voyait NI comme une base, NI comme un
    // rejet. Elle disparaissait sans un mot. Un prospecteur muet sur ce qu'il ignore est
    // exactement ce qu'on ne veut pas : on ne peut pas contester ce qu'on ne voit pas.
    if (!BASES.includes(ext) && /\.(db|sqlite|sqlite3|db3)\./i.test(rel)) {
      ecartes.push({ chemin: rel, raison: "copie ou sauvegarde d'une base" });
      continue;
    }

    if (BASES.includes(ext)) {
      // Les sauvegardes sont des copies : les inclure ferait compter deux fois les mêmes données.
      if (/\.bak|backup|copie|copy|-old/i.test(f)) {
        ecartes.push({ chemin: rel, raison: "sauvegarde d'une autre base" });
        continue;
      }
      gisements.push(...prospecterSqlite(f, rel, ecartes));
      continue;
    }

    if (ext === ".json") {
      let taille = 0;
      try { taille = statSync(f).size; } catch { continue; }
      if (taille > tailleMaxJson) {
        ecartes.push({ chemin: rel, raison: `${Math.round(taille / 1e6)} Mo : trop gros pour être lu en entier` });
        continue;
      }
      const g = prospecterJson(f, rel);
      if (g) gisements.push(g); else ecartes.push({ chemin: rel, raison: "pas un tableau d'objets" });
      continue;
    }

    if (ext === ".csv" || ext === ".tsv") {
      const g = prospecterCsv(f, rel, ext === ".tsv" ? "\t" : ",");
      if (g) gisements.push(g);
      continue;
    }

    if (/schema\.(ts|prisma)$/i.test(rel) || /migrations?\/.*\.sql$/i.test(rel)) {
      gisements.push(...prospecterSchema(f, rel));
    }
  }

  // UNE TABLE LUE POUR DE VRAI CHASSE SA DÉCLARATION. Trouver `signals` à la fois dans la base
  // et dans le schéma Drizzle ferait deux gisements pour une seule chose, dont un sans données.
  // Le schéma ne sert que là où la base est absente — un dépôt fraîchement cloné, par exemple.
  const tablesReelles = new Set(
    gisements.filter((g) => g.origine === "sqlite").map((g) => g.nom.toLowerCase()),
  );
  const retenus = gisements.filter(
    (g) => g.origine !== "schema" || !tablesReelles.has(g.nom.toLowerCase()),
  );
  for (const g of gisements) {
    if (g.origine === "schema" && tablesReelles.has(g.nom.toLowerCase())) {
      ecartes.push({ chemin: `${g.chemin} → ${g.nom}`, raison: "table lue directement dans la base" });
    }
  }

  retenus.sort((a, b) => b.note - a.note || (b.lignes ?? 0) - (a.lignes ?? 0));
  return { dossier, gisements: retenus, ecartes, conclusion: conclure(retenus) };
}

function conclure(gisements: Gisement[]): string {
  const complets = gisements.filter((g) => g.note >= 90);
  const mesurables = gisements.filter((g) => g.note >= 70);

  if (complets.length > 0) {
    return (
      `${complets.length} gisement(s) portent à la fois une prédiction, une issue et une `
      + "référence. C'est la configuration complète : le pack peut rendre un verdict de "
      + "compétence. AVANT DE CROIRE LE MOINDRE CHIFFRE, vérifier que les colonnes proposées "
      + "sont bien celles que vous croyez — cette correspondance est une devinette du "
      + "prospecteur, pas une lecture de vos données."
    );
  }
  if (mesurables.length > 0) {
    return (
      `${mesurables.length} gisement(s) portent une prédiction et une issue, mais AUCUNE `
      + "référence n'a été reconnue. Le pack mesurera le taux de réussite et REFUSERA d'en "
      + "conclure quoi que ce soit sur la compétence — un taux sans référence ne dit rien. "
      + "Écrire la référence à la main dans l'adaptateur généré est le travail qui reste."
    );
  }
  if (gisements.length > 0) {
    return (
      "Des données ont été trouvées, mais aucune ne réunit une prédiction ET une issue "
      + "observée. Sans ce couple, il n'y a rien à mesurer — ce n'est pas un défaut de l'outil, "
      + "c'est que le système n'enregistre pas ce qu'il a annoncé, ou pas ce qui s'est passé "
      + "ensuite. Commencer par le faire enregistrer."
    );
  }
  return "Aucune source de données exploitable trouvée dans ce projet.";
}

// ── SQLite ────────────────────────────────────────────────────────────────────────────────────

function prospecterSqlite(
  fichier: string, rel: string, ecartes: Array<{ chemin: string; raison: string }>,
): Gisement[] {
  // `createRequire` et non `require` : ce paquet est en `"type": "module"`, donc `require` n'y
  // existe pas. La première version l'appelait quand même — l'exception était avalée par le
  // `catch`, et la base de 75 Mo disparaissait silencieusement du rapport. Un outil qui cherche
  // des données ne doit jamais escamoter une source en silence : la raison du rejet est désormais
  // toujours écrite dans `ecartes`.
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
  } catch (err) {
    ecartes.push({
      chemin: rel,
      raison: `node:sqlite indisponible (${(err as Error).message}) — Node 22.5+ requis`,
    });
    return [];
  }

  let db: InstanceType<typeof DatabaseSync>;
  try {
    // LECTURE SEULE : on examine la base d'un projet vivant, peut-être en cours d'utilisation.
    db = new DatabaseSync(fichier, { readOnly: true });
  } catch (err) {
    ecartes.push({ chemin: rel, raison: `base illisible : ${(err as Error).message}` });
    return [];
  }

  const out: Gisement[] = [];
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;

    for (const { name } of tables) {
      let colonnesBrutes: Array<{ name: string }>;
      let lignes: number | null = null;
      try {
        colonnesBrutes = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>;
        const c = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
        lignes = c.n;
      } catch {
        continue;
      }

      // Un exemple de ligne rend le rapport vérifiable d'un coup d'œil : on voit ce que la
      // colonne contient VRAIMENT, au lieu de faire confiance à son nom.
      let echantillon: Record<string, unknown> | undefined;
      try {
        echantillon = db.prepare(`SELECT * FROM "${name}" LIMIT 1`).get() as Record<string, unknown>;
      } catch { /* table vide ou verrouillée */ }

      const colonnes: Colonne[] = colonnesBrutes.map((c) => {
        const { role, motif } = classer(c.name);
        const v = echantillon?.[c.name];
        return {
          nom: c.name,
          role,
          motif,
          exemple: v === undefined || v === null ? undefined : String(v).slice(0, 40),
        };
      });

      const { note, manques } = noter(colonnes, lignes);
      if (note < 35 && (lignes ?? 0) === 0) continue;
      out.push({ origine: "sqlite", chemin: rel, nom: name, lignes, colonnes, note, manques });
    }
  } finally {
    db.close();
  }
  return out;
}

// ── JSON ──────────────────────────────────────────────────────────────────────────────────────

function prospecterJson(fichier: string, rel: string): Gisement | null {
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(fichier, "utf-8"));
  } catch {
    return null;
  }

  // On cherche un tableau d'objets, à la racine ou sous une clé.
  const tableau = trouverTableau(brut);
  if (tableau === null || tableau.liste.length === 0) return null;

  const premier = tableau.liste[0];
  if (typeof premier !== "object" || premier === null || Array.isArray(premier)) return null;

  const colonnes: Colonne[] = Object.keys(premier as Record<string, unknown>).map((nom) => {
    const { role, motif } = classer(nom);
    const v = (premier as Record<string, unknown>)[nom];
    return {
      nom, role, motif,
      exemple: v === undefined || v === null ? undefined : String(v).slice(0, 40),
    };
  });

  const { note, manques } = noter(colonnes, tableau.liste.length);
  if (note < 35) return null;
  return {
    origine: "json", chemin: rel, nom: tableau.cle ?? "(racine)",
    lignes: tableau.liste.length, colonnes, note, manques,
  };
}

function trouverTableau(v: unknown): { cle: string | null; liste: unknown[] } | null {
  if (Array.isArray(v)) return { cle: null, liste: v };
  if (typeof v === "object" && v !== null) {
    for (const [cle, valeur] of Object.entries(v)) {
      if (Array.isArray(valeur) && valeur.length > 0) return { cle, liste: valeur };
    }
  }
  return null;
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────

function prospecterCsv(fichier: string, rel: string, sep: string): Gisement | null {
  let tete: string;
  try {
    // On ne lit que le début : un CSV de plusieurs centaines de mégaoctets ne doit pas être
    // chargé en mémoire pour connaître ses colonnes.
    tete = readFileSync(fichier, "utf-8").slice(0, 200_000);
  } catch {
    return null;
  }
  const lignesTexte = tete.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lignesTexte.length < 2) return null;

  const noms = lignesTexte[0].split(sep).map((n) => n.trim().replace(/^"|"$/g, ""));
  if (noms.length < 2) return null;
  const valeurs = lignesTexte[1].split(sep).map((n) => n.trim().replace(/^"|"$/g, ""));

  const colonnes: Colonne[] = noms.map((nom, i) => {
    const { role, motif } = classer(nom);
    return { nom, role, motif, exemple: valeurs[i]?.slice(0, 40) };
  });

  // Le compte est approximatif si le fichier a été tronqué : on le dit en le laissant à null.
  const complet = tete.length < 200_000;
  const { note, manques } = noter(colonnes, complet ? lignesTexte.length - 1 : null);
  if (note < 35) return null;
  return {
    origine: "csv", chemin: rel, nom: rel.split("/").pop() ?? rel,
    lignes: complet ? lignesTexte.length - 1 : null, colonnes, note, manques,
  };
}

// ── Schémas déclarés (Drizzle, Prisma, SQL) ───────────────────────────────────────────────────
//
// Un schéma ne contient PAS de données : il dit ce que le système est censé enregistrer. C'est
// utile quand la base n'est pas là — sur un dépôt fraîchement cloné, par exemple — mais un
// gisement sans lignes ne se mesure pas, et sa note le reflète.

/** Fin du bloc ouvert juste avant `debut`, en comptant les accolades. */
function finDeBloc(texte: string, debut: number): number {
  let niveau = 1;
  for (let i = debut; i < texte.length; i++) {
    if (texte[i] === "{") niveau++;
    else if (texte[i] === "}") {
      niveau--;
      if (niveau === 0) return i;
    }
  }
  return texte.length;
}

function prospecterSchema(fichier: string, rel: string): Gisement[] {
  let texte: string;
  try {
    texte = readFileSync(fichier, "utf-8");
  } catch {
    return [];
  }

  const out: Gisement[] = [];

  // Drizzle : sqliteTable("nom", { colonne: type("colonne_sql"), … })
  for (const t of texte.matchAll(/sqliteTable\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g)) {
    const debut = t.index! + t[0].length;
    // ON SUIT LES ACCOLADES, ON NE DÉCOUPE PAS À LA LOUCHE.
    //
    // Une première version prenait « les 3000 caractères suivants ». Sur un schéma réel, cette
    // fenêtre débordait sur les tables voisines : `cached_news` se retrouvait avec les colonnes
    // de `signals` et de `paper_positions`, et recevait une note élevée pour des colonnes qu'elle
    // n'a pas. Une table inventée par l'outil, présentée comme évaluable — le même défaut que
    // partout ailleurs dans ce projet, en amont cette fois.
    const corps = texte.slice(debut, finDeBloc(texte, debut));
    const noms = [...corps.matchAll(/(?:text|integer|real|blob|numeric)\(\s*["'`]([^"'`]+)["'`]/g)]
      .map((m) => m[1]);
    if (noms.length === 0) continue;
    const colonnes = noms.map((nom) => ({ nom, ...classer(nom) }));
    const { note, manques } = noter(colonnes, null);
    if (note < 70) continue;
    out.push({
      origine: "schema", chemin: rel, nom: t[1], lignes: null, colonnes,
      note: note - 10,
      manques: [...manques, "schéma seulement : aucune donnée n'a été lue ici"],
    });
  }

  // Prisma : model Nom { champ Type … }
  for (const m of texte.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
    const noms = [...m[2].matchAll(/^\s*(\w+)\s+\w+/gm)].map((c) => c[1]);
    if (noms.length === 0) continue;
    const colonnes = noms.map((nom) => ({ nom, ...classer(nom) }));
    const { note, manques } = noter(colonnes, null);
    if (note < 70) continue;
    out.push({
      origine: "schema", chemin: rel, nom: m[1], lignes: null, colonnes,
      note: note - 10,
      manques: [...manques, "schéma seulement : aucune donnée n'a été lue ici"],
    });
  }

  return out;
}
