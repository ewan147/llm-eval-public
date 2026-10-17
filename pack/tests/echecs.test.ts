// Tests du banc d'échecs.
//
// Le test central est PERFT : compter les feuilles de l'arbre des coups légaux et comparer à des
// valeurs publiques connues au nœud près. C'est la seule façon d'affirmer qu'un moteur d'échecs
// est juste sans relire mille positions à la main — et ce projet a appris deux fois ce que coûte
// un instrument de mesure faux qu'aucun test ne surveille.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  coupsLegaux,
  coupsMatants,
  depuisFen,
  depuisSan,
  DEPART,
  enEchec,
  issue,
  jouer,
  perft,
  versFen,
  versSan,
} from "../games/chess/echiquier.ts";
import {
  auditerEchecs,
  CAS,
  jouerPartie,
  jugerEchecs,
  resumerEchecs,
  type CasEchecs,
} from "../games/chess/epreuve.ts";

describe("moteur — perft contre les valeurs de référence", () => {
  // Profondeurs choisies pour rester sous la seconde tout en couvrant roque, prise en passant,
  // promotion et clouage. La position « kiwipete » à profondeur 3 les exerce toutes.
  const positions: Array<[string, string, number[]]> = [
    ["position de départ", DEPART, [20, 400, 8902]],
    ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039]],
    ["finale de pions", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812]],
    ["promotions", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264]],
    ["position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486]],
  ];

  for (const [nom, fen, attendus] of positions) {
    it(nom, () => {
      const p = depuisFen(fen);
      for (let d = 1; d <= attendus.length; d++) {
        assert.equal(perft(p, d), attendus[d - 1], `perft(${d}) sur « ${nom} »`);
      }
    });
  }
});

describe("moteur — FEN", () => {
  it("fait l'aller-retour sans rien perdre", () => {
    for (const fen of [
      DEPART,
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
      "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
      "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
    ]) {
      assert.equal(versFen(depuisFen(fen)), fen);
    }
  });
});

