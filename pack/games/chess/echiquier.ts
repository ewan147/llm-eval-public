// Moteur de règles d'échecs — représentation 0x88, sans dépendance.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI ÉCRIRE UN MOTEUR PLUTÔT QUE DE JUGER « À L'ŒIL ».
//
// Tout le projet repose sur une règle : la vérification doit être objective. Pour les échecs,
// cela veut dire qu'on ne peut pas demander à un modèle « ce coup est-il bon ? » ni chercher une
// chaîne de caractères dans sa réponse. Il faut connaître les règles.
//
// Un banc d'échecs dont le moteur est faux mesure les bogues du moteur. C'est exactement le
// défaut corrigé deux fois dans ce projet (juge v1, juge v3), et il serait ici invisible :
// personne ne relit à la main mille positions.
//
// D'où la vérification par PERFT : compter les feuilles de l'arbre de coups légaux à une
// profondeur donnée. Les valeurs de référence sont publiques et connues au nœud près depuis des
// décennies. Si `perft(position de départ, 5) = 4 865 609`, la génération de coups est juste —
// y compris le roque, la prise en passant, la promotion et le clouage. C'est la seule façon
// honnête d'affirmer que l'instrument de mesure fonctionne.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type Couleur = "b" | "n";

/** Position complète. Les cases sont indexées en 0x88 : `case = rangée * 16 + colonne`. */
export interface Position {
  cases: (string | null)[];
  trait: Couleur;
  /** Droits de roque restants, sous la forme « KQkq ». */
  roque: string;
  /** Case de prise en passant, en index 0x88, ou `null`. */
  enPassant: number | null;
  demiCoups: number;
  coupNumero: number;
}

export interface Coup {
  de: number;
  vers: number;
  /** Pièce promue, en minuscule (`q`, `r`, `b`, `n`). */
  promotion?: string;
  capture: boolean;
  enPassant: boolean;
  /** `"K"` petit roque, `"Q"` grand roque. */
  roque: "K" | "Q" | null;
}

// ── Géométrie 0x88 ────────────────────────────────────────────────────────────────────────────
//
// a1 = 0, h1 = 7, a8 = 112, h8 = 119. Une case est sur l'échiquier si `(i & 0x88) === 0` — c'est
// tout l'intérêt de cette représentation : la sortie de plateau se teste par un ET binaire.

const HORS = (i: number) => (i & 0x88) !== 0;
const COLONNE = (i: number) => i & 7;
const RANGEE = (i: number) => i >> 4;

const CAVALIER = [33, 31, 18, 14, -33, -31, -18, -14];
const FOU = [17, 15, -17, -15];
const TOUR = [16, -16, 1, -1];
const ROI = [...FOU, ...TOUR];

const BLANC = (p: string) => p === p.toUpperCase();
const COULEUR_DE = (p: string): Couleur => (BLANC(p) ? "b" : "n");

export function nomCase(i: number): string {
  return `${"abcdefgh"[COLONNE(i)]}${RANGEE(i) + 1}`;
}

export function indexCase(nom: string): number {
  const c = "abcdefgh".indexOf(nom[0]);
  const r = Number(nom[1]) - 1;
  if (c < 0 || r < 0 || r > 7) return -1;
  return r * 16 + c;
}

// ── FEN ───────────────────────────────────────────────────────────────────────────────────────

export const DEPART = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function depuisFen(fen: string): Position {
  const [plateau, trait, roque, ep, demi, numero] = fen.trim().split(/\s+/);
  const cases: (string | null)[] = new Array(128).fill(null);

  let rangee = 7;
  let colonne = 0;
  for (const c of plateau) {
    if (c === "/") {
      rangee--;
      colonne = 0;
    } else if (/\d/.test(c)) {
      colonne += Number(c);
    } else {
      cases[rangee * 16 + colonne] = c;
      colonne++;
    }
  }

  return {
    cases,
    trait: trait === "w" ? "b" : "n",
    roque: roque === "-" ? "" : roque,
    enPassant: ep && ep !== "-" ? indexCase(ep) : null,
    demiCoups: Number(demi ?? 0),
    coupNumero: Number(numero ?? 1),
  };
}

