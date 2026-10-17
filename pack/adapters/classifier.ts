// ADAPTATEUR 1 — un LLM qui classe, avec une confiance.
//
// Cas typique : « ce ticket est-il une demande de remboursement, un bug, ou une question ? »,
// « ce commentaire est-il toxique ? », « ce document relève-t-il du service juridique ? ».
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QU'IL FAUT REMPLACER POUR L'UTILISER CHEZ VOUS
//
// Une seule fonction : `classify()`. Ici c'est un classifieur à mots-clés, déterministe et sans
// réseau, pour que l'exemple soit exécutable et reproductible. Chez vous, c'est votre appel de
// modèle — et il vit dans l'adaptateur, jamais dans `core/`.
//
// Le reste du fichier ne change pas.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { Adapter, Outcome, Prediction } from "../core/types.ts";

export interface Ticket {
  id: string;
  text: string;
  label: "remboursement" | "bug" | "question";
  /** Le canal d'où vient le ticket. Sert de segment pour la ventilation. */
  channel: "email" | "chat" | "téléphone";
}

/**
 * Le jeu de cas. Chez vous : un JSON, un CSV, une requête SQL.
 *
 * Volontairement déséquilibré (55 % de « question »), parce que c'est le cas réel : c'est ce
 * déséquilibre qui rend le plancher « répondre toujours la classe majoritaire » difficile à
 * battre, et qui fait qu'un taux de réussite brut de 60 % peut être un échec complet.
 */
export const TICKETS: Ticket[] = [
  { id: "t01", text: "Je veux être remboursé de ma commande annulée", label: "remboursement", channel: "email" },
  { id: "t02", text: "L'application plante quand j'ouvre mon panier", label: "bug", channel: "chat" },
  { id: "t03", text: "Quels sont vos horaires d'ouverture ?", label: "question", channel: "téléphone" },
  { id: "t04", text: "Le bouton payer ne fonctionne plus depuis la mise à jour", label: "bug", channel: "chat" },
  { id: "t05", text: "Comment fonctionne la garantie ?", label: "question", channel: "email" },
  { id: "t06", text: "Remboursement demandé, article jamais reçu", label: "remboursement", channel: "email" },
  { id: "t07", text: "Est-ce que vous livrez en Belgique ?", label: "question", channel: "chat" },
  { id: "t08", text: "Erreur 500 au moment de valider", label: "bug", channel: "chat" },
  { id: "t09", text: "Je souhaite connaître le délai de livraison", label: "question", channel: "téléphone" },
  { id: "t10", text: "Votre site m'a débité deux fois, je veux mon argent", label: "remboursement", channel: "email" },
  { id: "t11", text: "Puis-je changer mon adresse de livraison ?", label: "question", channel: "chat" },
  { id: "t12", text: "La page de connexion tourne en boucle", label: "bug", channel: "email" },
  { id: "t13", text: "Quel est le prix de l'abonnement annuel ?", label: "question", channel: "téléphone" },
  { id: "t14", text: "Article défectueux, je demande un remboursement complet", label: "remboursement", channel: "email" },
  { id: "t15", text: "Comment supprimer mon compte ?", label: "question", channel: "chat" },
  { id: "t16", text: "Le panier se vide tout seul", label: "bug", channel: "chat" },
  { id: "t17", text: "Vous acceptez les paiements en plusieurs fois ?", label: "question", channel: "téléphone" },
  { id: "t18", text: "Commande jamais livrée, remboursez-moi", label: "remboursement", channel: "email" },
  { id: "t19", text: "Où en est ma commande ?", label: "question", channel: "chat" },
  { id: "t20", text: "Impossible de télécharger ma facture", label: "bug", channel: "email" },
  { id: "t21", text: "Proposez-vous une réduction étudiante ?", label: "question", channel: "téléphone" },
  { id: "t22", text: "Je veux annuler et récupérer mon paiement", label: "remboursement", channel: "chat" },
  { id: "t23", text: "Quelle est la durée de la période d'essai ?", label: "question", channel: "email" },
  { id: "t24", text: "L'écran reste blanc après la connexion", label: "bug", channel: "chat" },
  { id: "t25", text: "Puis-je offrir un abonnement ?", label: "question", channel: "téléphone" },
  { id: "t26", text: "Produit non conforme, remboursement svp", label: "remboursement", channel: "email" },
  { id: "t27", text: "Comment contacter un conseiller ?", label: "question", channel: "téléphone" },
  { id: "t28", text: "La recherche ne renvoie aucun résultat", label: "bug", channel: "chat" },
  { id: "t29", text: "Vos produits sont-ils garantis deux ans ?", label: "question", channel: "email" },
  { id: "t30", text: "Je n'ai pas reçu mon colis, je demande un geste commercial", label: "remboursement", channel: "chat" },
  { id: "t31", text: "Peut-on modifier une commande déjà passée ?", label: "question", channel: "chat" },
  { id: "t32", text: "Notification reçue deux fois pour le même événement", label: "bug", channel: "email" },
  { id: "t33", text: "Quels moyens de paiement acceptez-vous ?", label: "question", channel: "téléphone" },
  { id: "t34", text: "Le montant débité ne correspond pas, je veux un retour", label: "remboursement", channel: "email" },
  { id: "t35", text: "Y a-t-il une application mobile ?", label: "question", channel: "chat" },
  { id: "t36", text: "Déconnexion automatique toutes les deux minutes", label: "bug", channel: "chat" },
  { id: "t37", text: "Comment suivre mon colis ?", label: "question", channel: "email" },
  { id: "t38", text: "Livraison en retard de trois semaines, remboursement", label: "remboursement", channel: "téléphone" },
  { id: "t39", text: "Le formulaire refuse mon code postal", label: "bug", channel: "email" },
  { id: "t40", text: "Faites-vous des factures au nom d'une société ?", label: "question", channel: "email" },
  { id: "t41", text: "Je veux résilier et être remboursé au prorata", label: "remboursement", channel: "chat" },
  { id: "t42", text: "Quelle taille choisir ?", label: "question", channel: "chat" },
  { id: "t43", text: "Le filtre par prix ne s'applique pas", label: "bug", channel: "chat" },
  { id: "t44", text: "Existe-t-il un programme de fidélité ?", label: "question", channel: "téléphone" },
  { id: "t45", text: "Colis arrivé cassé, je demande un remboursement", label: "remboursement", channel: "email" },
  { id: "t46", text: "Comment activer les notifications ?", label: "question", channel: "chat" },
  { id: "t47", text: "Les images ne se chargent pas sur mobile", label: "bug", channel: "chat" },
  { id: "t48", text: "Puis-je payer à la livraison ?", label: "question", channel: "téléphone" },
  { id: "t49", text: "Double facturation ce mois-ci, remboursez la seconde", label: "remboursement", channel: "email" },
  { id: "t50", text: "Où trouver les conditions générales ?", label: "question", channel: "email" },
  { id: "t51", text: "Mon panier affiche un prix différent au paiement", label: "bug", channel: "chat" },
  { id: "t52", text: "Faites-vous des cartes cadeaux ?", label: "question", channel: "chat" },
  { id: "t53", text: "Je conteste ce prélèvement et demande son annulation", label: "remboursement", channel: "téléphone" },
  { id: "t54", text: "À partir de quel montant la livraison est-elle offerte ?", label: "question", channel: "email" },
  { id: "t55", text: "Le code promo est refusé sans explication", label: "bug", channel: "chat" },
  { id: "t56", text: "Combien de temps dure la rétractation ?", label: "question", channel: "email" },
  { id: "t57", text: "Article manquant dans le colis, remboursement partiel", label: "remboursement", channel: "chat" },
  { id: "t58", text: "L'export CSV est vide", label: "bug", channel: "email" },
  { id: "t59", text: "Peut-on créer plusieurs profils ?", label: "question", channel: "chat" },
  { id: "t60", text: "Puis-je récupérer mon argent si je change d'avis ?", label: "remboursement", channel: "téléphone" },
];

