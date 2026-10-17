# Écrire son adaptateur

L'adaptateur est la seule chose que tu écris. Il fait le pont entre **ton** système et un cœur qui
ne sait rien de ton domaine.

---

## Le contrat, en entier

```ts
export interface Adapter<TItem> {
  name: string;
  loadItems(): Promise<TItem[]>;
  predict(item: TItem): Promise<Prediction>;
  truth(item: TItem): Promise<Outcome>;
  baseline?(item: TItem): Promise<Prediction>;
  category?(item: TItem): string;
}
```

Quatre membres obligatoires, deux facultatifs. **L'interface ne grandira pas.** Si tu es tenté
d'ajouter une cinquième méthode, c'est que la complexité doit aller dans `core/` — ouvre une issue
plutôt que d'élargir le contrat.

`TItem` est ton type à toi. Le cœur ne le regarde jamais : il le transporte de `loadItems` vers
`predict`, `truth`, `baseline` et `category`, et le conserve tel quel pour l'afficher dans les
défauts. Mets-y ce que tu veux.

---

## Un adaptateur commenté, ligne à ligne

Celui-ci est réel et exécutable : `adapters/classifier.ts`, réduit à l'essentiel.

```ts
import type { Adapter, Outcome, Prediction } from "../core/types.ts";

// ① Ton type de cas. Aucune contrainte : le cœur ne l'inspecte pas.
interface Ticket {
  id: string;
  text: string;
  label: "remboursement" | "bug" | "question";
  channel: "email" | "chat" | "téléphone";
}

export const classifierAdapter: Adapter<Ticket> = {
  // ② Le nom apparaît en tête de chaque rapport. Mets-y la VERSION : tu compareras
  //    des exécutions dans six mois et tu voudras savoir laquelle était laquelle.
  name: "Classifieur de tickets (3 classes)",

  // ③ Appelée UNE fois. Charge depuis où tu veux — fichier, base, API.
  //    Le pack ne met rien en cache : si c'est lent, c'est ici qu'il faut regarder.
  async loadItems() {
    return TICKETS;
  },

  // ④ LE POINT D'INSERTION. Ton appel de modèle vit ici, et nulle part ailleurs.
  //    `label` = la réponse donnée. `prob` = la confiance DANS CETTE RÉPONSE.
  //    `raw` = la sortie brute ; elle ne change aucun calcul, mais c'est elle qui
  //    rend un défaut reproductible dans le rapport d'audit.
  async predict(item): Promise<Prediction> {
    const { label, confidence } = classify(item.text);
    return { label, prob: confidence, raw: { étiquette: label, confiance: confidence } };
  },

  // ⑤ La vérité terrain. Ici une étiquette ; le pack comparera les deux.
  async truth(item): Promise<Outcome> {
    return { label: item.label, raw: { étiquette_attendue: item.label } };
  },

  // ⑥ La référence, sur LE MÊME cas. Sans elle : aucun verdict.
  //    Ici, le plancher le moins cher qui existe — toujours répondre la classe
  //    la plus fréquente. Ça suffit à obtenir un verdict.
  async baseline(): Promise<Prediction> {
    return { label: MAJORITY.label, prob: MAJORITY.confidence };
  },

  // ⑦ Le segment. Une ligne, et elle transforme « le système réussit 78 % » en
  //    « le système échoue sur telle famille de cas ».
  category(item) {
    return item.channel;
  },
};

export default classifierAdapter;
```

---

## Les quatre façons de dire « il a eu raison »

Le cœur ramène tout à une paire (confiance, correct). Tu choisis la forme qui correspond à ton
système ; le pack détecte laquelle et l'affiche sous `mode(s) de résolution`.

### 1. Étiquettes — classification, extraction, choix

```ts
async predict(item) { return { label: "spam", prob: 0.9 }; }
async truth(item)   { return { label: item.vraieClasse }; }
```

Correct si les étiquettes coïncident. La comparaison ignore la casse, les accents Unicode
composés et les espaces multiples.

### 2. Verdict direct — agents, tâches, pipelines