export function versFen(p: Position): string {
  let plateau = "";
  for (let rangee = 7; rangee >= 0; rangee--) {
    let vide = 0;
    for (let colonne = 0; colonne < 8; colonne++) {
      const piece = p.cases[rangee * 16 + colonne];
      if (piece === null) {
        vide++;
      } else {
        if (vide > 0) {
          plateau += String(vide);
          vide = 0;
        }
        plateau += piece;
      }
    }
    if (vide > 0) plateau += String(vide);
    if (rangee > 0) plateau += "/";
  }
  const ep = p.enPassant === null ? "-" : nomCase(p.enPassant);
  return `${plateau} ${p.trait === "b" ? "w" : "b"} ${p.roque || "-"} ${ep} ${p.demiCoups} ${p.coupNumero}`;
}

// ── Attaques ──────────────────────────────────────────────────────────────────────────────────

/** La case `cible` est-elle attaquée par un camp ? Sert au check, au mat et à la légalité du roque. */
export function estAttaquee(p: Position, cible: number, par: Couleur): boolean {
  for (let i = 0; i < 128; i++) {
    if (HORS(i)) { i += 7; continue; }
    const piece = p.cases[i];
    if (piece === null || COULEUR_DE(piece) !== par) continue;
    const type = piece.toLowerCase();

    if (type === "p") {
      // Un pion attaque en diagonale avant, jamais devant lui.
      const sens = par === "b" ? 16 : -16;
      if (i + sens + 1 === cible && COLONNE(i) < 7) return true;
      if (i + sens - 1 === cible && COLONNE(i) > 0) return true;
      continue;
    }

    if (type === "n") {
      if (CAVALIER.some((d) => i + d === cible)) return true;
      continue;
    }

    if (type === "k") {
      if (ROI.some((d) => i + d === cible)) return true;
      continue;
    }

    const directions = type === "b" ? FOU : type === "r" ? TOUR : ROI;
    for (const d of directions) {
      let j = i + d;
      while (!HORS(j)) {
        if (j === cible) return true;
        if (p.cases[j] !== null) break;
        j += d;
      }
    }
  }
  return false;
}

function caseDuRoi(p: Position, couleur: Couleur): number {
  const roi = couleur === "b" ? "K" : "k";
  for (let i = 0; i < 128; i++) {
    if (HORS(i)) { i += 7; continue; }
    if (p.cases[i] === roi) return i;
  }
  return -1;
}

export function enEchec(p: Position, couleur: Couleur = p.trait): boolean {
  const roi = caseDuRoi(p, couleur);
  if (roi < 0) return false;
  return estAttaquee(p, roi, couleur === "b" ? "n" : "b");
}

// ── Génération des coups ──────────────────────────────────────────────────────────────────────

const PROMOTIONS = ["q", "r", "b", "n"];

function ajouterPion(liste: Coup[], p: Position, de: number, vers: number, capture: boolean,
                     enPassant = false): void {
  const derniere = p.trait === "b" ? 7 : 0;
  if (RANGEE(vers) === derniere) {
    for (const promotion of PROMOTIONS) {
      liste.push({ de, vers, promotion, capture, enPassant: false, roque: null });
    }
  } else {
    liste.push({ de, vers, capture, enPassant, roque: null });
  }
}

