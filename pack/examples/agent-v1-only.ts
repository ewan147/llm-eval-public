// Le MÊME jeu de tâches, évalué avec la version PRÉCÉDENTE de l'agent en position de système.
//
// Sert à démontrer `eval-pack compare` : on enregistre une exécution de celui-ci, une exécution de
// `adapters/agent-task.ts`, et on compare les deux. Les prédictions diffèrent, le jeu de test est
// identique — donc l'empreinte des données est la même, et la dérive est attribuable au système.
//
// C'est exactement la situation réelle : « j'ai changé mon prompt, est-ce que ça a cassé quelque
// chose ? »

import { TASKS, type Task } from "../adapters/agent-task.ts";
import type { Adapter, Outcome, Prediction } from "../core/types.ts";

function titleCase(s: string): string {
  return s.replace(/(^|\s)(\S)/g, (_m, sp: string, c: string) => sp + c.toUpperCase());
}

/** La v1 : dates correctes, mais additions tronquées au-delà de 99. */
function agentV1(task: Task): string {
  switch (task.family) {
    case "extraction":
      return task.input.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? "";
    case "reformulation":
      return titleCase(task.input);
    case "calcul": {
      const nums = [...task.input.matchAll(/\d+/g)].map((m) => Number(m[0]));
      const sum = nums.reduce((a, b) => a + b, 0);
      return String(sum > 99 ? Number(String(sum).slice(0, 2)) : sum);
    }
    case "format": {
      const [d, m, y] = task.input.split("/");
      return `${y}-${m}-${d}`;
    }
  }
}

export const agentV1Adapter: Adapter<Task> = {
  name: "Agent de tâches — v1 seule",

  async loadItems() {
    return TASKS;
  },

  async predict(item): Promise<Prediction> {
    const got = agentV1(item);
    return { pass: got === item.expected, raw: got };
  },

  async truth(item): Promise<Outcome> {
    return { ok: true, raw: item.expected };
  },

  category(item) {
    return item.family;
  },
};

export default agentV1Adapter;
