// Génération d'un squelette d'adaptateur pour un projet existant.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE — et il répond à une question posée par le propriétaire du projet,
// qui mérite d'être écrite ici plutôt que perdue dans un journal.
//
// « Comment peut-on évaluer un système complexe sans que les tests soient personnalisés pour
//   ce système ? »
//
// On ne peut pas. Et le pack ne le prétend pas. Le partage est le suivant :
//
//   CE QUI EST PROPRE À VOTRE SYSTÈME, et que personne d'autre ne peut écrire :
//     · les cas de test          → `loadItems()`, vos données à vous
//     · ce que votre système dit → `predict()`, votre code à vous
//     · ce qui était vrai        → `truth()`, votre vérité terrain à vous
//     · à quoi le comparer       → `baseline()`, la méthode bête qu'il faut battre
//
//   CE QUI EST UNIVERSEL, et qu'il est inutile de réécrire :
//     · comparer à une référence plutôt que de regarder un pourcentage isolé
//     · REFUSER de conclure quand il n'y a pas de référence, ou pas assez de cas
//     · intervalles de confiance, puissance statistique, test apparié
//     · calibration, détection d'ancrage, coût par réponse CORRECTE
//
// Additionner deux colonnes est trivial. Ce qui est difficile — et identique que vous prédisiez
// le cours d'une action ou la catégorie d'un ticket — c'est de savoir quand le chiffre obtenu ne
// veut rien dire. C'est cette partie-là que le pack apporte.
//
// La personnalisation est donc entièrement réelle : elle tient dans les quarante lignes de ce
// squelette. Ce que le pack refuse, c'est d'inventer vos cas de test à votre place — un banc qui
// fabrique ses propres questions mesure sa propre imagination.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Famille = "prediction" | "classification" | "recherche" | "agent" | "inconnu";

export interface Diagnostic {
  dossier: string;
  /** Ce que le dossier a l'air d'être. Sert à choisir le squelette, jamais à conclure. */
  famille: Famille;
  indices: string[];
  /** Fichiers d'adaptateur déjà présents. */
  adaptateurs: string[];
}

/** Fichiers qui ne peuvent structurellement PAS être un adaptateur. */
const JAMAIS_UN_ADAPTATEUR = [
  /\.config\.(ts|mts|js|mjs|cjs)$/i,
  /\.d\.ts$/i,
  /^next-env\.d\.ts$/i,
  /^vite\.config\./i,
  /^jest\.config\./i,
  /^tailwind\.config\./i,
  /^webpack\./i,
  /^rollup\./i,
  /^babel\./i,
  /^commitlint\./i,
  /^\.eslintrc/i,
];

/**
 * Ce fichier a-t-il une chance d'être un adaptateur ?
 *
 * Proposer d'EXÉCUTER `next.config.ts` était le défaut trouvé sur un vrai projet : l'interface
 * offrait quatre clics qui ne pouvaient pas aboutir, puis expliquait ce qui manquait sans dire
 * quoi faire. Un outil qui propose une action impossible use la confiance qu'on lui accorde.
 */
export function peutEtreAdaptateur(nom: string): boolean {
  if (!/\.(ts|mts|mjs|js)$/i.test(nom)) return false;
  return !JAMAIS_UN_ADAPTATEUR.some((r) => r.test(nom));
}

/** Où l'on cherche un adaptateur, en plus du dossier lui-même. */
export const SOUS_DOSSIERS_EVAL = ["eval", "evaluation", "evaluations", ".eval"];

/**
 * Regarde un dossier et devine la FAMILLE du système, pour proposer le bon squelette.
 *
 * Aucune de ces devinettes n'entre dans une mesure. Elles servent uniquement à pré-remplir des
 * commentaires : se tromper de famille fait écrire un TODO un peu à côté, rien de plus.
 */
