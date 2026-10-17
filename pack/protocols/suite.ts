// La suite de cas FIGÉE et VERSIONNÉE — le socle de toute comparaison entre modèles.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE PROBLÈME QUE CE MODULE RÉSOUT, ET IL EST PLUS GRAVE QU'IL N'EN A L'AIR.
//
// Comparer deux modèles n'a de sens que sur des cas IDENTIQUES. C'est évident dit ainsi, et
// pourtant c'est l'erreur la plus facile à commettre : on ajoute trois questions au fil de l'eau,
// on corrige une vérité terrain qui était fausse, on retire un cas devenu obsolète — et six mois
// plus tard on compare des chiffres qui ne portent plus sur la même chose. Personne ne s'en
// aperçoit, parce que rien ne casse.
//
// Les 7 exécutions déjà réalisées dans le projet d'origine en sont l'illustration : elles portent
// sur 18, 6, 6, 4, 1, 11 et 4 cas. Aucune n'est comparable à une autre. Ce ne sont pas de
// mauvaises mesures — ce sont des mesures dont la comparabilité n'a jamais été garantie.
//
// D'où les trois règles imposées ici :
//
//   1. Une suite porte un IDENTIFIANT et une VERSION. Les résultats les enregistrent.
//   2. Une suite porte une EMPREINTE calculée sur ses cas. Modifier un cas change l'empreinte.
//   3. Comparer deux exécutions d'empreintes différentes est REFUSÉ, pas averti.
//
// La règle 3 est la seule qui compte vraiment. Un avertissement se lit et s'oublie ; un refus
// oblige soit à republier les anciens résultats sur la nouvelle version, soit à renoncer à la
// comparaison. Les deux sont des issues honnêtes ; « comparer quand même » n'en est pas une.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

/** Les dimensions qu'une suite doit couvrir, telles que fixées par le protocole. */
/** Contraintes de forme vérifiables sans interprétation. */
export type ContrainteForme =
  | "json"            // la réponse entière se parse comme du JSON
  | "mot-unique"      // un seul mot, ponctuation finale tolérée
  | "sans-bloc-code"  // aucun ``` dans la réponse
  | "majuscules"      // aucune lettre minuscule
  | "une-ligne";      // aucun retour à la ligne

/**
 * Vérifie une contrainte de forme sur le texte BRUT — avant toute normalisation.
 *
 * Renvoie `null` si la contrainte est tenue, sinon la raison de l'échec.
 */
export function verifierForme(texte: string, contrainte: ContrainteForme): string | null {
  const t = texte.trim();
  switch (contrainte) {
    case "json":
      try {
        JSON.parse(t);
        return null;
      } catch {
        return "la réponse entière ne se parse pas comme du JSON";
      }
    case "mot-unique":
      return /^[^\s]+[.!?]?$/.test(t) ? null : "la réponse compte plus d'un mot";
    case "sans-bloc-code":
      return t.includes("```") ? "la réponse contient un bloc de code" : null;
    case "majuscules":
      return /[a-zà-öø-ÿ]/.test(t) ? "la réponse contient des minuscules" : null;
    case "une-ligne":
      return /\r?\n/.test(t) ? "la réponse tient sur plusieurs lignes" : null;
  }
}

export type Dimension =
  | "exactitude"      // fait vérifiable contre une vérité terrain
  | "calibration"     // le modèle sait-il quand il ne sait pas ?
  | "capacite"        // un outil fonctionne-t-il, outil par outil
  | "robustesse"      // même question reformulée, l'accord avec soi-même
  | "refus"           // sait-il se taire quand il ne sait pas ?
  | "code"            // lire du code et en prédire le comportement
  | "logique"         // déduction et énigmes à réponse unique
  | "maths"           // calcul exact, pas d'à-peu-près
  | "instruction";    // la consigne de FORME est-elle suivie à la lettre ?

/**
 * POURQUOI « CODE » SIGNIFIE LIRE DU CODE, ET NON EN ÉCRIRE.
 *
 * Évaluer du code écrit par un modèle demande de l'exécuter. Exécuter du code produit par un
 * modèle demande un bac à sable — la même raison qui tient la dimension `capacite` hors de ce
 * banc depuis la phase 3. Sans bac à sable, il resterait deux options, mauvaises toutes les deux :
 * exécuter le code sans protection, ou juger le code « à l'œil », c'est-à-dire ne rien mesurer.
 *
 * Lire du code et prédire sa sortie exacte se vérifie, lui, sans rien exécuter : la sortie est
 * connue. C'est une capacité plus étroite que « sait programmer », et le rapport doit le dire
 * plutôt que de laisser croire le contraire.
 */

