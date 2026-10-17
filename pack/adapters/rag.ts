// ADAPTATEUR 3 — qualité de récupération documentaire : le bon document est-il dans les k premiers ?
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA BASELINE QUI DÉRANGE, ET POURQUOI C'EST CELLE-LÀ QU'IL FAUT
//
// La référence ici est une recherche lexicale ordinaire — comptage de mots, sans plongement, sans
// modèle, sans index vectoriel. Elle coûte zéro euro et tourne en une milliseconde.
//
// C'est la comparaison que les projets RAG évitent, et c'est exactement pour ça qu'elle est le
// bon plancher : si votre récupération sémantique ne bat pas un `grep` pondéré de façon mesurable,
// vous payez une base vectorielle pour rien. Le pack ne vous dira pas si c'est le cas — il vous
// dira si vous pouvez le DÉMONTRER.
//
// Point d'insertion : `retrieveSemantic()`. Chez vous, c'est votre appel d'embeddings + votre
// index. Le reste ne change pas.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { Adapter, Outcome, Prediction } from "../core/types.ts";

export interface Doc {
  id: string;
  text: string;
}

export interface Query {
  id: string;
  question: string;
  /** Les identifiants de documents qui répondent réellement. */
  relevant: string[];
  /** Type de question, pour la ventilation. */
  kind: "factuelle" | "procédurale" | "reformulée";
}

/** Le corpus. Chez vous : votre base documentaire. */
export const CORPUS: Doc[] = [
  { id: "d01", text: "Les remboursements sont traités sous 14 jours ouvrés après réception du colis retourné." },
  { id: "d02", text: "La garantie légale de conformité couvre les défauts pendant deux ans à compter de la livraison." },
  { id: "d03", text: "Pour réinitialiser votre mot de passe, cliquez sur mot de passe oublié puis suivez le lien reçu par courriel." },
  { id: "d04", text: "Les frais de port sont offerts à partir de 49 euros d'achat en France métropolitaine." },
  { id: "d05", text: "Le délai de rétractation est de 14 jours calendaires à compter de la réception de la commande." },
  { id: "d06", text: "Nous livrons en Belgique, au Luxembourg et en Suisse avec un supplément de 8 euros." },
  { id: "d07", text: "Pour supprimer votre compte, rendez-vous dans Paramètres puis Confidentialité puis Supprimer le compte." },
  { id: "d08", text: "Les paiements sont acceptés par carte bancaire, virement et portefeuille électronique." },
  { id: "d09", text: "Un paiement en trois fois sans frais est disponible pour les commandes supérieures à 100 euros." },
  { id: "d10", text: "Le suivi de colis est accessible depuis votre espace client, rubrique Mes commandes." },
  { id: "d11", text: "Les factures sont téléchargeables au format PDF depuis l'historique des commandes." },
  { id: "d12", text: "Notre service client répond du lundi au vendredi de 9 heures à 18 heures." },
  { id: "d13", text: "Les cartes cadeaux sont valables douze mois et ne sont pas remboursables." },
  { id: "d14", text: "Le programme de fidélité attribue un point par euro dépensé, converti en bon d'achat." },
  { id: "d15", text: "Une commande peut être modifiée tant qu'elle n'est pas passée au statut expédiée." },
  { id: "d16", text: "Les articles soldés bénéficient des mêmes conditions de retour que les articles au prix courant." },
  { id: "d17", text: "L'application mobile est disponible sur iOS et Android depuis les boutiques officielles." },
  { id: "d18", text: "Les données personnelles sont conservées trois ans après le dernier achat." },
  { id: "d19", text: "Un colis endommagé doit être signalé sous 48 heures avec photographies à l'appui." },
  { id: "d20", text: "La facturation au nom d'une société nécessite de renseigner le numéro de TVA intracommunautaire." },
];

/**
 * Les requêtes. Trois familles délibérées :
 *   - factuelle    : les mots de la question sont dans le document. Le lexical y excelle.
 *   - procédurale  : la question demande une marche à suivre.
 *   - reformulée   : AUCUN mot en commun avec le document attendu. C'est là, et seulement là,
 *                    qu'une récupération sémantique peut gagner quelque chose.
 *
 * Cette répartition est le vrai sujet : sans ventilation par famille, un gain réel sur les
 * reformulées se noierait dans un match nul sur les factuelles.
 */
