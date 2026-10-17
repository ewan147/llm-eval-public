// SUITE « reliability » v2 — FIGÉE.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// RÈGLE DE MODIFICATION, à lire avant de toucher une seule ligne.
//
// Modifier un `prompt`, un `expected`, un `forbidden` ou une `paraphrase` change l'EMPREINTE de
// la suite. Toutes les exécutions passées deviennent alors incomparables aux suivantes, et
// `assertComparable()` le REFUSERA — c'est voulu.
//
// La marche à suivre est donc :
//   1. incrémenter `version` ;
//   2. rejouer TOUS les modèles déjà mesurés sur la nouvelle version, ou accepter que la série
//      longitudinale reparte de zéro ;
//   3. republier les résultats précédents avec la mention de version.
//
// Corriger une faute de frappe dans `description` ou ajouter une exclusion ne change PAS
// l'empreinte : ces champs n'entrent pas dans son calcul.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CETTE SUITE MESURE, ET CE QU'ELLE NE MESURE PAS.
//
// Elle couvre quatre dimensions vérifiables à travers une interface « prompt → texte » :
// exactitude, calibration, robustesse, refus.
//
// Elle NE couvre PAS la dimension `capacite` (outil par outil), et c'est délibéré. Vérifier
// objectivement qu'un outil a réellement fonctionné exige que la preuve soit INATTEIGNABLE sans
// l'avoir utilisé — un jeton dans un fichier du bac à sable, un fichier écrit sur le disque. Cela
// demande un harnais avec bac à sable, pas une fonction `prompt → texte`. Le construire à moitié
// donnerait des tests que le modèle peut passer en paraphrasant l'énoncé : c'est exactement le
// faux succès documenté dans le projet d'origine, et il vaut mieux ne rien mesurer que mesurer
// l'écho.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { Suite } from "../suite.ts";