type Label = Ticket["label"];

const KEYWORDS: Record<Label, string[]> = {
  remboursement: ["rembours", "annul", "argent", "débit", "prélèvement", "conteste", "geste commercial"],
  bug: ["plante", "erreur", "ne fonctionne", "boucle", "blanc", "vide", "refuse", "charge", "déconnexion", "différent"],
  question: ["comment", "quel", "quelle", "où", "est-ce que", "puis-je", "proposez", "acceptez", "existe", "y a-t-il", "combien", "faites-vous", "peut-on"],
};

/**
 * LE POINT D'INSERTION. Remplacez ce corps par votre appel de modèle.
 *
 * La seule chose qui compte est ce que vous rendez : une étiquette, et une confiance dans CETTE
 * étiquette. Si votre modèle ne rend pas de confiance, omettez `prob` — le pack le dira, et
 * expliquera ce que vous perdez : sans confiance, on sait si le système a raison, pas s'il sait
 * quand il a tort.
 */
function classify(text: string): { label: Label; confidence: number } {
  const t = text.toLowerCase();
  const scores = (Object.keys(KEYWORDS) as Label[]).map((label) => ({
    label,
    score: KEYWORDS[label].reduce((a, k) => a + (t.includes(k) ? 1 : 0), 0),
  }));
  scores.sort((a, b) => b.score - a.score);

  // Aucun indice : on répond la classe majoritaire, à faible confiance. C'est le comportement
  // honnête — et c'est aussi ce qui rend le système difficile à distinguer de son plancher.
  if (scores[0].score === 0) return { label: "question", confidence: 0.45 };

  const total = scores.reduce((a, s) => a + s.score, 0);
  const share = scores[0].score / total;
  // Confiance bornée à [0,5 ; 0,95] : annoncer 100 % sur un classifieur à mots-clés serait faux,
  // et la log-loss le punirait très durement — à juste titre.
  return { label: scores[0].label, confidence: Math.min(0.95, 0.5 + share * 0.45) };
}

/** La référence contrastive : répondre toujours la classe majoritaire. */
function majorityBaseline(): { label: Label; confidence: number } {
  const counts = new Map<Label, number>();
  for (const t of TICKETS) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
  const [label, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { label, confidence: n / TICKETS.length };
}

const MAJORITY = majorityBaseline();

export const classifierAdapter: Adapter<Ticket> = {
  name: "Classifieur de tickets (3 classes)",

  async loadItems() {
    return TICKETS;
  },

  async predict(item): Promise<Prediction> {
    const { label, confidence } = classify(item.text);
    return { label, prob: confidence, raw: { étiquette: label, confiance: confidence } };
  },

  async truth(item): Promise<Outcome> {
    return { label: item.label, raw: { étiquette_attendue: item.label } };
  },

  // Le plancher explicite : toujours la classe majoritaire, avec sa fréquence comme confiance.
  // C'est la référence la moins chère qui existe, et elle suffit à rendre un verdict.
  async baseline(): Promise<Prediction> {
    return { label: MAJORITY.label, prob: MAJORITY.confidence };
  },

  category(item) {
    return item.channel;
  },
};

export default classifierAdapter;
