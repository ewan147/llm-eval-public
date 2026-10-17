// L'épreuve d'échecs : mesurer un modèle sur des règles, pas sur des opinions.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CETTE ÉPREUVE MESURE, ET POURQUOI LES ÉCHECS SONT UN BON TERRAIN.
//
// Trois propriétés rares réunies :
//
//   1. **La bonne réponse est CALCULÉE, jamais écrite à la main.** L'ensemble des coups corrects
//      sort du moteur. Le défaut qui a frappé ce projet trois fois — une liste d'acceptation
//      rédigée en imaginant la réponse — est ici structurellement impossible : personne ne rédige
//      la liste.
//   2. **Le premier échec est binaire et sans appel.** Un coup illégal est illégal. Pas de
//      synonyme, pas de langue, pas de formulation. C'est la mesure la plus propre du projet.
//   3. **Deux modèles peuvent s'affronter**, et le résultat est un fait, pas un avis.
//
// CE QU'ELLE NE MESURE PAS, et il faut le dire aussi : la FORCE aux échecs. Sans moteur
// d'évaluation, on ne sait pas si un coup légal est bon. On mesure ici la légalité, la
// résolution de mats forcés, et l'issue de parties entre modèles — pas un Elo. Annoncer un Elo
// à partir de cinq parties entre deux modèles faibles serait exactement le genre de chiffre que
// ce projet existe pour refuser.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import {
  coupsLegaux,
  coupsMatants,
  depuisFen,
  depuisSan,
  DEPART,
  issue,
  jouer,
  versFen,
  versSan,
  type Coup,
  type Position,
} from "./echiquier.ts";

export type Epreuve = "legalite" | "mat1" | "mat2";

export interface CasEchecs {
  id: string;
  epreuve: Epreuve;
  fen: string;
  consigne: string;
}

/**
 * Les positions.
 *
 * Aucune solution n'est stockée : elle est recalculée à chaque exécution. Une position mal
 * transcrite ne produit donc pas une fausse correction — elle est rejetée par `auditerEchecs()`.
 */
export const CAS: CasEchecs[] = [
  // ── Légalité : produire UN coup légal. Le plancher absolu. ──
  { id: "ec-l1", epreuve: "legalite", fen: DEPART,
    consigne: "Donne un coup légal pour les blancs." },
  { id: "ec-l2", epreuve: "legalite",
    fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    consigne: "Donne un coup légal pour les blancs." },
  { id: "ec-l3", epreuve: "legalite",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    consigne: "Donne un coup légal pour les blancs." },
  // Roi en échec avec UNE seule parade (g3). Le cas le plus discriminant de l'épreuve : il exige
  // de voir l'échec, puis de trouver la seule réponse.
  //
  // La première version de ce cas utilisait le mat du sot — position où les blancs n'ont AUCUN
  // coup légal. `auditerEchecs()` l'a refusée avant qu'un seul appel de modèle soit dépensé.
  // C'est précisément pour ce genre d'erreur que l'audit existe : la position était plausible,
  // et chaque réponse aurait été comptée illégale quoi que réponde le modèle.
  { id: "ec-l4", epreuve: "legalite",
    fen: "rnb1kbnr/pppp1ppp/8/4p3/7q/2N2P2/PPPPP1PP/R1BQKBNR w KQkq - 2 3",
    consigne: "Les blancs sont en échec. Donne un coup légal." },
  { id: "ec-l5", epreuve: "legalite",
    fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    consigne: "Donne un coup légal pour les blancs." },

  // ── Mat en 1 ──
  { id: "ec-m1", epreuve: "mat1", fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    consigne: "Les blancs matent en un coup. Donne ce coup." },
  { id: "ec-m2", epreuve: "mat1", fen: "k7/8/1K6/8/8/8/8/7R w - - 0 1",
    consigne: "Les blancs matent en un coup. Donne ce coup." },
  { id: "ec-m3", epreuve: "mat1", fen: "2k5/8/2K5/8/8/8/8/6Q1 w - - 0 1",
    consigne: "Les blancs matent en un coup. Donne ce coup." },
  { id: "ec-m4", epreuve: "mat1", fen: "6k1/4Rppp/8/8/8/8/5PPP/6K1 w - - 0 1",
    consigne: "Les blancs matent en un coup. Donne ce coup." },
  { id: "ec-m5", epreuve: "mat1", fen: "1k6/1P6/1K6/8/8/8/8/7R w - - 0 1",
    consigne: "Les blancs matent en un coup. Donne ce coup." },

  // ── Mat en 2 : plusieurs premiers coups peuvent forcer le mat. Tous sont acceptés — c'est le
  //    moteur qui décide, et exiger « la » solution mesurerait l'accord avec mon goût. ──
  { id: "ec-n1", epreuve: "mat2", fen: "2k5/8/1K6/8/8/8/8/7R w - - 0 1",
    consigne: "Les blancs matent en deux coups au plus. Donne le premier coup." },
  { id: "ec-n2", epreuve: "mat2", fen: "k7/8/2K5/8/8/8/8/7R w - - 0 1",
    consigne: "Les blancs matent en deux coups au plus. Donne le premier coup." },
  { id: "ec-n3", epreuve: "mat2", fen: "6k1/8/6K1/8/8/8/8/7R w - - 0 1",
    consigne: "Les blancs matent en deux coups au plus. Donne le premier coup." },
];

