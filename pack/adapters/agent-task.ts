// ADAPTATEUR 2 — un agent qui accomplit une tâche : réussite ou échec.
//
// C'est le cas le plus courant, et le plus mal mesuré. « Mon agent réussit 82 % des tâches » se dit
// facilement ; ce que ça vaut se dit beaucoup moins.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// DEUX CHOSES QUE CE FICHIER MONTRE ET QU'ON OUBLIE PRESQUE TOUJOURS
//
// 1. Un taux de réussite sans intervalle ne veut rien dire. 20 réussites sur 20 ne prouvent pas
//    la perfection : l'intervalle de Wilson donne [83,9 % ; 100 %], donc un système qui échoue une
//    fois sur six reste compatible avec ce résultat.
//
// 2. Deux versions d'un agent à 80 % et 84 % peuvent être INDISCERNABLES si ce sont les mêmes
//    tâches qui échouent, et nettement différentes si ce ne sont pas les mêmes. Seul un test
//    apparié (McNemar) le dit — et c'est pour ça que `baseline` renvoie la version PRÉCÉDENTE
//    du prompt plutôt qu'un chiffre de la semaine dernière.
//
// La référence ici est la version précédente de l'agent. C'est la baseline la moins chère à
// obtenir : vous l'avez déjà, elle est dans votre historique git.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { Adapter, Outcome, Prediction } from "../core/types.ts";

export interface Task {
  id: string;
  /** L'instruction donnée à l'agent. */
  instruction: string;
  /** L'entrée sur laquelle il travaille. */
  input: string;
  /** La sortie attendue, exacte. */
  expected: string;
  /** Famille de tâche, pour la ventilation. */
  family: "extraction" | "reformulation" | "calcul" | "format";
}

export const TASKS: Task[] = buildTasks();

function buildTasks(): Task[] {
  const t: Task[] = [];
  const push = (family: Task["family"], instruction: string, input: string, expected: string) =>
    t.push({ id: `task_${String(t.length + 1).padStart(3, "0")}`, instruction, input, expected, family });

  // extraction : récupérer un champ dans une chaîne
  const emails = ["ana@site.fr", "bruno@ex.com", "cli@test.org", "dora@mail.net", "elio@corp.eu",
    "fay@shop.fr", "gil@app.io", "hana@lab.dev", "ivo@news.fr", "jo@studio.com"];
  for (const e of emails) {
    push("extraction", "Extraire l'adresse e-mail.", `Contactez-nous à ${e} avant vendredi.`, e);
  }

  // reformulation : mettre en majuscules la première lettre de chaque mot
  const phrases = ["bonjour le monde", "merci de votre retour", "commande expédiée hier",
    "veuillez patienter", "dossier clos", "reprise du service", "mise à jour prévue",
    "paiement accepté", "compte vérifié", "livraison retardée"];
  for (const p of phrases) {
    push("reformulation", "Mettre une majuscule à chaque mot.", p, titleCase(p));
  }

  // calcul : somme de deux entiers dans une phrase
  for (let i = 0; i < 10; i++) {
    const a = 7 + i * 13;
    const b = 4 + i * 9;
    push("calcul", "Donner la somme des deux nombres.", `Il y a ${a} unités puis ${b} unités.`, String(a + b));
  }

  // format : normaliser une date jj/mm/aaaa en aaaa-mm-jj
  const dates: Array<[string, string]> = [
    ["03/09/2026", "2026-09-03"], ["12/01/2025", "2025-01-12"], ["28/02/2024", "2024-02-28"],
    ["09/11/2026", "2026-11-09"], ["01/12/2023", "2023-12-01"], ["17/06/2025", "2025-06-17"],
    ["30/04/2026", "2026-04-30"], ["05/05/2025", "2025-05-05"], ["21/10/2024", "2024-10-21"],
    ["14/07/2026", "2026-07-14"],
  ];
  for (const [from, to] of dates) push("format", "Convertir la date en aaaa-mm-jj.", from, to);

  return t;
}

function titleCase(s: string): string {
  return s.replace(/(^|\s)(\S)/g, (_m, sp: string, c: string) => sp + c.toUpperCase());
}

/**
 * VERSION COURANTE DE L'AGENT — le point d'insertion.
 *
 * Remplacez ce corps par votre appel de modèle. Ce qui compte est ce que vous rendez : la sortie
 * produite. Le pack la comparera à `expected`.
 *
 * Ici, un agent déterministe qui sait faire les quatre familles, avec un défaut délibéré et
 * réaliste sur les dates : il échoue sur les jours et mois à un seul chiffre significatif, parce
 * qu'il ne remplit pas le zéro. C'est exactement le genre de défaut qu'une ventilation par famille
 * fait apparaître et qu'un taux global masque.
 */
function agentV2(task: Task): string {
  switch (task.family) {
    case "extraction":
      return task.input.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? "";
    case "reformulation":
      return titleCase(task.input);
    case "calcul": {
      const nums = [...task.input.matchAll(/\d+/g)].map((m) => Number(m[0]));
      return String(nums.reduce((a, b) => a + b, 0));
    }
    case "format": {
      const [d, m, y] = task.input.split("/");
      // Défaut assumé : pas de remplissage à deux chiffres.
      return `${y}-${Number(m)}-${Number(d)}`;
    }
  }
}

/**
 * VERSION PRÉCÉDENTE DE L'AGENT — la référence contrastive.
 *
 * Chez vous : l'ancien prompt, l'ancien modèle, ou le modèle moins cher. Vous l'avez déjà.
 *
 * Celle-ci convertit correctement les dates mais échoue sur les additions à plus de deux chiffres :
 * elle et la v2 échouent donc sur des tâches DIFFÉRENTES. C'est le cas intéressant — deux taux
 * proches, des erreurs disjointes, et seul un test apparié peut trancher.
 */
function agentV1(task: Task): string {
  switch (task.family) {
    case "extraction":
      return task.input.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? "";
    case "reformulation":
      return titleCase(task.input);
    case "calcul": {
      const nums = [...task.input.matchAll(/\d+/g)].map((m) => Number(m[0]));
      const sum = nums.reduce((a, b) => a + b, 0);
      // Défaut assumé : tronque au-delà de 99.
      return String(sum > 99 ? Number(String(sum).slice(0, 2)) : sum);
    }
    case "format": {
      const [d, m, y] = task.input.split("/");
      return `${y}-${m}-${d}`;
    }
  }
}

export const agentTaskAdapter: Adapter<Task> = {
  name: "Agent de tâches — v2 contre v1",

  async loadItems() {
    return TASKS;
  },

  // On rend un verdict direct : l'agent a-t-il produit la sortie attendue ? La sortie brute est
  // conservée dans `raw` pour que le rapport d'audit puisse montrer le défaut tel quel.
  async predict(item): Promise<Prediction> {
    const got = agentV2(item);
    return { pass: got === item.expected, raw: got };
  },

  // `ok: true` = « la tâche devait réussir ». Un cas de test négatif se déclarerait `ok: false`.
  async truth(item): Promise<Outcome> {
    return { ok: true, raw: item.expected };
  },

  async baseline(item): Promise<Prediction> {
    const got = agentV1(item);
    return { pass: got === item.expected, raw: got };
  },

  category(item) {
    return item.family;
  },
};

export default agentTaskAdapter;