```ts
async predict(item) {
  const sortie = await monAgent(item.instruction);
  return { pass: sortie === item.attendu, raw: sortie };
}
async truth(item) { return { ok: true, raw: item.attendu }; }
```

C'est toi qui juges, dans `predict`. `truth` dit ce qui **devait** arriver : `ok: true` pour « la
tâche devait réussir ». Un cas de test négatif — l'agent doit refuser — s'écrit `ok: false`.

Quand `pass` est présent, `prob` est la confiance dans **ce verdict tel qu'énoncé**. Si tu réponds
`pass: false` avec `prob: 0.9`, ça veut dire « je suis sûr à 90 % que ça a échoué ».

### 3. Récupération@k — RAG, recherche, reclassement

```ts
async predict(item) { return { ranking: await monIndex.chercher(item.question) }; }
async truth(item)   { return { relevant: item.bonsDocuments }; }
```

Rends la liste **complète et ordonnée** ; le pack coupe aux `k` premiers (`--k`, 5 par défaut).
Correct si au moins un document pertinent est dans les `k` premiers.

### 4. Événement — prévision probabiliste

```ts
async predict(item) { return { prob: 0.72 }; }
async truth(item)   { return { ok: item.sEstProduit }; }
```

Ici `prob` est P(événement), et `correct` est « l'événement a eu lieu ». C'est la convention
classique du score de Brier.

**Attention** : dans ce mode, le pack n'affiche **aucun taux de réussite**, et c'est délibéré. La
« réussite » y serait la fréquence de survenue de l'événement — identique pour ton système et pour
sa référence, donc un écart nul et une comparaison vide de sens. Toute la qualité est dans la
probabilité.

---

## La référence : sept façons d'en avoir une

C'est la seule partie qui demande de réfléchir. Par ordre croissant de coût :

**1. La version précédente.** Elle est dans ton git.

```ts
async baseline(item) {
  return { label: await ancienPrompt(item.text), prob: 0.5 };
}
```

**2. Ton système amputé de son étage le plus cher.** Souvent le plus instructif.

```ts
async baseline(item) {
  return { label: await monLLM(item.question, { rag: false }) };
}
```

**3. Un modèle plus petit.** Répond à « le gros justifie-t-il son coût ? ».

**4. Une méthode non apprise.** Une règle, un `grep` pondéré, une heuristique. C'est la
comparaison que les projets évitent, donc c'est souvent la bonne.

**5. Le plancher trivial explicite.** Toujours la classe majoritaire. Deux lignes.

**6. Une référence externe.** Autre fournisseur, jeu de référence publié.

**7. Un humain**, même sur 50 cas tirés au sort.

### Quand la référence n'a rien à dire

Renvoie un objet vide. Le cas sera compté **non apparié**, jamais en erreur :

```ts
async baseline(item) {
  const r = await maReference(item);
  return r ? { label: r.texte, prob: r.confiance } : {};
}
```

Le nombre de non-appariés remonte dans les réserves, parce qu'un cas sans référence n'est presque
jamais absent au hasard : ce sont souvent les plus difficiles.

---

## Les pièges

### Ne pas faire l'appel de modèle dans `loadItems`

`loadItems` charge les **cas**, pas les réponses. Appeler ton modèle là-bas casse la concurrence et
mélange le chargement et la mesure.

### Ne pas laisser fuiter la vérité dans `predict`

```ts
// FAUX — le système ne peut pas connaître la réponse
async predict(item) {
  return { label: item.attendu, prob: 0.99 };
}
```

Ça a l'air évident écrit ainsi. C'est beaucoup moins visible quand la fuite passe par un champ
calculé en amont, ou par un prompt qui contient l'étiquette. Symptôme dans le rapport : un score
quasi parfait et une résolution anormalement haute.

### Ne pas renvoyer une confiance constante

Une seule valeur de confiance donne une résolution **nulle par construction**. Le pack le signale :

> Le système n'utilise qu'une seule tranche de confiance : sa résolution est nulle PAR
> CONSTRUCTION, pas par défaut de qualité.

### Ne pas oublier `category`