export interface DefautEchecs {
  casId: string;
  probleme: string;
}

/**
 * Vérifie que chaque position tient ce qu'elle annonce, AVANT de dépenser un appel de modèle.
 *
 * Même rôle que `auditSuite()` pour la suite textuelle : un problème « mat en 2 » qui n'en est pas
 * un transforme une bonne réponse en erreur, et personne ne s'en aperçoit.
 */
export function auditerEchecs(cas: CasEchecs[] = CAS): DefautEchecs[] {
  const defauts: DefautEchecs[] = [];
  const vus = new Set<string>();

  for (const c of cas) {
    if (vus.has(c.id)) defauts.push({ casId: c.id, probleme: "Identifiant en double." });
    vus.add(c.id);

    let p: Position;
    try {
      p = depuisFen(c.fen);
    } catch {
      defauts.push({ casId: c.id, probleme: `FEN illisible : ${c.fen}` });
      continue;
    }

    const legaux = coupsLegaux(p);
    if (legaux.length === 0) {
      defauts.push({ casId: c.id, probleme: "Position déjà terminée : aucun coup légal." });
      continue;
    }

    if (c.epreuve === "mat1" && coupsMatants(p, 1).length === 0) {
      defauts.push({ casId: c.id, probleme: "Annoncé mat en 1, mais aucun mat en 1 n'existe." });
    }
    if (c.epreuve === "mat2") {
      if (coupsMatants(p, 1).length > 0) {
        defauts.push({ casId: c.id, probleme: "Annoncé mat en 2, mais un mat en 1 existe." });
      } else if (coupsMatants(p, 2).length === 0) {
        defauts.push({ casId: c.id, probleme: "Annoncé mat en 2, mais aucun mat en 2 n'existe." });
      }
    }
  }
  return defauts;
}

// ── Jugement d'une réponse ────────────────────────────────────────────────────────────────────

export type VerdictEchecs = "juste" | "faux" | "illegal" | "illisible" | "panne";

export interface ResultatEchecs {
  casId: string;
  epreuve: Epreuve;
  fen: string;
  reponse: string;
  /** Le coup compris, en notation normalisée. `null` si rien n'a été compris. */
  coupLu: string | null;
  verdict: VerdictEchecs;
  pourquoi: string;
  /** Combien de coups auraient été acceptés. Donne la difficulté réelle du cas. */
  acceptes: number;
}