/**
 * Un cas de la suite.
 *
 * `expected` et `forbidden` portent la VÉRIFICATION OBJECTIVE. Aucun champ ne permet d'écrire
 * « la réponse a l'air bonne » : c'est délibéré, et c'est la leçon n°5 de `PIEGES.md`.
 */
export interface SuiteCase {
  id: string;
  dimension: Dimension;
  /** Ce qu'on envoie au modèle, mot pour mot. */
  prompt: string;
  /**
   * La preuve attendue : au moins une de ces chaînes doit apparaître dans la réponse.
   *
   * RÈGLE D'OR, héritée d'un faux succès réel : **la preuve ne doit jamais être déductible de la
   * question**. Un test qui demande « exécute `echo JETON-4417` » puis cherche `JETON-4417` mesure
   * l'écho du prompt, pas l'exécution. `auditSuite()` ci-dessous vérifie mécaniquement cette
   * propriété sur toute la suite et refuse de la déclarer saine sinon.
   */
  expected: string[];
  /** Chaînes dont la présence signe un échec, même si `expected` est satisfait. */
  forbidden?: string[];
  /**
   * Contraintes de FORME, vérifiées mécaniquement sur le texte brut.
   *
   * POURQUOI CE CHAMP EXISTE. Une consigne de forme — « réponds en JSON », « un seul mot »,
   * « en majuscules » — ne se vérifie pas par recherche de chaîne. Le juge dépouille les accents
   * et met en minuscules avant de comparer : chercher « BLEU » ne dit donc rien de la casse, et
   * un cas qui prétendrait la tester mentirait. Soit on vérifie la forme pour de bon, soit on
   * n'écrit pas le cas.
   *
   * C'est la dimension la plus sous-estimée pour un usage quotidien : un modèle qui répond juste
   * mais jamais dans le format demandé casse tout ce qui lit sa sortie automatiquement.
   */
  format?: ContrainteForme[];
  /**
   * Justification écrite quand la preuve attendue figure VOLONTAIREMENT dans l'énoncé.
   *
   * IL EXISTE UNE CATÉGORIE QUE LE GARDE-FOU DE FUITE NE CONNAÎT PAS. « Réponds par
   * INDISPONIBLE si tu ne sais pas » : le mot attendu est dans la question, forcément, puisqu'il
   * est dicté. Recopier la consigne EST ici la compétence mesurée — l'échec est d'inventer un
   * chiffre à la place.
   *
   * Ce champ ne fait pas taire l'audit : il transforme le refus en AVERTISSEMENT qui cite la
   * justification. Le lecteur du rapport voit donc et la fuite, et la raison, et juge par
   * lui-même. Un drapeau qui supprimerait le signal serait un interrupteur pour désactiver le
   * seul garde-fou qui a déjà attrapé quatre erreurs dans cette suite.
   */
  justificationPreuveDansEnonce?: string;
  /**
   * Le cas attend-il un REFUS ? Un modèle qui invente sur une question sans réponse est plus
   * dangereux qu'un modèle qui se tait — c'est mesuré dans le projet d'origine.
   */
  expectRefusal?: boolean;
  /**
   * Sur ce cas, une réponse qui RESSEMBLE à un refus est une réponse comme une autre.
   *
   * QUATRIÈME INSTANCE DU MÊME DÉFAUT, trouvée sur une exécution réelle. Le cas `lo-05` propose
   * explicitement trois options : « oui, non, ou impossible à déterminer ». Un modèle qui répond
   * « impossible à déterminer » a CHOISI une option — et s'est trompé, puisque la réponse est
   * oui. Le juge y voyait un refus et le comptait à part, sous le motif « se taire n'est pas se
   * tromper ». Sauf qu'ici le modèle ne s'est pas tu : il a répondu, mal.
   *
   * Ce drapeau existe donc pour les cas dont l'énoncé OFFRE une option de la forme « on ne peut
   * pas savoir ». Il ne change rien au taux d'exactitude — un refus n'a jamais compté comme
   * juste — mais il cesse de décrire une erreur comme une prudence.
   */
  leRefusEstUneReponse?: boolean;
  /** Reformulations du même cas, pour mesurer l'accord du modèle avec lui-même. */
  paraphrases?: string[];
  /** Groupe d'appartenance, pour la ventilation. */
  category: string;
  /** D'où vient la vérité terrain. Une vérité sans provenance ne vaut rien. */
  source: string;
}

/** Une capacité volontairement NON testée, et la raison. Rendue telle quelle dans le rapport. */
export interface Exclusion {
  capability: string;
  reason: string;
}

export interface Suite {
  id: string;
  /** Entier, incrémenté à chaque modification des cas. Jamais réutilisé. */
  version: number;
  description: string;
  cases: SuiteCase[];
  /**
   * Capacités exclues du banc, avec la raison.
   *
   * Non négociable, repris de `bancCapacitesHermes.ts` : on ne déclenche jamais automatiquement
   * une capacité dont les effets survivent au test. Les exclusions apparaissent dans le rapport —
   * un banc qui tait ce qu'il ne teste pas laisse croire qu'il a tout testé.
   */
  exclusions: Exclusion[];
}

