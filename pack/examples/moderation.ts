// 5e adaptateur — cas inventé, écrit chronométré pour vérifier la promesse des 30 minutes.
//
// Cas : un LLM de modération décide si un message doit être escaladé à un humain. Le système
// courant est le modèle « gros » avec sa confiance ; la référence est le modèle « petit », moins
// cher, déjà en production.
//
// Question réelle : le gros modèle justifie-t-il son coût ?

import type { Adapter, Outcome, Prediction } from "../core/types.ts";

interface Message {
  id: string;
  text: string;
  /** Faut-il escalader ? Vérité terrain établie par un modérateur humain. */
  escalate: boolean;
  severity: "faible" | "moyenne" | "haute";
}

const MESSAGES: Message[] = [
  ["m01", "tu es vraiment nul, dégage d'ici", true, "haute"],
  ["m02", "merci beaucoup pour votre aide", false, "faible"],
  ["m03", "je vais te retrouver et tu vas comprendre", true, "haute"],
  ["m04", "quelqu'un sait comment faire un virement ?", false, "faible"],
  ["m05", "ce produit est une arnaque totale", false, "moyenne"],
  ["m06", "envoyez-moi vos identifiants en privé", true, "haute"],
  ["m07", "bonne journée à tous", false, "faible"],
  ["m08", "espèce de bon à rien, tu mérites rien", true, "haute"],
  ["m09", "le service client est lent mais correct", false, "faible"],
  ["m10", "cliquez ici pour gagner 1000 euros maintenant", true, "moyenne"],
  ["m11", "je suis déçu de ma commande", false, "faible"],
  ["m12", "tu ferais mieux de disparaître", true, "haute"],
  ["m13", "comment contacter le support ?", false, "faible"],
  ["m14", "achetez mes formations, lien en bio", true, "moyenne"],
  ["m15", "excellent, rien à redire", false, "faible"],
  ["m16", "vous êtes tous des incompétents finis", true, "moyenne"],
  ["m17", "livraison rapide, je recommande", false, "faible"],
  ["m18", "je connais ton adresse", true, "haute"],
  ["m19", "petit souci technique, rien de grave", false, "faible"],
  ["m20", "gagnez de l'argent facile, contactez-moi", true, "moyenne"],
  ["m21", "le tarif me semble élevé", false, "faible"],
  ["m22", "ferme ta bouche une bonne fois", true, "moyenne"],
  ["m23", "merci pour la réponse rapide", false, "faible"],
  ["m24", "je vais porter plainte contre vous", false, "moyenne"],
  ["m25", "crève, personne ne t'aime", true, "haute"],
  ["m26", "où est mon colis s'il vous plaît", false, "faible"],
  ["m27", "offre exceptionnelle, cliquez vite", true, "moyenne"],
  ["m28", "produit conforme à la description", false, "faible"],
  ["m29", "t'es qu'un déchet", true, "haute"],
  ["m30", "besoin d'aide pour l'installation", false, "faible"],
  ["m31", "votre entreprise devrait fermer", false, "moyenne"],
  ["m32", "je te promets que tu vas le regretter", true, "haute"],
  ["m33", "tout fonctionne parfaitement", false, "faible"],
  ["m34", "envoie ton numéro de carte pour vérifier", true, "haute"],
  ["m35", "un peu déçu mais ça ira", false, "faible"],
  ["m36", "bande d'abrutis incapables", true, "moyenne"],
  ["m37", "quel est le délai de rétractation", false, "faible"],
  ["m38", "argent rapide garanti, écris-moi", true, "moyenne"],
  ["m39", "service correct dans l'ensemble", false, "faible"],
  ["m40", "tu vas payer pour ça, je te préviens", true, "haute"],
  ["m41", "problème résolu, merci", false, "faible"],
  ["m42", "vous méritez de faire faillite", false, "moyenne"],
  ["m43", "sale type, tu me dégoûtes", true, "haute"],
  ["m44", "besoin d'une facture s'il vous plaît", false, "faible"],
  ["m45", "investissement garanti, message privé", true, "moyenne"],
  ["m46", "rien à signaler de particulier", false, "faible"],
  ["m47", "je vais tout casser chez vous", true, "haute"],
  ["m48", "comment modifier mon abonnement", false, "faible"],
  ["m49", "promo incroyable, dépêchez-vous", true, "moyenne"],
  ["m50", "satisfait de mon achat", false, "faible"],
].map(([id, text, escalate, severity]) => ({
  id: id as string,
  text: text as string,
  escalate: escalate as boolean,
  severity: severity as Message["severity"],
}));

const INSULTES = ["nul", "abruti", "incompétent", "déchet", "crève", "sale type", "bon à rien", "dégoût", "ferme ta"];
const MENACES = ["retrouver", "regretter", "payer pour", "connais ton adresse", "tout casser", "disparaître", "préviens"];
const ARNAQUES = ["identifiants", "carte", "cliquez", "gagnez", "argent facile", "argent rapide", "investissement", "promo", "formations", "offre exceptionnelle", "lien en bio"];

const hits = (t: string, ws: string[]) => ws.filter((w) => t.includes(w)).length;

/** SYSTÈME — le gros modèle : trois familles de signaux, confiance graduée. */
function bigModel(text: string): { escalate: boolean; confidence: number } {
  const t = text.toLowerCase();
  const score = hits(t, INSULTES) * 2 + hits(t, MENACES) * 2 + hits(t, ARNAQUES);
  if (score === 0) return { escalate: false, confidence: 0.88 };
  return { escalate: true, confidence: Math.min(0.96, 0.6 + score * 0.12) };
}

/** RÉFÉRENCE — le petit modèle déjà en production : insultes seulement, confiance plate. */
function smallModel(text: string): { escalate: boolean; confidence: number } {
  const t = text.toLowerCase();
  return hits(t, INSULTES) > 0
    ? { escalate: true, confidence: 0.75 }
    : { escalate: false, confidence: 0.75 };
}

export const moderationAdapter: Adapter<Message> = {
  name: "Modération — gros modèle contre petit modèle en production",

  async loadItems() {
    return MESSAGES;
  },

  async predict(item): Promise<Prediction> {
    const { escalate, confidence } = bigModel(item.text);
    return { pass: escalate === item.escalate, prob: confidence, raw: { escalader: escalate } };
  },

  async truth(item): Promise<Outcome> {
    return { ok: true, raw: { escalader_attendu: item.escalate } };
  },

  async baseline(item): Promise<Prediction> {
    const { escalate, confidence } = smallModel(item.text);
    return { pass: escalate === item.escalate, prob: confidence, raw: { escalader: escalate } };
  },

  category(item) {
    return item.severity;
  },
};

export default moderationAdapter;