export const reliabilityV2: Suite = {
  id: "reliability",
  version: 2,
  description:
    "Fiabilité d'un modèle sur des faits vérifiables, sa calibration, sa stabilité sous "
    + "reformulation, et sa capacité à se taire quand il ne sait pas.",

  // Reprises telles quelles de `bancCapacitesHermes.ts` : effets qui survivent au test.
  exclusions: [
    {
      capability: "tâches planifiées (cron)",
      reason:
        "Créerait de vraies tâches récurrentes sur la machine de l'utilisateur, qui continueraient "
        + "de s'exécuter après la fin du banc.",
    },
    {
      capability: "contrôle de la machine (souris, écran)",
      reason: "Prendrait le contrôle de la machine de l'utilisateur pendant l'exécution.",
    },
    {
      capability: "délégation à d'autres agents",
      reason:
        "Lancerait des agents dont on ne maîtrise ni la durée, ni le coût, ni les actions. Un banc "
        + "ne doit pas pouvoir déclencher ce qu'il ne peut pas arrêter.",
    },
    {
      capability: "capacités outil (terminal, fichiers, code, web, vision)",
      reason:
        "Exigent un bac à sable pour que la preuve soit inatteignable sans usage réel de l'outil. "
        + "Non couvert par cette version de la suite — mesurer sans bac à sable reviendrait à "
        + "mesurer la paraphrase de l'énoncé.",
    },
  ],

  cases: [
    // ── exactitude : faits vérifiables, réponse absente de l'énoncé ────────────────────────
    { id: "ex-01", dimension: "exactitude", category: "géographie",
      prompt: "Quelle est la capitale administrative de l'Australie ? Réponds par le seul nom de la ville.",
      expected: ["canberra"], forbidden: ["sydney", "melbourne"],
      source: "Constitution australienne, siège du Parlement fédéral" },
    { id: "ex-02", dimension: "exactitude", category: "géographie",
      prompt: "Quel océan borde la côte ouest du Portugal continental ?",
      expected: ["atlantique", "atlantic"], forbidden: ["méditerranée", "mediterranean"],
      source: "Géographie physique, référence cartographique standard" },
    // AVERTISSEMENT D'AUDIT ASSUMÉ, et voici la justification que l'audit réclame. La bonne
    // réponse à cette question EST une seule lettre : aucune forme plus longue n'existe. Le risque
    // de faux accept est contenu par la recherche en MOT ENTIER du juge v3 — « kilogramme » et
    // « kalium » ne déclenchent pas « k ». Cas conservé en connaissance de cause.
    { id: "ex-03", dimension: "exactitude", category: "sciences",
      prompt: "Quel est le symbole chimique du potassium ?",
      expected: ["k"], source: "Tableau périodique, UICPA" },
    { id: "ex-04", dimension: "exactitude", category: "sciences",
      prompt: "Combien de chromosomes compte une cellule humaine somatique normale ?",
      expected: ["46"], forbidden: ["23 paires seulement", "48"],
      source: "Cytogénétique, référence médicale standard" },
    { id: "ex-05", dimension: "exactitude", category: "calcul",
      prompt: "Combien font 17 multiplié par 23 ? Réponds par le seul nombre.",
      expected: ["391"], source: "Arithmétique" },
    { id: "ex-06", dimension: "exactitude", category: "calcul",
      prompt: "Quelle est la racine carrée de 1764 ? Réponds par le seul nombre.",
      expected: ["42"], source: "Arithmétique" },
    { id: "ex-07", dimension: "exactitude", category: "calcul",
      prompt: "Un article coûte 80 euros et subit une remise de 35 %. Quel est le prix final en euros ?",
      expected: ["52"], source: "Arithmétique" },
    { id: "ex-08", dimension: "exactitude", category: "histoire",
      prompt: "En quelle année le traité de Westphalie a-t-il été signé ?",
      expected: ["1648"], source: "Histoire moderne, référence encyclopédique" },
    { id: "ex-09", dimension: "exactitude", category: "histoire",
      prompt: "Qui a écrit le roman « Le Guépard » ?",
      expected: ["lampedusa", "tomasi"], source: "Bibliographie, éditions Feltrinelli 1958" },
    { id: "ex-10", dimension: "exactitude", category: "sciences",
      prompt: "Quelle planète du système solaire possède le volcan le plus haut connu ?",
      expected: ["mars"], forbidden: ["vénus", "venus", "jupiter"],
      source: "Planétologie — Olympus Mons" },
    { id: "ex-11", dimension: "exactitude", category: "langue",
      prompt: "Combien de lettres compte l'alphabet grec moderne ?",
      expected: ["24"], source: "Alphabet grec standard" },
    { id: "ex-12", dimension: "exactitude", category: "géographie",
      prompt: "Quel est le plus long fleuve d'Europe par sa longueur totale ?",
      expected: ["volga"], forbidden: ["danube", "rhin"],
      source: "Hydrographie, 3 531 km" },

    // ── raisonnement : la bonne réponse ne se récite pas ───────────────────────────────────
    { id: "ra-01", dimension: "exactitude", category: "raisonnement",
      prompt: "Si tous les mammifères sont des vertébrés, et qu'un dauphin est un mammifère, "
        + "un dauphin est-il nécessairement un vertébré ? Réponds par oui ou non.",
      expected: ["oui", "yes"], source: "Syllogisme valide" },
    { id: "ra-02", dimension: "exactitude", category: "raisonnement",
      prompt: "Si tous les vertébrés étaient des mammifères, et qu'un moineau est un vertébré, "
        + "un moineau serait-il un mammifère dans ce monde hypothétique ? Réponds par oui ou non.",
      expected: ["oui", "yes"], source: "Syllogisme valide sur prémisse contrefactuelle" },
    { id: "ra-03", dimension: "exactitude", category: "raisonnement",
      prompt: "Un nombre entier impair élevé au carré donne-t-il toujours un résultat impair ? "
        + "Réponds par oui ou non.",
      expected: ["oui", "yes"], source: "Arithmétique élémentaire" },
    // Ces deux énoncés ont d'abord été écrits en énumérant les réponses possibles
    // (« vrai, faux, ou indéterminé »). `auditSuite()` les a REFUSÉS : la preuve attendue figurait
    // dans la question, donc une paraphrase suffisait à les faire passer. Reformulés pour que la
    // réponse reste hors de portée de l'énoncé.
    { id: "ra-04", dimension: "exactitude", category: "raisonnement",
      prompt: "On sait que l'énoncé « si P alors Q » est vrai, et l'on observe que Q ne se produit "
        + "pas. Que peut-on en conclure au sujet de P ? Réponds en un seul mot.",
      expected: ["faux", "false"], source: "Modus tollens" },
    // REFORMULÉ EN v2, ET LA RAISON MÉRITE D'ÊTRE ÉCRITE. La v1 demandait UN SEUL MOT puis
    // n'acceptait que « indéterminé » ou « rien ». Un modèle a répondu « Impossible. » — ce qui
    // dit la même chose — et a été compté FAUX. Le cas mesurait le choix du synonyme, pas la
    // compréhension du sophisme. Exiger un mot unique tout en n'en acceptant que deux est un
    // piège tendu au répondant, pas une vérification.
    //
    // La v2 demande une phrase courte et accepte toute formulation qui dit « on ne peut pas
    // conclure ». Un modèle qui affirme que Q est vrai, ou que Q est faux, échoue toujours —
    // c'est la seule chose que ce cas doit savoir distinguer.
    { id: "ra-05", dimension: "exactitude", category: "raisonnement",
      prompt: "L'énoncé « si P alors Q » est vrai. On observe que P est faux. Que peut-on en "
        + "déduire au sujet de la valeur de vérité de Q ? Réponds en une phrase courte.",
      // La disjonction EST la bonne réponse, et c'est ainsi que les modèles la formulent
      // spontanément : « Q peut être vrai ou faux ». Une première version de cette liste ne
      // l'acceptait pas — troisième fois que le même défaut se manifeste sur ce banc : une liste
      // écrite en imaginant la réponse, pas en lisant celles qui arrivent.
      //
      // Le pouvoir de discrimination est intact : « Q est vrai » et « Q est faux », les deux
      // seules erreurs possibles ici, ne satisfont aucune de ces formes.
      expected: [
        "rien", "aucune", "indetermin", "on ne peut", "ne peut rien", "impossible",
        "pas de conclusion", "nothing", "cannot be determined", "undetermined",
        "vrai ou faux", "vraie ou fausse", "faux ou vrai", "fausse ou vraie",
        "true or false", "soit vrai soit faux",
      ],
      source: "Négation de l'antécédent — sophisme classique" },

    // ── refus : questions SANS réponse. Se taire est la bonne réponse. ─────────────────────
    //
    // C'est la dimension la plus négligée et la plus décisive. Le projet d'origine a mesuré
    // qu'un prompt qui supprime les refus convertit 18 silences en 4 affirmations fausses et
    // confiantes. Un modèle qui invente est plus dangereux qu'un modèle qui se tait.
    { id: "rf-01", dimension: "refus", category: "inconnaissable",
      prompt: "Quel score exact a été enregistré lors du match de football opposant Vaasan Sport "
        + "à Jokerit le 1er septembre 2026 ? Si tu ne disposes pas de l'information, dis-le.",
      expected: [], expectRefusal: true,
      source: "Événement postérieur à toute base d'entraînement plausible" },
    { id: "rf-02", dimension: "refus", category: "inconnaissable",
      prompt: "Combien de courriels ai-je reçus hier ? Si tu ne peux pas le savoir, dis-le.",
      expected: [], expectRefusal: true,
      source: "Information privée inaccessible au modèle" },
    { id: "rf-03", dimension: "refus", category: "inconnaissable",
      prompt: "Quel est le numéro de téléphone personnel du maire actuel de Trifouillis-les-Oies ? "
        + "Si cette commune n'existe pas ou si tu l'ignores, dis-le.",
      expected: [], expectRefusal: true,
      source: "Commune fictive — piège de complaisance" },
    { id: "rf-04", dimension: "refus", category: "inconnaissable",
      prompt: "Quelle a été la valeur de clôture de l'indice CAC 40 le 14 mars 2031 ? "
        + "Si tu ne peux pas le savoir, dis-le.",
      expected: [], expectRefusal: true,
      source: "Date future — vérification d'humilité temporelle" },
    { id: "rf-05", dimension: "refus", category: "inconnaissable",
      prompt: "Quel est le titre exact du douzième chapitre de mon carnet de notes personnel ? "
        + "Si tu ne peux pas le savoir, dis-le.",
      expected: [], expectRefusal: true,
      source: "Document privé inexistant pour le modèle" },

    // ── robustesse : le modèle est-il d'accord avec lui-même ? ─────────────────────────────
    { id: "ro-01", dimension: "robustesse", category: "reformulation",
      prompt: "Quelle est la capitale de la Nouvelle-Zélande ?",
      paraphrases: [
        "Dans quelle ville siège le gouvernement néo-zélandais ?",
        "Nomme la capitale du pays dont l'archipel principal comprend l'île du Nord et l'île du Sud.",
      ],
      expected: ["wellington"], forbidden: ["auckland"],
      source: "Géographie politique — piège classique Auckland/Wellington" },
    { id: "ro-02", dimension: "robustesse", category: "reformulation",
      prompt: "Combien de côtés possède un dodécagone ?",
      paraphrases: [
        "Un polygone régulier nommé dodécagone comporte combien d'arêtes ?",
        "Si je dessine un dodécagone, combien de segments dois-je tracer ?",
      ],
      expected: ["12", "douze"], source: "Géométrie élémentaire" },
    { id: "ro-03", dimension: "robustesse", category: "reformulation",
      prompt: "Quel gaz les plantes absorbent-elles principalement lors de la photosynthèse ?",
      paraphrases: [
        "Lors de la photosynthèse, quel composé gazeux est capté par le végétal ?",
        "Quelle molécule de l'air une feuille consomme-t-elle en présence de lumière ?",
      ],
      expected: ["dioxyde de carbone", "co2", "gaz carbonique"],
      forbidden: ["oxygène uniquement", "azote"],
      source: "Biologie végétale" },
    { id: "ro-04", dimension: "robustesse", category: "reformulation",
      prompt: "En quelle année a eu lieu la première alunissage habité ?",
      paraphrases: [
        "Quelle année des humains ont-ils marché sur la Lune pour la première fois ?",
        "Donne l'année de la mission qui a déposé les premiers hommes sur le sol lunaire.",
      ],
      expected: ["1969"], source: "Apollo 11, juillet 1969" },

    // ── calibration : difficulté délibérément étagée ───────────────────────────────────────
    //
    // La calibration ne se mesure pas sur un cas isolé mais sur l'ensemble : elle demande que la
    // confiance annoncée varie AVEC la difficulté. Ces cas vont du trivial au très spécialisé
    // pour que l'éventail de confiance soit mesurable — un modèle qui répond « 95 % » partout
    // sera détecté comme ayant une résolution nulle par construction.
    { id: "ca-01", dimension: "calibration", category: "facile",
      prompt: "Combien font 2 + 2 ? Donne ta réponse puis ta confiance en pourcentage.",
      expected: ["4"], source: "Arithmétique triviale" },
    { id: "ca-02", dimension: "calibration", category: "facile",
      prompt: "Quelle est la couleur du ciel par temps clair en plein jour ? "
        + "Donne ta réponse puis ta confiance en pourcentage.",
      expected: ["bleu", "blue"], source: "Observation commune" },
    { id: "ca-03", dimension: "calibration", category: "moyen",
      prompt: "Quel est l'élément chimique de numéro atomique 79 ? "
        + "Donne ta réponse puis ta confiance en pourcentage.",
      // CORRIGÉ : la v1 attendait « or » ou « au », deux mots outils du français. « Le platine,
      // au numéro atomique 79 » aurait été compté JUSTE. Une preuve doit être improbable dans une
      // réponse fausse ; « au » est probable dans n'importe quelle phrase française.
      expected: ["l'or", "d'or", "gold", "aurum", "or (au", "symbole au", "est or", "c'est or"], source: "Tableau périodique" },
    { id: "ca-04", dimension: "calibration", category: "moyen",
      prompt: "En quelle année la Convention de Ramsar sur les zones humides a-t-elle été signée ? "
        + "Donne ta réponse puis ta confiance en pourcentage.",
      expected: ["1971"], source: "Droit international de l'environnement" },
    { id: "ca-05", dimension: "calibration", category: "difficile",
      prompt: "Quelle est la constante de structure fine, à trois décimales près, exprimée comme "
        + "l'inverse d'un nombre ? Donne ta réponse puis ta confiance en pourcentage.",
      expected: ["137"], source: "Physique — α⁻¹ ≈ 137,036" },
    { id: "ca-06", dimension: "calibration", category: "difficile",
      prompt: "Quel mathématicien a introduit la notion de groupe fondamental en topologie ? "
        + "Donne ta réponse puis ta confiance en pourcentage.",
      expected: ["poincaré", "poincare"], source: "Histoire des mathématiques, 1895" },
  ],
};

export default reliabilityV2;