/**
 * Longueur de réponse conservée dans le fichier d'exécution.
 *
 * POURQUOI ELLE EST GÉNÉREUSE. Une réponse tronquée à 300 caractères ne permet plus de vérifier
 * APRÈS COUP comment le juge a extrait un coup : la fin du texte, là où les modèles placent leur
 * conclusion, a disparu. Or c'est exactement cette vérification qui a révélé les six faux accepts
 * de ce banc. Une preuve trop courte rend le verdict irréprochable faute de pouvoir le contester,
 * ce qui est le contraire du but.
 *
 * Le coût est quelques dizaines de kilo-octets par exécution. La reproductibilité d'un verdict
 * sans relancer le modèle les vaut largement.
 */
const LONGUEUR_PREUVE = 4000;

function tronquer(t: string): string {
  return t.length <= LONGUEUR_PREUVE
    ? t
    : `${t.slice(0, LONGUEUR_PREUVE)}… [réponse tronquée à ${LONGUEUR_PREUVE} caractères]`;
}

/**
 * Juge une réponse.
 *
 * `illegal` et `illisible` sont distingués de `faux`, et ce n'est pas de la coquetterie :
 *   · `illisible` — le modèle a répondu autre chose qu'un coup. Défaut de suivi de consigne.
 *   · `illegal`   — il a proposé un coup qui n'existe pas. Il ne connaît pas les règles.
 *   · `faux`      — coup légal mais qui ne mate pas. Il connaît les règles, il joue mal.
 * Les confondre ferait passer un modèle qui ignore les règles pour un modèle qui joue mal.
 */
export function jugerEchecs(cas: CasEchecs, reponse: string, panne?: string): ResultatEchecs {
  const p = depuisFen(cas.fen);
  const acceptables = cas.epreuve === "legalite"
    ? coupsLegaux(p)
    : coupsMatants(p, cas.epreuve === "mat1" ? 1 : 2);

  const base = {
    casId: cas.id,
    epreuve: cas.epreuve,
    fen: cas.fen,
    reponse: tronquer(reponse ?? ""),
    acceptes: acceptables.length,
  };

  if (panne) {
    return { ...base, coupLu: null, verdict: "panne", pourquoi: `Panne : ${panne}` };
  }

  const coup = extraireCoup(p, reponse ?? "");
  if (coup === null) {
    return {
      ...base,
      coupLu: null,
      verdict: estCoupIllegalEcrit(reponse ?? "") ? "illegal" : "illisible",
      pourquoi: estCoupIllegalEcrit(reponse ?? "")
        ? "Un coup a été écrit, mais il n'est pas légal dans cette position."
        : "Aucun coup identifiable dans la réponse.",
    };
  }

  const san = versSan(p, coup);
  const accepte = acceptables.some((a) =>
    a.de === coup.de && a.vers === coup.vers && a.promotion === coup.promotion);

  return {
    ...base,
    coupLu: san,
    verdict: accepte ? "juste" : "faux",
    pourquoi: accepte
      ? `${san} fait partie des ${acceptables.length} coup(s) corrects.`
      : `${san} est légal mais ne répond pas à la consigne (${acceptables.length} coup(s) le feraient).`,
  };
}