C'est une ligne, et c'est ce qui distingue « mon système réussit 78 % » de « mon système échoue sur
les dates ». Sur l'adaptateur `agent-task` livré ici, la ventilation isole immédiatement la famille
`format` comme seule source d'échecs.

### Ne pas confondre `prob` et « probabilité de la classe positive »

`prob` est la confiance dans **la réponse donnée**, quelle qu'elle soit. Un classifieur qui répond
« non-spam » à 95 % écrit `{ label: "non-spam", prob: 0.95 }`, pas `{ prob: 0.05 }`.

---

## Le cas particulier : évaluer un juge

Si ton système est noté par un LLM juge, ce juge est lui-même un système non mesuré — et c'est
généralement le maillon le moins vérifié de la chaîne, alors que c'est lui qui produit tous les
chiffres.

Il entre dans le même contrat, sans méthode supplémentaire :

| | |
|---|---|
| `predict` | le verdict du juge automatique |
| `truth` | le verdict de l'annotateur humain |
| `baseline` | un juge trivial — « accepte tout ce qui est bien formulé » |

Cette référence-là est choisie exprès : si ton juge ne la bat pas nettement, il note la forme et
non le fond. Voir `adapters/judge.ts`, exécutable tel quel.

Deux mesures spécifiques vivent dans `core/agreement.ts`, parce que le rapport standard ne les
couvre pas :

```ts
import { agreement, falseAccepts } from "./core/agreement.ts";

const a = agreement(pairs);         // kappa de Cohen : l'accord une fois le hasard retiré
const fa = falseAccepts(pairs, "correcte");  // les réponses fausses que le juge a validées
```

## Le cas particulier : un pipeline à plusieurs étages

`core/pipeline.ts` mesure ce que chaque étage ajoute au précédent, **sans aucune vérité terrain** :

```ts
const r = pipelineAnchoring([
  { name: "récupérateur", values: scoresRecup, cost: 1 },
  { name: "reclassement", values: scoresRerank, cost: 6 },
]);
```

Un étage marqué RELAIS reproduit son prédécesseur. Ce n'est pas la preuve qu'il est inutile — un
étage de sécurité qui ne se déclenche jamais sur un jeu propre paraîtra redondant sans l'être. C'est
la désignation d'un suspect, et `ablationInstruction()` donne l'expérience qui tranche.

## Options utiles

```bash
--min-obs 50        # relever le seuil de conclusion par tranche (défaut 30)
--k 3               # profondeur de la récupération@k (défaut 5)
--bins 0,0.5,1      # coupures de confiance sur mesure (défaut : déciles)
--bootstrap 5000    # intervalles plus stables, plus lent (défaut 2000)
--seed 42           # graine ; à seed égale, mêmes intervalles
--concurrency 4     # limiter les appels parallèles (défaut 8)
--save run.json     # sauvegarder pour `compare` plus tard
--defects           # ajouter la liste des défauts au rapport
--lang fr|en        # langue des rapports (défaut : fr)
```

`--concurrency` est celle qu'on cherche en premier : le pack appelle ton adaptateur 8 fois en
parallèle par défaut, ce qui peut dépasser le quota d'une API.

---

## Vérifier son adaptateur

Trois signes qu'il est correct :

1. **`mode(s) de résolution`** affiche ce que tu attendais. Si tu voulais des étiquettes et que tu
   lis `verdict-direct`, c'est que tu as rempli `pass` par mégarde — il est prioritaire.
2. **`cas évalués`** égale le nombre de cas chargés. Sinon, des `predict` lèvent : le compte
   d'erreurs et la réserve correspondante te le disent.
3. **L'ancrage** est faible entre ton système et une référence *censée* être indépendante. Une
   corrélation de 0,99 avec une référence que tu croyais indépendante signale une fuite.

---

## Un exemple complet à copier

`examples/moderation.ts` : un cas inventé de bout en bout — LLM de modération contre le petit
modèle déjà en production. 118 lignes dont 55 de jeu de données, donc **une soixantaine de lignes
d'adaptateur réel**. Il tourne tel quel :

```bash
node cli.ts run examples/moderation.ts
```

Les quatre adaptateurs de `adapters/` sont exécutables de la même façon et couvrent les quatre
modes de résolution.