/** Coups pseudo-légaux : les règles de déplacement, sans vérifier que le roi reste en sécurité. */
export function coupsPseudoLegaux(p: Position): Coup[] {
  const coups: Coup[] = [];
  const moi = p.trait;
  const adverse = moi === "b" ? "n" : "b";

  for (let i = 0; i < 128; i++) {
    if (HORS(i)) { i += 7; continue; }
    const piece = p.cases[i];
    if (piece === null || COULEUR_DE(piece) !== moi) continue;
    const type = piece.toLowerCase();

    if (type === "p") {
      const sens = moi === "b" ? 16 : -16;
      const depart = moi === "b" ? 1 : 6;

      const devant = i + sens;
      if (!HORS(devant) && p.cases[devant] === null) {
        ajouterPion(coups, p, i, devant, false);
        const double = i + sens * 2;
        if (RANGEE(i) === depart && p.cases[double] === null) {
          coups.push({ de: i, vers: double, capture: false, enPassant: false, roque: null });
        }
      }

      for (const biais of [sens + 1, sens - 1]) {
        const vers = i + biais;
        if (HORS(vers)) continue;
        // La colonne doit changer d'exactement un cran : sans ce contrôle, un pion en colonne h
        // « capturerait » en colonne a de la rangée suivante.
        if (Math.abs(COLONNE(vers) - COLONNE(i)) !== 1) continue;
        const occupant = p.cases[vers];
        if (occupant !== null && COULEUR_DE(occupant) === adverse) {
          ajouterPion(coups, p, i, vers, true);
        } else if (occupant === null && vers === p.enPassant) {
          ajouterPion(coups, p, i, vers, true, true);
        }
      }
      continue;
    }

    if (type === "n" || type === "k") {
      for (const d of type === "n" ? CAVALIER : ROI) {
        const vers = i + d;
        if (HORS(vers)) continue;
        const occupant = p.cases[vers];
        if (occupant !== null && COULEUR_DE(occupant) === moi) continue;
        coups.push({ de: i, vers, capture: occupant !== null, enPassant: false, roque: null });
      }
      continue;
    }

    const directions = type === "b" ? FOU : type === "r" ? TOUR : ROI;
    for (const d of directions) {
      let vers = i + d;
      while (!HORS(vers)) {
        const occupant = p.cases[vers];
        if (occupant === null) {
          coups.push({ de: i, vers, capture: false, enPassant: false, roque: null });
        } else {
          if (COULEUR_DE(occupant) !== moi) {
            coups.push({ de: i, vers, capture: true, enPassant: false, roque: null });
          }
          break;
        }
        vers += d;
      }
    }
  }

  // ── Roque ──
  // Trois conditions, et les trois sont des sources classiques de bogue : le droit doit exister,
  // les cases intermédiaires doivent être vides, et le roi ne doit traverser AUCUNE case attaquée
  // — départ, passage et arrivée.
  const base = moi === "b" ? 0 : 112;
  const roiCase = base + 4;
  if (p.cases[roiCase] === (moi === "b" ? "K" : "k")) {
    const petit = moi === "b" ? "K" : "k";
    const grand = moi === "b" ? "Q" : "q";

    if (p.roque.includes(petit)
      && p.cases[base + 5] === null && p.cases[base + 6] === null
      && !estAttaquee(p, roiCase, adverse)
      && !estAttaquee(p, base + 5, adverse)
      && !estAttaquee(p, base + 6, adverse)) {
      coups.push({ de: roiCase, vers: base + 6, capture: false, enPassant: false, roque: "K" });
    }

    if (p.roque.includes(grand)
      && p.cases[base + 1] === null && p.cases[base + 2] === null && p.cases[base + 3] === null
      && !estAttaquee(p, roiCase, adverse)
      && !estAttaquee(p, base + 3, adverse)
      && !estAttaquee(p, base + 2, adverse)) {
      coups.push({ de: roiCase, vers: base + 2, capture: false, enPassant: false, roque: "Q" });
    }
  }

  return coups;
}

/** Coups LÉGAUX : ceux qui ne laissent pas son propre roi en prise. */
export function coupsLegaux(p: Position): Coup[] {
  const moi = p.trait;
  return coupsPseudoLegaux(p).filter((c) => !enEchec(jouer(p, c), moi));
}

// ── Application d'un coup ─────────────────────────────────────────────────────────────────────

/** Applique un coup et renvoie une NOUVELLE position. Rien n'est modifié en place. */
export function jouer(p: Position, c: Coup): Position {
  const cases = p.cases.slice();
  const piece = cases[c.de];
  if (piece === null) return { ...p, cases };
  const type = piece.toLowerCase();
  const moi = COULEUR_DE(piece);

  cases[c.de] = null;
  cases[c.vers] = c.promotion
    ? (moi === "b" ? c.promotion.toUpperCase() : c.promotion)
    : piece;

  // Prise en passant : le pion capturé n'est PAS sur la case d'arrivée.
  if (c.enPassant) {
    cases[c.vers + (moi === "b" ? -16 : 16)] = null;
  }

  // Roque : la tour saute par-dessus le roi.
  if (c.roque === "K") {
    const base = moi === "b" ? 0 : 112;
    cases[base + 5] = cases[base + 7];
    cases[base + 7] = null;
  } else if (c.roque === "Q") {
    const base = moi === "b" ? 0 : 112;
    cases[base + 3] = cases[base + 0];
    cases[base + 0] = null;
  }

  // Droits de roque : perdus si le roi bouge, ou si une tour quitte son coin — ou s'y fait
  // prendre. Oublier le dernier cas est le bogue de roque le plus courant.
  let roque = p.roque;
  if (type === "k") {
    roque = roque.replace(moi === "b" ? /[KQ]/g : /[kq]/g, "");
  }
  for (const [coin, droit] of [[0, "Q"], [7, "K"], [112, "q"], [119, "k"]] as const) {
    if (c.de === coin || c.vers === coin) roque = roque.replace(droit, "");
  }

  // Case de prise en passant : seulement après une avance double de pion.
  let enPassant: number | null = null;
  if (type === "p" && Math.abs(RANGEE(c.vers) - RANGEE(c.de)) === 2) {
    enPassant = (c.de + c.vers) / 2;
  }

  return {
    cases,
    trait: moi === "b" ? "n" : "b",
    roque,
    enPassant,
    demiCoups: type === "p" || c.capture ? 0 : p.demiCoups + 1,
    coupNumero: moi === "n" ? p.coupNumero + 1 : p.coupNumero,
  };
}