/**
 * L'empreinte des CAS, et d'eux seuls.
 *
 * Ne couvre ni la description, ni les exclusions, ni la version : seulement ce qui est envoyé au
 * modèle et ce qui sera vérifié. Corriger une faute de frappe dans la description ne doit pas
 * invalider six mois de résultats ; changer un prompt, si.
 */
export function suiteFingerprint(suite: Suite): string {
  const h = createHash("sha256");
  const SEP = "␟";
  const END = "␞";
  // Tri par identifiant : réordonner le fichier ne doit pas changer l'empreinte.
  for (const c of [...suite.cases].sort((a, b) => a.id.localeCompare(b.id))) {
    h.update(c.id);
    h.update(SEP);
    h.update(c.dimension);
    h.update(SEP);
    h.update(c.prompt);
    h.update(SEP);
    h.update([...c.expected].sort().join("|"));
    h.update(SEP);
    h.update([...(c.forbidden ?? [])].sort().join("|"));
    h.update(SEP);
    h.update(String(c.expectRefusal ?? false));
    h.update(SEP);
    h.update([...(c.paraphrases ?? [])].sort().join("|"));
    h.update(SEP);
    // Les contraintes de forme entrent dans l'empreinte : ce sont des critères de correction au
    // même titre que `expected`. En ajouter une change ce qui est mesuré.
    h.update([...(c.format ?? [])].sort().join("|"));
    h.update(SEP);
    h.update(String(c.leRefusEstUneReponse ?? false));
    h.update(END);
  }
  return h.digest("hex").slice(0, 16);
}

/** Un problème détecté dans une suite, avant même de la faire tourner. */
export interface SuiteFinding {
  severity: "bloquant" | "avertissement";
  caseId: string;
  problem: string;
}

/**
 * Audite une suite AVANT de dépenser le moindre appel de modèle.
 *
 * Le contrôle central est celui de la FUITE : une preuve attendue qui figure déjà dans le prompt
 * rend le test ininterprétable, parce qu'une simple reformulation le fait passer. C'est un faux
 * succès réel, documenté dans le projet d'origine : le test du terminal cherchait un jeton qui
 * était dans la question, et n'a jamais rien exécuté.
 *
 * Ce contrôle est mécanique, donc il ne s'oublie pas. C'est tout son intérêt : la vigilance
 * humaine sur ce point s'épuise en trois semaines.
 */
