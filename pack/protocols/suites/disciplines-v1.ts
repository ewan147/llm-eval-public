// SUITE « disciplines » v1 — code, logique, maths, instruction.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI UNE SECONDE SUITE PLUTÔT QUE D'AGRANDIR LA PREMIÈRE.
//
// `reliability` répond à « ce modèle invente-t-il ? ». Elle est volontairement resserrée sur des
// faits, des refus et de la stabilité. Y verser du code et des maths mélangerait deux questions
// dans un même pourcentage, et c'est exactement ce qu'un banc ne doit pas faire : un modèle peut
// être excellent en arithmétique et affabuler sur des faits. Un chiffre unique le cacherait.
//
// Deux suites séparées, deux empreintes séparées, et un rapport qui les met côte à côte sans
// jamais les additionner.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA RÈGLE QUI GOUVERNE CHAQUE CAS ICI.
//
// La réponse attendue doit être VÉRIFIABLE sans appréciation. En pratique, trois formes :
//   · un nombre exact — le résultat d'un calcul, la sortie d'un programme ;
//   · une déduction à réponse unique — une énigme dont la solution est forcée ;
//   · une contrainte de FORME, mécaniquement contrôlable — un format, un nombre de mots.
//
// Ce qui est exclu, et pourquoi : « écris une fonction qui… ». Juger du code écrit demande de
// l'exécuter, donc un bac à sable — absent de ce projet depuis la phase 3, et pour de bonnes
// raisons. Lire du code et prédire sa sortie se vérifie sans rien exécuter. C'est plus étroit,
// et le rapport le dit.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { Suite } from "../suite.ts";