/**
 * Extrait le coup que le modèle PROPOSE.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * CINQUIÈME INSTANCE DU MÊME DÉFAUT, et la pire, parce qu'elle gonflait les scores.
 *
 * La première version balayait tous les mots de la réponse et retenait le PREMIER qui formait un
 * coup légal. Sur une exécution réelle, un modèle a écrit une page d'analyse se terminant par
 * « déplacer le roi de a5 en a4 » ; le balayage a trouvé « e3 » au détour d'une phrase sur les
 * pions noirs, et l'a crédité d'un coup qu'il n'avait jamais proposé.
 *
 * C'est le faux ACCEPT : il ne se voit pas en relisant les réponses fausses, puisqu'il en
 * fabrique des justes. Une prose assez longue finit toujours par contenir deux caractères qui
 * ressemblent à une case.
 *
 * La règle est donc : on ne cherche un coup QUE là où un modèle place sa réponse — la réponse
 * entière si elle est brève, sa dernière ligne, sa première ligne, ce qu'il a mis en gras, ou ce
 * qui suit un marqueur de réponse explicite. Nulle part ailleurs. Un modèle qui noie son coup
 * dans un paragraphe n'a pas suivi la consigne, et c'est cela qu'il faut mesurer.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
function extraireCoup(p: Position, texte: string): Coup | null {
  for (const candidat of emplacementsDeReponse(texte)) {
    const direct = depuisSan(p, candidat);
    if (direct !== null) return direct;
    // Un emplacement court peut contenir deux ou trois mots (« Je joue Nf3 »). Au-delà, on
    // n'insiste pas : ce n'est plus une réponse, c'est un texte.
    if (candidat.length <= LONGUEUR_ENGAGEMENT) {
      for (const mot of decouper(candidat)) {
        const c = depuisSan(p, mot);
        if (c !== null) return c;
      }
    }
  }
  return null;
}

/**
 * Les endroits où un modèle place sa réponse, par ordre de priorité.
 *
 * La dernière ligne passe avant la première : un modèle qui raisonne conclut à la fin.
 */
/** Au-dela de cette longueur, un texte n'est plus une reponse : c'est un expose. */
const LONGUEUR_ENGAGEMENT = 40;

function emplacementsDeReponse(texte: string): string[] {
  const t = (texte ?? "").trim();
  if (t.length === 0) return [];

  const out: string[] = [];

  // 1. La reponse entiere, si elle est BREVE : un coup, pas un expose.
  if (t.length <= LONGUEUR_ENGAGEMENT) out.push(t);

  // 2. La derniere ligne, si elle est breve : un modele qui raisonne conclut a la fin.
  const lignes = t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const derniere = lignes[lignes.length - 1];
  if (derniere !== undefined && derniere.length <= LONGUEUR_ENGAGEMENT) out.push(derniere);

  // 3. Ce qui suit un marqueur explicite : la, le modele DESIGNE sa reponse.
  const marqueur =
    /(?:r[ee]ponse|answer|mon coup|le coup est|je joue|i play|my move is)[^a-z0-9]{0,4}(.{1,20})/i
      .exec(t);
  if (marqueur) out.push(marqueur[1].trim());

  // 4. Le gras, MAIS SEULEMENT SI UNIQUE.
  //
  //    Un texte qui met cinq choses en gras ENUMERE, il ne repond pas. Interroge sur un coup
  //    legal, qwen3:4b a ecrit « les coups legaux incluent : **e4** : le pion e2 peut avancer
  //    de deux cases... » ; retenir « e4 » revenait a choisir a sa place dans une liste
  //    d'exemples. Un seul passage en gras, en revanche, est bien une designation.
  const gras = [...t.matchAll(/\*\*(.{1,20}?)\*\*/g)].map((g) => g[1].trim());
  if (gras.length === 1) out.push(gras[0]);

  return out;
}

/**
 * Le modèle a-t-il ÉCRIT un coup, à un endroit de réponse, sans qu'il soit légal ?
 *
 * Sert uniquement à distinguer « il ne connaît pas les règles » de « il n'a pas répondu un
 * coup ». Confondre les deux ferait passer un modèle bavard pour un modèle qui ignore les règles.
 */