export function auditSuite(suite: Suite): SuiteFinding[] {
  const findings: SuiteFinding[] = [];
  const seen = new Set<string>();

  for (const c of suite.cases) {
    if (seen.has(c.id)) {
      findings.push({
        severity: "bloquant",
        caseId: c.id,
        problem: "Identifiant en double : deux cas ne peuvent pas partager un identifiant.",
      });
    }
    seen.add(c.id);

    if (c.expected.length === 0 && !c.expectRefusal) {
      findings.push({
        severity: "bloquant",
        caseId: c.id,
        problem:
          "Aucune preuve attendue et aucun refus attendu : ce cas n'a pas de vérification "
          + "objective, il ne peut être jugé qu'à l'œil.",
      });
    }

    // PREUVE TROP COURTE POUR ÊTRE DISCRIMINANTE — ajouté après un faux ACCEPT trouvé dans la
    // suite elle-même. Le cas « élément de numéro atomique 79 » attendait « or » ou « au » :
    // deux mots outils du français. « Le platine, au numéro atomique 79 » contient « au » et
    // aurait donc été compté JUSTE. La fuite de preuve fait échouer un bon modèle ; une preuve
    // d'une ou deux lettres fait RÉUSSIR un mauvais modèle, ce qui est le sens le plus coûteux.
    for (const e of c.expected) {
      const n = e.trim();
      // Restreint aux preuves ALPHABÉTIQUES. Un nombre court comme « 42 » est une preuve
      // parfaitement discriminante : une réponse fausse contient rarement le bon nombre comme
      // mot isolé. Ce sont les lettres qui posent problème, parce que les mots outils d'une
      // langue en sont faits. Un avertissement qui se déclenche sur six cas légitimes est un
      // avertissement que plus personne ne lit.
      if (n.length > 0 && n.length <= 2 && /^[a-zà-ÿ]+$/i.test(n)) {
        findings.push({
          severity: "avertissement",
          caseId: c.id,
          problem:
            `La preuve attendue « ${e} » ne fait que ${n.length} caractère(s). Une preuve aussi `
            + "courte a de fortes chances d'apparaître par hasard dans une réponse fausse — en "
            + "français, « or », « au », « on » sont des mots courants. Préférer une forme "
            + "distinctive (« l'or », « symbole au »), ou justifier ce cas par écrit.",
        });
      }
    }

    const haystack = [c.prompt, ...(c.paraphrases ?? [])].join(" ").toLowerCase();
    for (const e of c.expected) {
      const needle = e.toLowerCase().trim();
      // Les preuves très courtes sont exemptées, et c'est un choix argumenté, pas une commodité.
      //
      // Sur un cas à deux issues (« réponds par oui ou non »), les DEUX réponses figurent dans
      // l'énoncé : aucune ne confère d'avantage, et répondre au hasard reste faux une fois sur
      // deux. La fuite dangereuse est celle d'une preuve SPÉCIFIQUE et improbable — un jeton, un
      // nom propre, un nombre inhabituel — qu'une paraphrase suffit à recracher.
      //
      // Le seuil de 4 caractères sépare les deux cas sans prétendre être une frontière exacte :
      // il laisse passer « oui », « non », « 42 », et attrape « canberra », « JETON-4417 ».
      if (needle.length >= 4 && haystack.includes(needle)) {
        findings.push(c.justificationPreuveDansEnonce
          ? {
              severity: "avertissement",
              caseId: c.id,
              problem:
                `La preuve attendue « ${e} » figure dans la question, et c'est assumé : `
                + `${c.justificationPreuveDansEnonce}`,
            }
          : {
              severity: "bloquant",
              caseId: c.id,
              problem:
                `La preuve attendue « ${e} » figure déjà dans la question. Une reformulation `
                + "suffirait à faire passer le test sans que le modèle ait rien fait. Déplacer la "
                + "preuve hors de portée de l'énoncé.",
            });
      }
    }

    if (!c.source || c.source.trim() === "") {
      findings.push({
        severity: "avertissement",
        caseId: c.id,
        problem: "Vérité terrain sans provenance déclarée : elle n'est pas vérifiable par un tiers.",
      });
    }

    if (c.dimension === "robustesse" && (c.paraphrases ?? []).length === 0) {
      findings.push({
        severity: "bloquant",
        caseId: c.id,
        problem:
          "Cas de robustesse sans reformulation : il n'y a rien à comparer, la dimension n'est "
          + "pas mesurée.",
      });
    }
  }

  return findings;
}

/** Une suite est utilisable si aucun problème bloquant n'a été trouvé. */
export function isUsable(findings: SuiteFinding[]): boolean {
  return !findings.some((f) => f.severity === "bloquant");
}

/** L'identité complète d'une suite, telle qu'enregistrée dans chaque résultat d'exécution. */
export interface SuiteStamp {
  id: string;
  version: number;
  fingerprint: string;
  caseCount: number;
}

export function stamp(suite: Suite): SuiteStamp {
  return {
    id: suite.id,
    version: suite.version,
    fingerprint: suiteFingerprint(suite),
    caseCount: suite.cases.length,
  };
}

export type ComparabilityVerdict = "COMPARABLE" | "REFUSÉ";

export interface Comparability {
  verdict: ComparabilityVerdict;
  reason: string;
}

/**
 * Deux exécutions sont-elles comparables ?
 *
 * REFUSE, ne se contente pas d'avertir. Les deux issues honnêtes sont : rejouer l'ancien modèle
 * sur la nouvelle suite, ou renoncer à la comparaison. « Comparer quand même en gardant ça en
 * tête » n'en est pas une — c'est ainsi qu'on publie une régression qui n'existe pas.
 */
export function assertComparable(a: SuiteStamp, b: SuiteStamp): Comparability {
  if (a.id !== b.id) {
    return {
      verdict: "REFUSÉ",
      reason:
        `Suites différentes : « ${a.id} » contre « ${b.id} ». Ces deux exécutions ne portent pas `
        + "sur les mêmes questions ; les comparer ne mesurerait rien.",
    };
  }
  if (a.fingerprint !== b.fingerprint) {
    return {
      verdict: "REFUSÉ",
      reason:
        `Même suite « ${a.id} » mais empreintes différentes (v${a.version} → ${a.fingerprint} `
        + `contre v${b.version} → ${b.fingerprint}). Les cas ont changé entre les deux exécutions. `
        + "Deux issues honnêtes : rejouer l'ancien modèle sur la version courante, ou renoncer à "
        + "la comparaison. Il n'y en a pas de troisième.",
    };
  }
  return {
    verdict: "COMPARABLE",
    reason:
      `Même suite, même empreinte (${a.id} v${a.version}, ${a.fingerprint}, ${a.caseCount} cas). `
      + "Les deux exécutions portent exactement sur les mêmes questions.",
  };
}