export const QUERIES: Query[] = [
  { id: "q01", question: "Combien de temps pour être remboursé ?", relevant: ["d01"], kind: "factuelle" },
  { id: "q02", question: "Quelle est la durée de la garantie ?", relevant: ["d02"], kind: "factuelle" },
  { id: "q03", question: "Comment réinitialiser mon mot de passe ?", relevant: ["d03"], kind: "procédurale" },
  { id: "q04", question: "À partir de quel montant les frais de port sont offerts ?", relevant: ["d04"], kind: "factuelle" },
  { id: "q05", question: "Quel est le délai de rétractation ?", relevant: ["d05"], kind: "factuelle" },
  { id: "q06", question: "Livrez-vous à l'étranger ?", relevant: ["d06"], kind: "reformulée" },
  { id: "q07", question: "Comment supprimer mon compte ?", relevant: ["d07"], kind: "procédurale" },
  { id: "q08", question: "Quels moyens de paiement acceptez-vous ?", relevant: ["d08"], kind: "factuelle" },
  { id: "q09", question: "Puis-je étaler mon règlement ?", relevant: ["d09"], kind: "reformulée" },
  { id: "q10", question: "Où voir où en est mon colis ?", relevant: ["d10"], kind: "procédurale" },
  { id: "q11", question: "Comment obtenir ma facture ?", relevant: ["d11"], kind: "procédurale" },
  { id: "q12", question: "Quels sont vos horaires ?", relevant: ["d12"], kind: "factuelle" },
  { id: "q13", question: "Une carte cadeau expire-t-elle ?", relevant: ["d13"], kind: "factuelle" },
  { id: "q14", question: "Comment fonctionne le programme de fidélité ?", relevant: ["d14"], kind: "procédurale" },
  { id: "q15", question: "Puis-je changer ma commande ?", relevant: ["d15"], kind: "factuelle" },
  { id: "q16", question: "Les promotions sont-elles reprises ?", relevant: ["d16"], kind: "reformulée" },
  { id: "q17", question: "Existe-t-il une application ?", relevant: ["d17"], kind: "factuelle" },
  { id: "q18", question: "Combien de temps gardez-vous mes informations ?", relevant: ["d18"], kind: "reformulée" },
  { id: "q19", question: "Que faire si le colis arrive cassé ?", relevant: ["d19"], kind: "procédurale" },
  { id: "q20", question: "Facture pour une entreprise, que faut-il ?", relevant: ["d20"], kind: "reformulée" },
  { id: "q21", question: "Je veux récupérer mon argent, quel délai ?", relevant: ["d01"], kind: "reformulée" },
  { id: "q22", question: "Mon article est défectueux, suis-je couvert ?", relevant: ["d02"], kind: "reformulée" },
  { id: "q23", question: "J'ai oublié mes identifiants", relevant: ["d03"], kind: "reformulée" },
  { id: "q24", question: "Comment éviter de payer la livraison ?", relevant: ["d04"], kind: "reformulée" },
  { id: "q25", question: "Puis-je annuler après réception ?", relevant: ["d05"], kind: "reformulée" },
  { id: "q26", question: "Frais pour la Suisse ?", relevant: ["d06"], kind: "factuelle" },
  { id: "q27", question: "Effacer mes données de compte", relevant: ["d07"], kind: "reformulée" },
  { id: "q28", question: "Acceptez-vous le virement ?", relevant: ["d08"], kind: "factuelle" },
  { id: "q29", question: "Paiement en trois fois, conditions ?", relevant: ["d09"], kind: "factuelle" },
  { id: "q30", question: "Numéro de suivi introuvable", relevant: ["d10"], kind: "reformulée" },
  { id: "q31", question: "Télécharger un PDF de ma commande", relevant: ["d11"], kind: "factuelle" },
  { id: "q32", question: "Joignable le samedi ?", relevant: ["d12"], kind: "reformulée" },
  { id: "q33", question: "Remboursement d'une carte cadeau", relevant: ["d13"], kind: "factuelle" },
  { id: "q34", question: "Comment gagner des points ?", relevant: ["d14"], kind: "reformulée" },
  { id: "q35", question: "Modifier une adresse après validation", relevant: ["d15"], kind: "reformulée" },
  { id: "q36", question: "Retour d'un article en solde", relevant: ["d16"], kind: "factuelle" },
  { id: "q37", question: "Application Android disponible ?", relevant: ["d17"], kind: "factuelle" },
  { id: "q38", question: "Durée de conservation des données personnelles", relevant: ["d18"], kind: "factuelle" },
  { id: "q39", question: "Colis abîmé à la livraison, délai pour signaler", relevant: ["d19"], kind: "factuelle" },
  { id: "q40", question: "TVA intracommunautaire sur facture", relevant: ["d20"], kind: "factuelle" },
];