export function diagnostiquer(dossier: string): Diagnostic {
  const indices: string[] = [];
  let famille: Famille = "inconnu";

  const fichiers = lister(dossier);
  const pkg = lirePackage(dossier);
  const deps = pkg ? Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) : [];

  if (deps.includes("next")) indices.push("application Next.js");
  if (deps.includes("react")) indices.push("interface React");
  if (deps.some((d) => /openai|anthropic|ollama|langchain|ai-sdk|@ai-sdk/.test(d))) {
    indices.push("appelle un modèle de langage");
  }

  // Les noms de dossiers en disent plus long que les dépendances sur ce que le système PRODUIT.
  //
  // On descend de deux niveaux, parce que la racine d'un projet moderne ne contient que des
  // dossiers d'outillage : `src`, `app`, `public`, `scripts`. Ce qui décrit le métier est un ou
  // deux crans plus bas — `src/lib/signaux`, `src/lib/backtest`. Rester en surface revient à
  // deviner la famille d'un projet en lisant les noms de ses dossiers de build.
  const noms = [...fichiers.dossiers];
  for (const intermediaire of ["src", "app", "lib", "packages", "server"]) {
    const chemin = join(dossier, intermediaire);
    if (!existsSync(chemin)) continue;
    const niveau2 = lister(chemin);
    noms.push(...niveau2.fichiers, ...niveau2.dossiers);
    for (const sousDossier of niveau2.dossiers) {
      noms.push(...lister(join(chemin, sousDossier)).dossiers);
      noms.push(...lister(join(chemin, sousDossier)).fichiers);
    }
  }
  const sous = noms.join(" ").toLowerCase();
  if (/signal|forecast|predict|backtest|pick|portfolio|prevision/.test(sous)) {
    famille = "prediction";
    indices.push("produit des prévisions dont l'issue est observable plus tard");
  } else if (/classif|categor|triage|label|ticket|intent/.test(sous)) {
    famille = "classification";
    indices.push("range des entrées dans des catégories");
  } else if (/rag|retriev|search|index|embed|recherche/.test(sous)) {
    famille = "recherche";
    indices.push("retrouve des documents");
  } else if (/agent|tool|outil|workflow|routine/.test(sous)) {
    famille = "agent";
    indices.push("enchaîne des étapes ou appelle des outils");
  }

  const adaptateurs: string[] = [];
  for (const f of fichiers.fichiers) {
    if (peutEtreAdaptateur(f) && /adapt/i.test(f)) adaptateurs.push(join(dossier, f));
  }
  for (const sd of SOUS_DOSSIERS_EVAL) {
    const chemin = join(dossier, sd);
    if (!existsSync(chemin)) continue;
    for (const f of lister(chemin).fichiers) {
      if (peutEtreAdaptateur(f)) adaptateurs.push(join(chemin, f));
    }
  }

  return { dossier, famille, indices, adaptateurs };
}

function lister(dossier: string): { fichiers: string[]; dossiers: string[] } {
  try {
    const noms = readdirSync(dossier, { withFileTypes: true });
    return {
      fichiers: noms.filter((n) => n.isFile()).map((n) => n.name),
      dossiers: noms.filter((n) => n.isDirectory() && n.name !== "node_modules").map((n) => n.name),
    };
  } catch {
    return { fichiers: [], dossiers: [] };
  }
}