// ── État de la partie ─────────────────────────────────────────────────────────────────────────

export type Issue = "en cours" | "mat" | "pat" | "nulle 50 coups" | "nulle matériel";

export function issue(p: Position): Issue {
  if (coupsLegaux(p).length === 0) return enEchec(p) ? "mat" : "pat";
  if (p.demiCoups >= 100) return "nulle 50 coups";

  // Matériel insuffisant : roi seul, ou roi + fou, ou roi + cavalier.
  const restantes: string[] = [];
  for (let i = 0; i < 128; i++) {
    if (HORS(i)) { i += 7; continue; }
    const piece = p.cases[i];
    if (piece !== null && piece.toLowerCase() !== "k") restantes.push(piece.toLowerCase());
  }
  if (restantes.length === 0) return "nulle matériel";
  if (restantes.length === 1 && (restantes[0] === "b" || restantes[0] === "n")) {
    return "nulle matériel";
  }

  return "en cours";
}

// ── Notation algébrique (SAN) ─────────────────────────────────────────────────────────────────

/**
 * Écrit un coup en notation algébrique abrégée — celle que les modèles produisent.
 *
 * La désambiguïsation est calculée sur les coups LÉGAUX, pas pseudo-légaux : deux cavaliers qui
 * peuvent atteindre la même case n'ont besoin d'être distingués que si les deux coups sont
 * réellement jouables. Utiliser les pseudo-légaux ajoute des précisions inutiles, et fait diverger
 * la notation de celle de n'importe quelle base de parties.
 */
export function versSan(p: Position, c: Coup): string {
  const piece = p.cases[c.de];
  if (piece === null) return "";
  const type = piece.toLowerCase();

  let san: string;
  if (c.roque === "K") {
    san = "O-O";
  } else if (c.roque === "Q") {
    san = "O-O-O";
  } else if (type === "p") {
    san = c.capture ? `${"abcdefgh"[COLONNE(c.de)]}x${nomCase(c.vers)}` : nomCase(c.vers);
    if (c.promotion) san += `=${c.promotion.toUpperCase()}`;
  } else {
    const rivaux = coupsLegaux(p).filter((autre) =>
      autre.vers === c.vers
      && autre.de !== c.de
      && p.cases[autre.de]?.toLowerCase() === type);

    let precision = "";
    if (rivaux.length > 0) {
      const memeColonne = rivaux.some((r) => COLONNE(r.de) === COLONNE(c.de));
      const memeRangee = rivaux.some((r) => RANGEE(r.de) === RANGEE(c.de));
      if (!memeColonne) precision = "abcdefgh"[COLONNE(c.de)];
      else if (!memeRangee) precision = String(RANGEE(c.de) + 1);
      else precision = nomCase(c.de);
    }
    san = `${type.toUpperCase()}${precision}${c.capture ? "x" : ""}${nomCase(c.vers)}`;
  }

  const apres = jouer(p, c);
  const fin = issue(apres);
  if (fin === "mat") san += "#";
  else if (enEchec(apres)) san += "+";
  return san;
}

/**
 * Lit un coup écrit par un modèle, et renvoie `null` s'il n'est pas légal.
 *
 * TOLÉRANT SUR LA FORME, STRICT SUR LA LÉGALITÉ. Un modèle écrit « Nf3 », « Ng1-f3 », « g1f3 »,
 * « 1. Nf3 », parfois avec des espaces ou du gras. Rien de tout cela ne dit quoi que ce soit de
 * sa force aux échecs : refuser « Ng1f3 » mesurerait la mise en forme. En revanche un coup
 * illégal reste illégal, quelle que soit l'élégance de son écriture.
 */