const STOP = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "à", "au", "aux",
  "je", "mon", "ma", "mes", "il", "elle", "on", "vous", "est", "sont", "que", "qui", "quoi", "quel",
  "quelle", "quels", "comment", "où", "pour", "par", "sur", "dans", "avec", "sans", "ce", "cet",
  "cette", "combien", "puis", "faut", "y", "a", "t", "d", "l", "n", "se", "si", "ne", "pas", "plus"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Racine grossière : suffit à rapprocher « rembourser » et « remboursement ». */
function stem(w: string): string {
  return w.replace(/(ements?|ations?|ements|ance|ence|eurs?|euse|ives?|ings?|es|s)$/i, "").slice(0, 7);
}

const DF = (() => {
  const df = new Map<string, number>();
  for (const d of CORPUS) {
    for (const w of new Set(tokens(d.text).map(stem))) df.set(w, (df.get(w) ?? 0) + 1);
  }
  return df;
})();

function idf(w: string): number {
  return Math.log(1 + CORPUS.length / (1 + (DF.get(w) ?? 0)));
}

/** RÉFÉRENCE — recherche lexicale nue : chevauchement de mots pondéré par IDF. Zéro modèle. */
function retrieveLexical(question: string): string[] {
  const q = tokens(question).map(stem);
  return CORPUS.map((d) => {
    const words = new Set(tokens(d.text).map(stem));
    const score = q.reduce((a, w) => a + (words.has(w) ? idf(w) : 0), 0);
    return { id: d.id, score };
  })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}

/**
 * SYSTÈME — le point d'insertion. Remplacez par votre récupération sémantique.
 *
 * Ici : le lexical, plus un petit lexique de synonymes qui joue le rôle du plongement. C'est
 * déterministe, sans réseau, et honnête sur ce que c'est — un substitut d'exemple, pas un modèle.
 */
const SYNONYMS: Record<string, string[]> = {
  argent: ["rembours"], recuper: ["rembours"], etranger: ["belgiqu", "luxembo", "suiss", "livron"],
  couvert: ["garanti", "defaut"], defectu: ["garanti", "defaut"], identif: ["passe", "reinitia"],
  oublie: ["passe", "reinitia"], effacer: ["supprim", "compte"], donnees: ["personne", "conserv"],
  informa: ["personne", "conserv"], etaler: ["trois", "trois fois", "frais"], reglement: ["paiement"],
  promoti: ["solde"], repris: ["retour"], entrepr: ["societ", "tva"], eviter: ["offert", "port"],
  annuler: ["retract"], introuv: ["suivi", "espace"], samedi: ["horair", "lundi", "vendred"],
  gagner: ["fidelit", "point"], point: ["fidelit"], adresse: ["modifi", "command"],
};

function retrieveSemantic(question: string): string[] {
  const q = tokens(question).map(stem);
  const expanded = [...q];
  for (const w of q) for (const s of SYNONYMS[w] ?? []) expanded.push(stem(s));

  return CORPUS.map((d) => {
    const words = new Set(tokens(d.text).map(stem));
    let score = 0;
    for (const w of expanded) if (words.has(w)) score += idf(w);
    // Petit bonus de couverture : un document qui touche plusieurs mots de la requête passe devant
    // un document qui en touche un seul mais très rare.
    const hits = new Set(expanded.filter((w) => words.has(w))).size;
    return { id: d.id, score: score + hits * 0.15 };
  })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}

export const ragAdapter: Adapter<Query> = {
  name: "Récupération documentaire — sémantique contre lexicale",

  async loadItems() {
    return QUERIES;
  },

  // On rend l'ordre complet : le pack coupe aux k premiers (option --k, 5 par défaut).
  async predict(item): Promise<Prediction> {
    const ranking = retrieveSemantic(item.question);
    return { ranking, raw: ranking.slice(0, 5) };
  },

  async truth(item): Promise<Outcome> {
    return { relevant: item.relevant, raw: item.relevant };
  },

  async baseline(item): Promise<Prediction> {
    const ranking = retrieveLexical(item.question);
    return { ranking, raw: ranking.slice(0, 5) };
  },

  category(item) {
    return item.kind;
  },
};

export default ragAdapter;