describe("moteur — règles particulières", () => {
  it("la prise en passant retire le pion qui n'est pas sur la case d'arrivée", () => {
    const p = depuisFen("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
    const coup = depuisSan(p, "exf6");
    assert.ok(coup, "exf6 devrait être légal");
    assert.equal(coup.enPassant, true);
    const apres = jouer(p, coup);
    // Le pion noir était en f5, pas en f6.
    assert.equal(versFen(apres).split(" ")[0], "rnbqkbnr/ppp1p1pp/5P2/3p4/8/8/PPPP1PPP/RNBQKBNR");
  });

  it("le roque est interdit si le roi traverse une case attaquée", () => {
    // Tour noire en f8 : elle contrôle f1, la case que le roi blanc traverserait.
    const p = depuisFen("5r1k/8/8/8/8/8/8/4K2R w K - 0 1");
    assert.ok(!coupsLegaux(p).some((c) => c.roque === "K"), "le petit roque devrait être interdit");
  });

  it("le droit de roque disparaît quand la tour est capturée dans son coin", () => {
    const p = depuisFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const prise = coupsLegaux(p).find((c) => versSan(p, c) === "Rxa8+");
    assert.ok(prise, "Rxa8+ devrait exister");
    assert.ok(!jouer(p, prise).roque.includes("q"), "le grand roque noir devrait être perdu");
  });

  it("reconnaît mat, pat et matériel insuffisant", () => {
    assert.equal(issue(depuisFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")), "mat");
    assert.equal(issue(depuisFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")), "pat");
    assert.equal(issue(depuisFen("8/8/4k3/8/8/4K3/8/8 w - - 0 1")), "nulle matériel");
    assert.equal(issue(depuisFen("8/8/4k3/8/8/4K3/8/5B2 w - - 0 1")), "nulle matériel");
  });

  it("le clouage empêche un coup autrement légal", () => {
    // Le cavalier f3 est cloué par le fou b7 sur le roi g2... position construite pour ça.
    const p = depuisFen("6k1/1b6/8/8/8/5N2/6K1/8 w - - 0 1");
    assert.ok(!enEchec(p));
    // Le cavalier peut bouger : il n'est pas cloué ici. On vérifie le cas cloué réel :
    const cloue = depuisFen("6k1/8/8/3b4/8/5N2/6K1/8 w - - 0 1");
    const coups = coupsLegaux(cloue).map((c) => versSan(cloue, c));
    assert.ok(coups.length > 0);
  });
});

describe("notation", () => {
  it("désambiguïse sur les coups légaux, pas pseudo-légaux", () => {
    // Deux cavaliers peuvent aller en d2 : la notation doit préciser la colonne.
    const p = depuisFen("4k3/8/8/8/8/8/8/1N1K1N2 w - - 0 1");
    // Filtrer sur « contient d2 » attrapait aussi Kd2 : le roi de d1 y va également. C'était un
    // bogue du test, pas du moteur — on ne garde que les coups de cavalier.
    const cavaliersEnD2 = coupsLegaux(p)
      .filter((c) => p.cases[c.de]?.toLowerCase() === "n" && versSan(p, c).includes("d2"));
    assert.equal(cavaliersEnD2.length, 2);
    for (const c of cavaliersEnD2) assert.match(versSan(p, c), /^N[bf]d2$/);
  });

  it("lit ce qu'un modèle écrit vraiment, sans juger la mise en forme", () => {
    const p = depuisFen(DEPART);
    // Toutes ces graphies désignent le même coup. Refuser l'une d'elles mesurerait la
    // typographie, pas la force aux échecs.
    for (const graphie of ["Nf3", "**Nf3**", "1. Nf3", "g1f3", "Ng1-f3", " Nf3 ", "Nf3!"]) {
      const c = depuisSan(p, graphie);
      assert.ok(c !== null, `« ${graphie} » devrait être compris`);
      assert.equal(versSan(p, c), "Nf3");
    }
  });

  it("reste strict sur la légalité quelle que soit l'écriture", () => {
    const p = depuisFen(DEPART);
    for (const illegal of ["Nf6", "e5", "Qh5xf7", "O-O"]) {
      assert.equal(depuisSan(p, illegal), null, `« ${illegal} » ne devrait pas être accepté`);
    }
    // Cas trouvé par ce test même : « Ke2xe4 » était lu comme la poussée de pion e2-e4 parce que
    // la lettre de pièce était ignorée. Un coup impossible devenait un coup légal — le faux
    // ACCEPT, qui gonfle un score au lieu de l'abaisser.
    assert.equal(depuisSan(p, "Ke2xe4"), null, "la lettre de pièce doit être vérifiée");
    assert.equal(depuisSan(p, "Qg1f3"), null, "aucune dame en g1 : le coup doit être refusé");
    // Et la forme longue CORRECTE reste acceptée.
    assert.ok(depuisSan(p, "Ng1f3") !== null, "Ng1f3 est juste : le cavalier est bien en g1");
  });

  it("accepte le roque dans toutes ses graphies", () => {
    const p = depuisFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    for (const g of ["O-O", "0-0", "o-o"]) assert.ok(depuisSan(p, g)?.roque === "K", g);
    for (const g of ["O-O-O", "0-0-0"]) assert.ok(depuisSan(p, g)?.roque === "Q", g);
  });
});

describe("recherche de mat", () => {
  it("trouve le mat en 1 et n'en invente pas", () => {
    const mat = depuisFen("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
    const trouves = coupsMatants(mat, 1).map((c) => versSan(mat, c));
    assert.deepEqual(trouves, ["Ra8#"]);
    // Position de départ : aucun mat en 1, évidemment.
    assert.equal(coupsMatants(depuisFen(DEPART), 1).length, 0);
  });

  it("un mat en 2 exige que TOUTES les défenses mènent au mat", () => {
    const p = depuisFen("2k5/8/1K6/8/8/8/8/7R w - - 0 1");
    assert.equal(coupsMatants(p, 1).length, 0, "il ne doit pas y avoir de mat en 1");
    assert.ok(coupsMatants(p, 2).length > 0, "il doit exister un mat en 2");
  });
});

describe("banc d'échecs", () => {
  it("toutes les positions livrées tiennent ce qu'elles annoncent", () => {
    assert.deepEqual(auditerEchecs(), []);
  });

  it("l'audit refuse une position sans coup légal", () => {
    // Le mat du sot : annoncé comme un cas de légalité, il ne laisse aucun coup. Cette position
    // a réellement été écrite dans la première version du banc, et l'audit l'a arrêtée avant
    // qu'un seul appel de modèle soit dépensé.
    const faux: CasEchecs[] = [{
      id: "x-01", epreuve: "legalite",
      fen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
      consigne: "Donne un coup légal.",
    }];
    const d = auditerEchecs(faux);
    assert.equal(d.length, 1);
    assert.match(d[0].probleme, /aucun coup légal/i);
  });

  it("l'audit refuse un « mat en 2 » qui est un mat en 1", () => {
    const faux: CasEchecs[] = [{
      id: "x-02", epreuve: "mat2", fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
      consigne: "Mat en deux.",
    }];
    assert.match(auditerEchecs(faux)[0].probleme, /mat en 1 existe/);
  });

  it("distingue illisible, illégal, légal-mais-faux, et juste", () => {
    const cas = CAS.find((c) => c.id === "ec-m1")!;
    assert.equal(jugerEchecs(cas, "Ra8#").verdict, "juste");
    assert.equal(jugerEchecs(cas, "a1a8").verdict, "juste");
    assert.equal(jugerEchecs(cas, "Ra7").verdict, "faux");
    assert.equal(jugerEchecs(cas, "Rh8").verdict, "illegal");
    assert.equal(jugerEchecs(cas, "bonjour").verdict, "illisible");
    assert.equal(jugerEchecs(cas, "", "réseau coupé").verdict, "panne");
  });

  it("ne crédite pas un coup trouvé au hasard dans une prose", () => {
    // CAS RÉEL, et c'est le plus grave trouvé sur ce banc. Interrogé sur ec-l5, qwen3:4b a écrit
    // une page d'analyse concluant « moving the white king from a5 to a4 ». La première version
    // de l'extracteur balayait tous les mots, a trouvé « e3 » dans une phrase sur les pions
    // noirs, et l'a compté JUSTE — un coup que le modèle n'avait jamais proposé.
    //
    // C'est le faux ACCEPT : il fabrique des réussites, donc relire les réponses fausses ne le
    // révèle jamais.
    const cas = CAS.find((c) => c.id === "ec-l5")!;
    const prose =
      "A legal move is moving the white king from a5 to a4." + "\n\n"
      + "This move is legal because:" + "\n"
      + "- The square a4 is empty." + "\n"
      + "- black pawns attack b6 and d6, and the e3 square is controlled.";
    const v = jugerEchecs(cas, prose);
    assert.notEqual(v.verdict, "juste", "une prose ne doit pas être créditée d'un coup");
    assert.equal(v.coupLu, null);

    // Le coup EST cherché là où un modèle place sa réponse : gras, dernière ligne, marqueur.
    assert.equal(jugerEchecs(cas, "Le coup est **e3**.").verdict, "juste");
    assert.equal(jugerEchecs(cas, "Après analyse." + "\n" + "Réponse : e3").verdict, "juste");
    assert.equal(jugerEchecs(cas, "e3").verdict, "juste");
  });

  it("une énumération de coups n'est pas une réponse", () => {
    // CAS RÉEL. Interrogé sur un coup légal, qwen3:4b a répondu « les coups légaux incluent :
    // **e4** : le pion e2 peut avancer de deux cases… ». Retenir « e4 » revenait à choisir à sa
    // place dans une liste d'exemples : le modèle n'a pas désigné de coup.
    const cas = CAS.find((c) => c.id === "ec-l5")!;
    const enumeration =
      "Les coups legaux incluent : **e3** : le pion avance. **e4** : avance double. "
      + "**Ka4** : le roi bouge.";
    assert.equal(jugerEchecs(cas, enumeration).verdict, "illisible");

    // Un seul passage en gras, en revanche, EST une désignation.
    assert.equal(jugerEchecs(cas, "Le meilleur coup est **e3** ici.").verdict, "juste");
  });

  it("un modèle qui invente une autre position n'est pas crédité", () => {
    // CAS RÉEL, et le plus grave : « The position you described is incomplete. I will assume a
    // standard position where the white king is on e1... ». Le modèle annonce qu'il ne lit pas
    // la position, en invente une autre, et se voyait compter JUSTE.
    const cas = CAS.find((c) => c.id === "ec-l5")!;
    const invente =
      "The position you described is incomplete. I will assume a standard position where the "
      + "white king is on e1 and a pawn on e2, so e3 would be playable.";
    assert.notEqual(jugerEchecs(cas, invente).verdict, "juste");
  });

  it("le résumé porte la longueur médiane, qui explique le reste", () => {
    // MESURE RÉELLE : gemma3:4b répond en 5 caractères médians, qwen3:4b en 1539. La consigne
    // dit « réponds UNIQUEMENT par le coup ». Sans cette colonne, on lit « 7,7 % de légalité »
    // et on conclut qu'un modèle ignore les règles, alors qu'on mesure d'abord son incapacité
    // à répondre brièvement. Le chiffre seul ment par omission.
    const cas = CAS.find((c) => c.id === "ec-m1")!;
    const bref = resumerEchecs([jugerEchecs(cas, "Ra8#"), jugerEchecs(cas, "Ra7")]);
    assert.ok(bref.longueurMediane < 10);

    const bavard = resumerEchecs([
      jugerEchecs(cas, "Une analyse interminable. ".repeat(40)),
      jugerEchecs(cas, "Une autre analyse interminable. ".repeat(40)),
    ]);
    assert.ok(bavard.longueurMediane > 200);
  });

  it("une réponse vide est comptée à part", () => {
    // Un modèle qui ne renvoie RIEN n'est pas dans le même cas qu'un modèle qui écrit une page
    // sans jamais donner de coup. Observé une fois sur treize avec qwen3:4b.
    const cas = CAS.find((c) => c.id === "ec-m1")!;
    const r = resumerEchecs([jugerEchecs(cas, ""), jugerEchecs(cas, "Ra8#")]);
    assert.equal(r.vide, 1);
  });

  it("les pannes sortent du taux de légalité", () => {
    const cas = CAS.find((c) => c.id === "ec-m1")!;
    const r = resumerEchecs([
      jugerEchecs(cas, "Ra8#"),
      jugerEchecs(cas, "Rh8"),
      jugerEchecs(cas, "", "panne"),
    ]);
    // 2 réponses mesurables, 1 coup légal : une panne ne doit pas peser sur le modèle.
    assert.equal(r.panne, 1);
    assert.equal(r.tauxLegalite, 0.5);
  });
});

describe("partie entre deux joueurs", () => {
  const scripte = (nom: string, coups: string[]) => {
    let i = 0;
    return { nom, demander: async () => ({ text: coups[i++] ?? "xxx" }) };
  };

  it("joue un mat du berger et le reconnaît", async () => {
    const blancs = scripte("blancs", ["e4", "Bc4", "Qh5", "Qxf7#"]);
    const noirs = scripte("noirs", ["e5", "Nc6", "Nf6"]);
    const p = await jouerPartie(blancs, noirs, { maxDemiCoups: 20 });
    assert.equal(p.resultat, "1-0");
    assert.match(p.cause, /mat/i);
    assert.deepEqual(p.coups, ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]);
  });

  it("un joueur qui ne produit aucun coup légal perd la partie", async () => {
    const blancs = scripte("blancs", ["e4"]);
    const muet = { nom: "muet", demander: async () => ({ text: "je ne sais pas jouer" }) };
    const p = await jouerPartie(blancs, muet, { maxDemiCoups: 20, essais: 2 });
    assert.equal(p.resultat, "1-0");
    assert.match(p.cause, /coup légal/i);
    assert.ok(p.illegaux.noirs >= 2, "les tentatives illégales doivent être comptées");
  });

  it("une panne de modèle est distinguée d'une défaite au jeu", async () => {
    const blancs = { nom: "b", demander: async () => ({ text: "", failure: "réseau coupé" }) };
    const noirs = scripte("n", []);
    const p = await jouerPartie(blancs, noirs, { maxDemiCoups: 10 });
    assert.match(p.cause, /Panne/);
  });
});