function lirePackage(dossier: string): {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null {
  try {
    return JSON.parse(readFileSync(join(dossier, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

// ── Le squelette ──────────────────────────────────────────────────────────────────────────────

/**
 * Écrit `<dossier>/eval/adapter.ts`.
 *
 * LE SQUELETTE TOURNE TEL QUEL, sur des données bidon, et le pack REFUSE alors de conclure. Ce
 * n'est pas un détail de confort : la première chose que voit l'utilisateur est le refus, sur son
 * propre projet, avant d'avoir branché quoi que ce soit. Un squelette qui plante enseigne
 * seulement qu'il manque un import.
 */
export function genererAdaptateur(dossier: string, options: { force?: boolean } = {}): {
  ok: boolean;
  fichier: string;
  message: string;
} {
  const d = diagnostiquer(dossier);
  const dossierEval = resolve(dossier, "eval");
  const fichier = join(dossierEval, "adapter.ts");

  if (existsSync(fichier) && !options.force) {
    return {
      ok: false,
      fichier,
      message: `Un adaptateur existe déjà : ${fichier}. Il ne sera pas écrasé.`,
    };
  }

  mkdirSync(dossierEval, { recursive: true });
  writeFileSync(fichier, squelette(d), "utf-8");
  return {
    ok: true,
    fichier,
    message: `Squelette écrit : ${fichier}`,
  };
}

function squelette(d: Diagnostic): string {
  const nom = d.dossier.split(/[\\/]/).filter(Boolean).pop() ?? "mon-systeme";
  const note = NOTES[d.famille];

  return `// Adaptateur d'évaluation pour « ${nom} ».
//
// Squelette généré le ${new Date().toISOString().slice(0, 10)}.
${d.indices.length > 0 ? `// Ce que le générateur a cru voir : ${d.indices.join(", ")}.\n//\n` : "//\n"}\
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE FICHIER EST LA PARTIE PERSONNALISÉE. C'est la réponse à « comment un banc générique peut-il
// évaluer MON système ? » : il ne le peut pas, et il ne le prétend pas. Les cas de test, la
// vérité terrain et la référence ne peuvent venir que de vous. Ce que le pack apporte, c'est
// tout ce qui vient APRÈS : comparaison à une référence, refus de conclure sans elle,
// intervalles, puissance, calibration, coût par réponse correcte.
//
// IL TOURNE DÉJÀ. Lancez-le tout de suite :
//
//     node /chemin/vers/pack/cli.ts run ${"${"}ce-fichier}
//
// Vous obtiendrez un REFUS — pas une erreur, un refus argumenté. C'est le comportement voulu
// tant que les données sont bidon. Remplacez ensuite les quatre TODO par les vôtres.
// ─────────────────────────────────────────────────────────────────────────────────────────────

${note}

interface Cas {
  id: string;
  // TODO 1 — ce que votre système reçoit en entrée. Mettez ici vos propres champs.
  entree: unknown;
}

const adaptateur = {
  name: "${nom}",

  /**
   * TODO 1 — VOS CAS DE TEST.
   *
   * Lisez vos données réelles : un export CSV, une table, un dossier de rapports passés.
   * Trente cas suffisent pour commencer ; en dessous, le pack vous dira qu'il ne peut pas
   * conclure, ce qui est déjà une information.
   *
   * Règle qui évite le faux succès le plus courant : ces cas doivent être des cas que votre
   * système N'A PAS vus pendant sa mise au point.
   */
  async loadItems(): Promise<Cas[]> {
    return Array.from({ length: 12 }, (_, i) => ({ id: \`bidon-\${i}\`, entree: i }));
  },

  /**
   * TODO 2 — CE QUE VOTRE SYSTÈME RÉPOND.
   *
   * Appelez ici votre vraie fonction. C'est le seul endroit qui touche à votre code :
   *
   *     import { calculerSignal } from "../src/lib/signaux.ts";
   *     return { label: await calculerSignal(cas.entree) };
   *
   * Si votre système renvoie une probabilité, renvoyez-la : { prob: 0.72 }. La calibration —
   * « quand il dit 70 %, a-t-il raison 70 % du temps ? » — ne se mesure pas autrement, et c'est
   * souvent là que se cachent les vrais défauts.
   */
  async predict(cas: Cas): Promise<{ label?: string; prob?: number }> {
    return { label: Number(cas.entree) % 2 === 0 ? "a" : "b" };
  },

  /**
   * TODO 3 — CE QUI ÉTAIT VRAI.
   *
   * La vérité terrain, et d'où elle vient. Si vous ne pouvez pas répondre à « qui a décidé que
   * c'était ça la bonne réponse, et quand ? », vous n'avez pas encore de vérité terrain.
   */
  truth(cas: Cas): { label?: string; prob?: number } {
    return { label: Number(cas.entree) % 3 === 0 ? "a" : "b" };
  },

  /**
   * TODO 4 — LA RÉFÉRENCE. C'EST LE PLUS IMPORTANT, ET C'EST CELUI QU'ON SAUTE.
   *
   * La méthode la plus bête qui fait le même travail. Sans elle, le pack REFUSE de dire si
   * votre système est compétent — et il a raison : 87 % de réussite ne veut rien dire tant
   * qu'on ne sait pas ce que « toujours répondre la classe majoritaire » aurait donné.
   *
   * Quelques références honnêtes selon les cas :
   *   · la classe la plus fréquente          · la valeur d'hier
   *   · une règle à deux lignes écrite à la main
   *   · la version précédente de votre système
   *
   * Supprimez cette méthode et relancez : vous verrez le refus. C'est la seule façon de
   * comprendre à quoi il sert.
   */
  baseline(cas: Cas): { label?: string; prob?: number } {
    return { label: "a" };
  },

  /** Facultatif : une tranche par cas, pour voir où ça casse (secteur, langue, taille…). */
  category(cas: Cas): string {
    return Number(cas.entree) < 6 ? "premiers" : "derniers";
  },
};

export default adaptateur;
`;
}

const NOTES: Record<Famille, string> = {
  prediction:
    "// Le générateur a vu un système de PRÉVISION. C'est la famille où le banc sert le plus,\n"
    + "// et celle où l'illusion est la plus forte : un système qui annonce « hausse » dans un\n"
    + "// marché qui monte a raison la plupart du temps sans rien savoir. La référence à battre\n"
    + "// n'est donc pas « le hasard », c'est « toujours répondre la tendance ». Renseignez aussi\n"
    + "// `prob` si votre système donne une probabilité : la calibration se mesure là.",
  classification:
    "// Le générateur a vu un système de CLASSIFICATION. La référence à battre est « toujours\n"
    + "// répondre la classe majoritaire » : sur un jeu déséquilibré, elle atteint souvent 80 %\n"
    + "// et beaucoup de systèmes ne font pas mieux.",
  recherche:
    "// Le générateur a vu un système de RECHERCHE. Renvoyez la liste ordonnée des documents\n"
    + "// dans `predict` et la bonne réponse dans `truth` : le pack calcule alors hit@k,\n"
    + "// rappel@k, MRR et NDCG@k. La référence à battre est la recherche par mots-clés.",
  agent:
    "// Le générateur a vu un AGENT enchaînant des étapes. Attention à l'ancrage : mesurez\n"
    + "// chaque étape séparément, sinon une première étape fausse maquille tout ce qui suit.",
  inconnu:
    "// Le générateur n'a pas reconnu la famille du système. Les TODO ci-dessous restent valables\n"
    + "// tels quels : ils ne dépendent pas du domaine.",
};