function estCoupIllegalEcrit(texte: string): boolean {
  for (const candidat of emplacementsDeReponse(texte)) {
    if (candidat.length > LONGUEUR_ENGAGEMENT) continue;
    for (const mot of decouper(candidat)) {
      if (/^([KQRBN])?([a-h])?([1-8])?x?[a-h][1-8](=?[QRBN])?[+#]?$/.test(mot)
        || /^[KQRBN]?[a-h][1-8][-x]?[a-h][1-8][qrbn]?$/i.test(mot)
        || /^[0O]-?[0O](-?[0O])?$/i.test(mot)) return true;
    }
  }
  return false;
}

function decouper(texte: string): string[] {
  return texte
    .replace(/[*_`"'(),.;:\n\r]/g, " ")
    .split(/\s+/)
    .filter((m) => m.length > 0 && m.length <= 8);
}

// ── Partie entre deux modèles ─────────────────────────────────────────────────────────────────

export type Resultat = "1-0" | "0-1" | "1/2-1/2";

export interface Partie {
  blancs: string;
  noirs: string;
  resultat: Resultat;
  /** Pourquoi la partie s'est arrêtée. Un fait, pas un commentaire. */
  cause: string;
  coups: string[];
  fenFinale: string;
  /** Coups illégaux proposés, par camp. La statistique la plus parlante entre petits modèles. */
  illegaux: { blancs: number; noirs: number };
  demiCoupsJoues: number;
}

export interface OptionsPartie {
  /** Nombre maximal de demi-coups avant nulle d'arrêt. */
  maxDemiCoups?: number;
  /** Tentatives accordées après un coup illégal, avant de perdre la partie. */
  essais?: number;
}

/**
 * Fait jouer deux modèles l'un contre l'autre.
 *
 * LE COUP ILLÉGAL EST UNE DÉFAITE, après quelques tentatives. C'est un choix, et il doit être
 * explicite : jouer un coup légal à sa place « pour que la partie continue » mesurerait le
 * remplaçant. Compter chaque illégalité et poursuivre donnerait des parties qu'aucun des deux
 * modèles n'a réellement jouées. La règle retenue est celle d'une compétition : on a le droit de
 * se reprendre, pas de jouer l'impossible indéfiniment.
 */
export async function jouerPartie(
  blancs: { nom: string; demander: (prompt: string) => Promise<{ text: string; failure?: string }> },
  noirs: { nom: string; demander: (prompt: string) => Promise<{ text: string; failure?: string }> },
  options: OptionsPartie = {},
): Promise<Partie> {
  const maxDemiCoups = options.maxDemiCoups ?? 120;
  const essais = options.essais ?? 3;

  let p = depuisFen(DEPART);
  const coups: string[] = [];
  const illegaux = { blancs: 0, noirs: 0 };

  const fin = (resultat: Resultat, cause: string): Partie => ({
    blancs: blancs.nom, noirs: noirs.nom, resultat, cause, coups,
    fenFinale: versFen(p), illegaux, demiCoupsJoues: coups.length,
  });

  while (coups.length < maxDemiCoups) {
    const etat = issue(p);
    if (etat === "mat") {
      return fin(p.trait === "b" ? "0-1" : "1-0", `Échec et mat en ${coups.length} demi-coups.`);
    }
    if (etat !== "en cours") return fin("1/2-1/2", `Partie nulle : ${etat}.`);

    const auTrait = p.trait === "b" ? blancs : noirs;
    const camp = p.trait === "b" ? "blancs" : "noirs";
    let joue: Coup | null = null;
    let derniereReponse = "";

    for (let essai = 0; essai < essais && joue === null; essai++) {
      const r = await auTrait.demander(promptPartie(p, coups, essai > 0, derniereReponse));
      if (r.failure) {
        return fin(camp === "blancs" ? "0-1" : "1-0", `Panne du modèle ${auTrait.nom} : ${r.failure}`);
      }
      derniereReponse = r.text ?? "";
      joue = extraireCoup(p, derniereReponse);
      if (joue === null) illegaux[camp]++;
    }

    if (joue === null) {
      return fin(
        camp === "blancs" ? "0-1" : "1-0",
        `${auTrait.nom} (${camp}) n'a pas produit de coup légal en ${essais} tentatives. `
        + `Dernière réponse : « ${derniereReponse.slice(0, 80).replace(/\s+/g, " ").trim()} »`,
      );
    }

    coups.push(versSan(p, joue));
    p = jouer(p, joue);
  }

  return fin("1/2-1/2", `Limite de ${maxDemiCoups} demi-coups atteinte, partie non terminée.`);
}