export function depuisSan(p: Position, texte: string): Coup | null {
  const legaux = coupsLegaux(p);

  let t = texte.trim()
    .replace(/[*_`"']/g, "")
    .replace(/^\d+\s*\.+\s*/, "")
    .replace(/\s*[!?]+\s*$/, "")
    .replace(/[+#]\s*$/, "")
    .replace(/\s+/g, "");

  if (t.length === 0) return null;

  // Roque, toutes graphies : O-O, 0-0, o-o.
  const roque = t.replace(/0/g, "O").toUpperCase();
  if (roque === "O-O" || roque === "OO") return legaux.find((c) => c.roque === "K") ?? null;
  if (roque === "O-O-O" || roque === "OOO") return legaux.find((c) => c.roque === "Q") ?? null;

  // Forme coordonnée, avec ou sans lettre de pièce : e2e4, g1f3, e7e8q, Ng1-f3, Bf1xc4.
  //
  // LA LETTRE DE PIÈCE EST VÉRIFIÉE, PAS IGNORÉE. Une première version la laissait tomber au
  // motif qu'elle est redondante avec la case de départ. Elle l'est quand elle est juste ; quand
  // elle est fausse, l'ignorer transforme une absurdité en coup légal : « Ke2xe4 » devenait la
  // poussée de pion e2-e4, et un modèle qui ne sait pas où sont ses pièces était crédité d'un
  // bon coup. C'est le faux ACCEPT — celui qui gonfle un score au lieu de l'abaisser, et qu'aucune
  // relecture de réponses fausses ne révèle jamais.
  const coord = /^([KQRBN])?([a-h][1-8])[-x]?([a-h][1-8])=?([qrbnQRBN])?$/.exec(t);
  if (coord) {
    const lettre = coord[1]?.toLowerCase();
    const de = indexCase(coord[2]);
    const vers = indexCase(coord[3]);
    const promo = coord[4]?.toLowerCase();
    if (lettre !== undefined && p.cases[de]?.toLowerCase() !== lettre) return null;
    return legaux.find((c) =>
      c.de === de && c.vers === vers && (promo ? c.promotion === promo : !c.promotion)) ?? null;
  }

  // Forme abrégée : [pièce][précision][x]case[=promotion]
  const san = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?([QRBNqrbn]))?$/.exec(t);
  if (san === null) return null;

  const [, lettre, colonne, rangee, , arrivee, promotion] = san;
  const type = (lettre ?? "P").toLowerCase();
  const vers = indexCase(arrivee);
  const promo = promotion?.toLowerCase();

  const candidats = legaux.filter((c) => {
    if (c.vers !== vers) return false;
    if (p.cases[c.de]?.toLowerCase() !== type) return false;
    if (colonne !== undefined && "abcdefgh"[COLONNE(c.de)] !== colonne) return false;
    if (rangee !== undefined && String(RANGEE(c.de) + 1) !== rangee) return false;
    if (promo !== undefined) return c.promotion === promo;
    // Sans indication de promotion sur un coup qui en exige une, la dame est l'usage universel.
    if (c.promotion) return c.promotion === "q";
    return true;
  });

  return candidats.length === 1 ? candidats[0] : null;
}

// ── Vérification de l'instrument ──────────────────────────────────────────────────────────────

/**
 * Compte les feuilles de l'arbre des coups légaux. C'est le test de référence d'un moteur
 * d'échecs : les valeurs sont connues au nœud près et ne dépendent d'aucune appréciation.
 */
export function perft(p: Position, profondeur: number): number {
  if (profondeur === 0) return 1;
  const coups = coupsLegaux(p);
  if (profondeur === 1) return coups.length;
  let total = 0;
  for (const c of coups) total += perft(jouer(p, c), profondeur - 1);
  return total;
}

/**
 * Cherche un mat forcé en `n` coups pour le camp au trait.
 *
 * POURQUOI CETTE FONCTION EXISTE : pour que les problèmes du banc soient VÉRIFIÉS au lieu d'être
 * recopiés. Un problème « mat en 2 » repris d'une source et mal transcrit transforme une bonne
 * réponse en erreur — le défaut exact que ce projet a déjà corrigé deux fois sur le juge. Ici,
 * chaque position est passée à cette recherche au démarrage : si le mat annoncé n'existe pas, la
 * suite refuse de se lancer.
 *
 * Renvoie la liste des premiers coups qui forcent le mat. Vide s'il n'y en a aucun.
 */
export function coupsMatants(p: Position, n: number): Coup[] {
  if (n < 1) return [];
  return coupsLegaux(p).filter((c) => matForce(jouer(p, c), n - 1));
}

/** Le camp au trait est-il mat au plus tard dans `n` coups de son adversaire ? */
function matForce(p: Position, n: number): boolean {
  const reponses = coupsLegaux(p);
  if (reponses.length === 0) return enEchec(p);
  if (n === 0) return false;
  // Le défenseur choisit : il faut que TOUTES ses réponses mènent au mat.
  return reponses.every((r) => coupsMatants(jouer(p, r), n).length > 0);
}