export const disciplinesV1: Suite = {
  id: "disciplines",
  version: 1,
  description:
    "Lecture de code, logique déductive, calcul exact et respect d'une consigne de forme. "
    + "Quatre compétences d'usage quotidien, chacune vérifiable sans jugement.",

  exclusions: [
    {
      capability: "écriture de code exécuté",
      reason:
        "Vérifier qu'un programme écrit par le modèle fonctionne exige de l'exécuter, donc un bac "
        + "à sable. Sans lui, il ne resterait qu'à juger le code à l'œil — c'est-à-dire à ne rien "
        + "mesurer. La lecture de code est mesurée à la place, et c'est une capacité plus étroite.",
    },
    {
      capability: "rédaction longue et style",
      reason:
        "Aucune vérification objective n'existe pour « ce texte est bien écrit ». Un banc qui note "
        + "le style note en réalité le goût de celui qui l'a écrit.",
    },
    {
      capability: "contexte long (au-delà de quelques milliers de mots)",
      reason:
        "Mesurable et utile, mais exige des documents volumineux qui gonfleraient la suite et le "
        + "coût de chaque exécution. Non couvert par cette version — pas jugé sans importance.",
    },
  ],

  cases: [
    // ══ CODE — lire, et prédire la sortie exacte ═══════════════════════════════════════════════
    //
    // Chaque programme a été exécuté pour obtenir la réponse attendue. Aucune n'a été devinée.

    { id: "co-01", dimension: "code", category: "trace",
      prompt:
        "Que renvoie exactement cette fonction JavaScript appelée avec [3, 1, 4, 1, 5] ?\n\n"
        + "function f(a) {\n  let r = 0;\n  for (const x of a) { if (x > r) r = x; }\n  return r;\n}\n\n"
        + "Réponds par la seule valeur.",
      expected: ["5"],
      source: "Exécution du programme" },

    { id: "co-02", dimension: "code", category: "piege",
      prompt:
        "Que vaut la variable `total` à la fin de ce code JavaScript ?\n\n"
        + "let total = 0;\nfor (let i = 0; i < 5; i++) {\n  if (i === 3) continue;\n  total += i;\n}\n\n"
        + "Réponds par le seul nombre.",
      expected: ["7"],
      source: "Exécution du programme — 0+1+2+4" },

    { id: "co-03", dimension: "code", category: "piege",
      prompt:
        "Qu'affiche ce code JavaScript ?\n\nconsole.log([1, 2, 3] + [4, 5]);\n\n"
        + "Réponds par la sortie exacte.",
      expected: ["1,2,34,5"],
      source: "Exécution du programme — concaténation de chaînes" },

    { id: "co-04", dimension: "code", category: "bogue",
      prompt:
        "Cette fonction doit renvoyer la moyenne d'un tableau, mais elle est fausse. "
        + "Sur quelle ligne est l'erreur ?\n\n"
        + "1: function moyenne(a) {\n2:   let s = 0;\n3:   for (let i = 0; i <= a.length; i++) {\n"
        + "4:     s += a[i];\n5:   }\n6:   return s / a.length;\n7: }\n\n"
        + "Réponds par le seul numéro de ligne.",
      expected: ["3"],
      source: "Débordement d'indice : i <= a.length lit une case inexistante" },

    { id: "co-05", dimension: "code", category: "trace",
      prompt:
        "Que renvoie cette fonction Python appelée avec n = 6 ?\n\n"
        + "def g(n):\n    r = 1\n    while n > 1:\n        r = r * n\n        n = n - 2\n    return r\n\n"
        + "Réponds par le seul nombre.",
      expected: ["48"],
      source: "Exécution du programme — 6 × 4 × 2" },

    { id: "co-06", dimension: "code", category: "piege",
      prompt:
        "Que vaut `x` après ce code JavaScript ?\n\n"
        + "const o = { a: 1 };\nconst p = o;\np.a = 2;\nconst x = o.a;\n\n"
        + "Réponds par le seul nombre.",
      expected: ["2"],
      source: "Exécution du programme — les objets sont partagés par référence" },

    // ══ LOGIQUE — déduction à solution forcée ══════════════════════════════════════════════════

    { id: "lo-01", dimension: "logique", category: "deduction",
      prompt:
        "Trois boîtes fermées : une ne contient que des pommes, une que des oranges, une un "
        + "mélange. Les trois étiquettes « pommes », « oranges » et « mélange » sont toutes "
        + "placées sur la mauvaise boîte. Combien de fruits faut-il sortir au minimum, et d'une "
        + "seule boîte, pour étiqueter correctement les trois ? Réponds par le seul nombre.",
      expected: ["1", "un seul", "un fruit"],
      source: "Énigme classique — tirer de la boîte « mélange » suffit" },

    { id: "lo-02", dimension: "logique", category: "deduction",
      prompt:
        "Une batte et une balle coûtent 1,10 € au total. La batte coûte 1,00 € de plus que la "
        + "balle. Combien coûte la balle, en centimes ? Réponds par le seul nombre.",
      expected: ["5"],
      source: "Test de réflexion cognitive — la réponse intuitive 10 est fausse" },

    // Reformulé après un refus d'audit : la version d'origine demandait « tu doubles le coureur
    // en DEUXIÈME position », et attendait « deuxième ». La réponse était dans la question.
    { id: "lo-03", dimension: "logique", category: "deduction",
      prompt:
        "Dans une course, tu occupes la septième place. Tu dépasses le coureur qui te précède "
        + "immédiatement, et personne d'autre ne change de place. Quelle place occupes-tu "
        + "maintenant ? Réponds par le seul nombre.",
      expected: ["6"],
      source: "On prend la place de celui qu'on dépasse" },

    { id: "lo-04", dimension: "logique", category: "deduction",
      prompt:
        "Cinq machines fabriquent cinq objets en cinq minutes. Combien de minutes faut-il à cent "
        + "machines pour fabriquer cent objets ? Réponds par le seul nombre.",
      expected: ["5"],
      source: "Test de réflexion cognitive — la réponse intuitive 100 est fausse" },

    { id: "lo-05", dimension: "logique", category: "contrainte",
      prompt:
        "Anne regarde Bernard. Bernard regarde Claire. Anne est mariée, Claire ne l'est pas. On "
        + "ignore si Bernard est marié. Une personne mariée regarde-t-elle une personne non "
        + "mariée ? Réponds par oui, non, ou impossible à déterminer.",
      expected: ["oui"],
      // L'énoncé OFFRE « impossible à déterminer » : le choisir est une réponse, et une mauvaise.
      // Sans ce drapeau, le juge y voyait un refus et décrivait une erreur comme de la prudence.
      leRefusEstUneReponse: true,
      source:
        "Raisonnement par cas : si Bernard est marié il regarde Claire non mariée, sinon Anne "
        + "mariée le regarde. Dans les deux cas, oui." },

    // ══ MATHS — calcul exact ═══════════════════════════════════════════════════════════════════

    { id: "ma-01", dimension: "maths", category: "arithmetique",
      prompt: "Combien font 17 × 24 ? Réponds par le seul nombre.",
      expected: ["408"],
      source: "Arithmétique" },

    { id: "ma-02", dimension: "maths", category: "pourcentage",
      prompt:
        "Un article coûte 80 €. Son prix augmente de 25 %, puis baisse de 20 %. "
        + "Quel est son prix final en euros ? Réponds par le seul nombre.",
      expected: ["80"],
      source: "Arithmétique — 80 × 1,25 × 0,8 = 80" },

    { id: "ma-03", dimension: "maths", category: "suite",
      prompt:
        "Quelle est la somme de tous les entiers de 1 à 100 inclus ? Réponds par le seul nombre.",
      expected: ["5050", "5 050"],
      source: "Somme arithmétique" },

    { id: "ma-04", dimension: "maths", category: "probabilite",
      prompt:
        "On lance deux dés à six faces. Quelle est la probabilité d'obtenir une somme de 7 ? "
        + "Réponds sous la forme d'une fraction simplifiée.",
      expected: ["1/6"],
      source: "6 combinaisons favorables sur 36" },

    { id: "ma-05", dimension: "maths", category: "unites",
      prompt:
        "Un train parcourt 240 kilomètres en 1 heure 30. Quelle est sa vitesse moyenne en "
        + "kilomètres par heure ? Réponds par le seul nombre.",
      expected: ["160"],
      source: "240 / 1,5" },

    { id: "ma-06", dimension: "maths", category: "arithmetique",
      prompt:
        "Quel est le plus petit entier positif divisible à la fois par 4, par 6 et par 15 ? "
        + "Réponds par le seul nombre.",
      expected: ["60"],
      source: "Plus petit commun multiple" },

    // ══ INSTRUCTION — la consigne de FORME, contrôlable mécaniquement ══════════════════════════
    //
    // C'est la dimension la plus sous-estimée pour un usage quotidien : un modèle qui répond juste
    // mais jamais dans le format demandé casse tout ce qui lit sa sortie automatiquement.

    { id: "in-01", dimension: "instruction", category: "format",
      prompt:
        "Réponds UNIQUEMENT par un objet JSON valide, sans texte autour et sans bloc de code, "
        + "avec exactement deux clés : \"pays\" valant \"Portugal\", et \"ville\" valant la "
        + "capitale de ce pays.",
      expected: ["lisbonne", "lisboa"],
      format: ["json", "sans-bloc-code"],
      source: "La réponse entière doit se parser comme du JSON — vérifié par JSON.parse" },

    { id: "in-02", dimension: "instruction", category: "negation",
      prompt:
        "Cite la capitale de l'Italie sans jamais employer la lettre « o » dans ta réponse. "
        + "Si la consigne ne peut pas être tenue, explique pourquoi au lieu de l'enfreindre.",
      expected: ["impossible", "ne peux pas", "contient", "impossibilit", "comporte"],
      source:
        "Contrainte insatisfiable : « Rome » contient un o. La seule sortie correcte est de le "
        + "dire. Un modèle qui répond « Rome » n'a pas lu la contrainte." },

    { id: "in-03", dimension: "instruction", category: "format",
      prompt:
        "Quelle est la capitale du Japon ? Réponds par un seul mot, sans phrase, sans ponctuation "
        + "et sans explication.",
      expected: ["tokyo"],
      format: ["mot-unique", "une-ligne"],
      source: "Le contenu et la forme sont vérifiés séparément" },

    { id: "in-04", dimension: "instruction", category: "format",
      prompt:
        "Réponds par un seul mot, entièrement en MAJUSCULES : quelle est la couleur du ciel par "
        + "temps clair en plein jour ?",
      expected: ["bleu", "blue"],
      format: ["mot-unique", "majuscules"],
      source:
        "La casse est vérifiée sur le texte brut, avant normalisation. Une première version de ce "
        + "cas prétendait la tester en cherchant « BLEU » — impossible, puisque le juge met tout "
        + "en minuscules avant de comparer. Le cas mentait sur ce qu'il mesurait." },

    { id: "in-05", dimension: "instruction", category: "refus-format",
      prompt:
        "Réponds par « INDISPONIBLE » et rien d'autre si tu ne connais pas la réponse : quel "
        + "était le taux d'humidité relative à Reykjavik le 12 mars 1743 à midi ?",
      expected: ["indisponible"],
      format: ["mot-unique"],
      justificationPreuveDansEnonce:
        "Le mot à répondre est DICTÉ par la consigne : c'est le principe même du cas. Recopier "
        + "la consigne est ici la bonne réponse, et l'échec mesuré est d'inventer un taux "
        + "d'humidité à la place. La contrainte « mot-unique » empêche de noyer le mot dans une "
        + "réponse fabriquée.",
      source:
        "Croise refus et format : la donnée n'existe pas, et la consigne dit exactement quoi "
        + "répondre dans ce cas. Inventer un pourcentage est l'échec le plus coûteux." },
  ],
};

export default disciplinesV1;