function promptPartie(p: Position, coups: string[], reprise: boolean, refusee: string): string {
  const camp = p.trait === "b" ? "blancs" : "noirs";
  const histoire = coups.length > 0 ? `Coups joués : ${coups.join(" ")}.` : "Début de partie.";
  const rappel = reprise
    ? `\nTa réponse précédente « ${refusee.slice(0, 40).replace(/\s+/g, " ").trim()} » n'était pas `
      + "un coup légal. Donne un coup légal."
    : "";
  return (
    `Partie d'échecs. Position FEN : ${versFen(p)}\n${histoire}\n`
    + `Tu joues les ${camp}. Réponds UNIQUEMENT par ton coup en notation algébrique `
    + `(exemples : e4, Nf3, O-O, exd5, e8=Q). Aucun commentaire.${rappel}`
  );
}

// ── Résumé ────────────────────────────────────────────────────────────────────────────────────

export interface ResumeEchecs {
  n: number;
  juste: number;
  faux: number;
  illegal: number;
  illisible: number;
  panne: number;
  /** Part de coups légaux parmi les réponses mesurables. Le socle : sans lui, rien d'autre ne vaut. */
  tauxLegalite: number | null;
  /** Réponses entièrement vides. À distinguer d'une prose sans coup : ce n'est pas le même défaut. */
  vide: number;
  /**
   * Longueur MÉDIANE des réponses, en caractères.
   *
   * POURQUOI CE CHIFFRE EST DANS LE RÉSUMÉ. La consigne dit « réponds UNIQUEMENT par le coup ».
   * Sur une mesure réelle, gemma3:4b répond en 5 caractères et qwen3:4b en 1539 : le second ne
   * suit jamais la consigne. Sans cette colonne, on lit « 7,7 % de légalité » et on conclut qu'un
   * modèle ignore les règles, alors qu'on mesure d'abord son incapacité à répondre brièvement.
   * Une médiane plutôt qu'une moyenne : une seule réponse fleuve ne doit pas décider.
   */
  longueurMediane: number;
  parEpreuve: Array<{ epreuve: Epreuve; n: number; juste: number }>;
}

export function resumerEchecs(resultats: ResultatEchecs[]): ResumeEchecs {
  const compte = (v: VerdictEchecs) => resultats.filter((r) => r.verdict === v).length;
  const mesurables = resultats.filter((r) => r.verdict !== "panne");
  const legaux = mesurables.filter((r) => r.verdict === "juste" || r.verdict === "faux").length;

  const longueurs = resultats.map((r) => r.reponse.length).sort((a, b) => a - b);
  const epreuves: Epreuve[] = ["legalite", "mat1", "mat2"];
  return {
    n: resultats.length,
    juste: compte("juste"),
    faux: compte("faux"),
    illegal: compte("illegal"),
    illisible: compte("illisible"),
    panne: compte("panne"),
    tauxLegalite: mesurables.length === 0 ? null : legaux / mesurables.length,
    vide: resultats.filter((r) => r.reponse.trim().length === 0 && r.verdict !== "panne").length,
    longueurMediane: longueurs.length === 0 ? 0 : longueurs[Math.floor(longueurs.length / 2)],
    parEpreuve: epreuves.map((e) => {
      const dedans = resultats.filter((r) => r.epreuve === e);
      return { epreuve: e, n: dedans.length, juste: dedans.filter((r) => r.verdict === "juste").length };
    }).filter((x) => x.n > 0),
  };
}
