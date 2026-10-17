# Évaluer ton système en 30 minutes

Tu écris **un fichier**. Le reste ne bouge jamais.

Prérequis : Node 22.6 ou plus récent. Aucune installation, aucune dépendance.

---

## Minute 0 — vérifier que ça tourne

```bash
node cli.ts run forecast
```

Tu dois voir un rapport se dérouler, avec en tête `[ÉQUIVALENT À LA RÉFÉRENCE]`. C'est un vrai
système de prédiction, mesuré sur ses vraies données, et le verdict est qu'il ne vaut rien de
démontrable. Si tu vois ça, le pack fonctionne.

---

## Minute 2 — la question à laquelle tu dois répondre AVANT d'écrire du code

**Mieux que quoi ?**

Ce n'est pas une formalité. Sans réponse, le pack refusera de te donner un verdict — pas un
avertissement poli, un refus affiché en première ligne. Il calculera tes métriques, et il écrira :

> Aucun verdict de compétence : sans baseline, une bonne calibration ne prouve rien.
> Fournissez une référence.

Voici la liste des références acceptées. **Il y en a toujours une** :

| référence | quand l'utiliser | coût |
|---|---|---|
| la version précédente (prompt, modèle, réglages) | tu itères sur un système existant | nul, c'est dans ton git |
| un modèle plus petit ou moins cher | tu veux justifier le coût du gros | un appel par cas |
| une méthode non apprise : règle, `grep`, heuristique | classification, récupération, extraction | quelques lignes |
| ton système sans son étage le plus cher | RAG désactivé, outil retiré, chaîne raccourcie | un booléen |
| une référence externe : autre fournisseur, jeu publié | tu as un point de comparaison public | variable |
| un humain, même sur 50 cas | rien d'autre n'existe | une demi-journée |

La quatrième ligne est celle qu'on oublie, et c'est souvent la plus instructive : **ton système
sans son étage le plus coûteux**. Si le RAG désactivé fait aussi bien, tu payes une base
vectorielle pour rien, et tu viens de l'apprendre en une heure.

---

## Minute 5 — les 4 méthodes à écrire

Crée `mon-adaptateur.ts` n'importe où. Voici le squelette complet :

```ts
import type { Adapter, Outcome, Prediction } from "./core/types.ts";

interface Cas {
  id: string;
  entree: string;
  attendu: string;
}

export const monAdaptateur: Adapter<Cas> = {
  name: "Mon système v3",

  // 1. Les cas à évaluer. Un JSON, un CSV, une requête SQL — ce que tu veux.
  async loadItems() {
    return JSON.parse(await readFile("mes-cas.json", "utf-8"));
  },

  // 2. Ce que dit ton système. C'EST ICI que ton appel de modèle vit.
  async predict(cas) {
    const reponse = await monLLM(cas.entree);
    return { label: reponse.texte, prob: reponse.confiance };
  },

  // 3. Ce qu'il fallait répondre.
  async truth(cas) {
    return { label: cas.attendu };
  },

  // 4. Ce qu'aurait répondu la référence, sur le MÊME cas.
  async baseline(cas) {
    const reponse = await monAncienPrompt(cas.entree);
    return { label: reponse.texte, prob: reponse.confiance };
  },

  // Facultatif, mais c'est la ligne la plus rentable du fichier.
  category(cas) {
    return cas.type;
  },
};

export default monAdaptateur;
```

C'est tout. Il n'y a pas de cinquième méthode, et il n'y en aura jamais.

---

## Minute 10 — choisir comment dire « le système a eu raison »

Quatre façons, selon ce que ton système produit. Le pack détecte laquelle tu utilises.

| ton système produit… | `predict` rend | `truth` rend | mode |
|---|---|---|---|
| une classe, une étiquette | `{ label, prob }` | `{ label }` | étiquettes |
| un succès / échec que tu juges toi-même | `{ pass, prob }` | `{ ok: true }` | verdict direct |
| une liste ordonnée de documents | `{ ranking }` | `{ relevant: [...] }` | récupération@k |
| une probabilité d'événement futur | `{ prob }` | `{ ok }` | événement |

**Le champ `prob` est la confiance dans la réponse que tu viens de donner** — pas la probabilité
d'une classe fixée d'avance. Si ton modèle répond « spam » à 90 %, c'est
`{ label: "spam", prob: 0.9 }`.

Tu peux l'omettre. Le pack te dira alors, dans les réserves :

> Le système ne produit aucune confiance chiffrée : calibration, ECE et décomposition sont
> indisponibles. On sait s'il a raison, pas s'il sait quand il a tort — c'est-à-dire qu'on ne peut
> pas décider quand lui faire confiance.

Ajoute `raw:` avec la sortie brute. Ça ne change aucun calcul, mais c'est ce qui rend chaque défaut
reproductible dans le rapport d'audit.

---

## Minute 20 — lancer

```bash
node cli.ts run ./mon-adaptateur.ts
```

Trois formats depuis la même exécution :

```bash
node cli.ts run ./mon-adaptateur.ts --format md --out rapport.md
node cli.ts run ./mon-adaptateur.ts --format html --out rapport.html
node cli.ts audit ./mon-adaptateur.ts --client "Direction" --out audit.html
```

Le mode `audit` produit un fichier HTML autonome : page de garde, verdict, défauts classés par
gravité et reproductibles un par un, réserves méthodologiques, et ce qu'il faudrait mesurer
ensuite. Aucune dépendance réseau : il s'ouvre hors ligne et s'imprime.

---

## Minute 25 — lire le verdict

Cinq verdicts possibles. Trois sont des refus déguisés, et c'est voulu.

| verdict | ce que ça veut dire | ce qu'il faut faire |
|---|---|---|
| **REFUS** | tu n'as pas fourni de référence | en fournir une, n'importe laquelle |
| **INDÉCIDABLE** | aucune différence détectée, mais le test était trop faible pour en détecter une | ajouter des cas |
| **ÉQUIVALENT** | aucune différence, sur un échantillon suffisant | ton système n'apporte rien de démontré |
| **BAT** | l'écart avec la référence ne s'explique pas par le hasard | c'est un vrai résultat |
| **MOINS BON** | la référence fait mieux, de façon mesurable | déployer la référence |

**INDÉCIDABLE et ÉQUIVALENT ne sont pas la même chose**, et confondre les deux est l'erreur qui a
donné naissance à ce pack. « Je n'ai pas trouvé de différence » sur 40 cas ne veut pas dire « il
n'y en a pas ». Absence de preuve n'est pas preuve d'absence.

---

## Minute 28 — les deux blocs à ne pas sauter

### L'ancrage

```
ancrage (mesuré sans consulter les vérités terrain)
  écart médian           1.0 %
  corrélation            0.9932
```

Il répond à : *est-ce que mon système reproduit sa référence au lieu de raisonner ?* Une
corrélation au-dessus de 0,98 avec un écart médian sous 1 point signifie que ton système **ne peut
pas** battre sa référence, quel que soit le réglage.

Ce bloc **ne consulte aucune vérité terrain**. Deux séries d'estimations suffisent. Tu peux donc
l'obtenir le premier jour, avant d'avoir un seul résultat. Sur le projet dont ce pack est issu, ce
chiffre — 0,9933 — aurait économisé six semaines.

### Les réserves

Elles ne sont jamais vides, et elles font partie du résultat. Elles disent ce que la mesure ne dit
pas : les cas exclus, les segments trop minces, ce qui n'a pas été mesuré du tout (latence, coût,
robustesse, comportement en production).

---

## Minute 30 — le brancher sur la CI

```bash
node cli.ts run ./mon-adaptateur.ts --save runs/$(git rev-parse --short HEAD).json
```

`run` sort en **code 1** quand le pack refuse de conclure ou quand ton système est mesuré moins bon
que sa référence. Aucun script d'analyse à écrire.

Et pour détecter une dégradation entre deux versions :

```bash
node cli.ts compare runs/abc123.json runs/def456.json
```

`compare` apparie les cas par identifiant, teste l'écart par McNemar, et **nomme les régressions**.
Il refuse de parler de dérive si les empreintes de données diffèrent — parce qu'alors tu compares
deux jeux de test, pas deux versions d'un système.

---

## Minute 32 — quand le pack dit INDÉCIDABLE

Il ne s'arrête plus là. Il te dit combien de cas il te faut :

```
CE QU'IL FAUDRAIT POUR TRANCHER
puissance atteinte       55.9 %

Il faut environ 77 cas pour trancher, contre 40 disponibles — soit 37 à ajouter.
```

Deux lectures possibles, et il faut savoir les distinguer :

- **« il te faut 77 cas »** → va en chercher 37 de plus, la question est tranchable.
- **« aucun cas discordant : les deux systèmes se trompent exactement sur les mêmes cas »** → aucun
  volume n'y changera rien. Ton système et ta référence font la même chose. Change de référence, ou
  accepte que ton système n'apporte rien.

La deuxième réponse est la plus utile, et c'est celle qu'aucun seuil ne pouvait donner.

---

## Si tu évalues avec un LLM juge

Alors ton juge est un système, et il s'évalue avec le même adaptateur à quatre méthodes :

```ts
async predict(cas) { return { label: await monJuge(cas.reponse), prob: confiance }; }
async truth(cas)   { return { label: cas.verdictHumain }; }
async baseline(cas){ return { label: cas.bienEcrite ? "correcte" : "incorrecte", prob: 0.7 }; }
```

La référence proposée ici — « accepte tout ce qui est bien formulé » — est délibérément stupide.
Si ton juge ne la bat pas nettement, c'est qu'il note la fluidité et non le fond. C'est le mode
d'échec le mieux documenté des juges LLM.

Puis lance l'analyse propre au juge :

```bash
node examples/judge-and-pipeline.ts
```

Elle ajoute deux choses que le rapport standard ne donne pas :

**Le kappa de Cohen.** Un accord brut de 90 % sur un jeu à 90 % de bonnes réponses vaut zéro : un
juge qui répond toujours « correcte » l'obtient. Le kappa retire ce que le hasard explique.

**Les faux acceptés.** Les réponses fausses que ton juge a validées. C'est la seule catégorie
d'erreur réellement coûteuse : un juge trop sévère te fait perdre du temps, un juge trop indulgent
envoie du faux en production sans que rien ne s'allume.

---

## Si ton système a plusieurs étages

Récupérateur → générateur → juge, ou n'importe quelle chaîne. Mesure ce que chaque étage ajoute :

```ts
import { pipelineAnchoring, ablationInstruction } from "./core/pipeline.ts";

const r = pipelineAnchoring([
  { name: "récupérateur", values: scoresRecup, cost: 1 },
  { name: "générateur", values: scoresGen, cost: 10 },
  { name: "juge", values: scoresJuge, cost: 8 },
]);
console.log(r.verdict);
console.log(ablationInstruction(r));
```

`values` est une valeur par cas et par étage — confiance, score, ce que tu veux, tant que c'est
comparable. **Aucune vérité terrain n'est nécessaire.** Un étage signalé RELAIS est un candidat à
la suppression, et `ablationInstruction()` te donne l'expérience exacte qui le confirme.

---

## Tester un MODÈLE, et pas seulement ton système

Le pack embarque une suite de 32 questions **figée et versionnée**. Tu peux la pointer sur
n'importe quel modèle sans écrire une ligne :

```bash
node cli.ts protocol ping ollama:qwen3:4b     # répond-il seulement ?
node cli.ts protocol run ollama:qwen3:4b      # les 32 cas, sous plafond de budget
```

Fournisseurs : `ollama:` (local, aucune clé), `openai:` (toute API compatible), `anthropic:`, et
`replay:` pour rejuger des réponses enregistrées sans dépenser un jeton. Les clés sont lues
**uniquement** dans l'environnement, jamais ailleurs.

Puis, pour décider d'un changement de modèle :

```bash
node cli.ts protocol compare avant.json apres.json
```

Tu obtiens `MIGRER`, `ATTENDRE` ou `NE PAS MIGRER`, **et surtout la liste nommée des cas qui
marchaient et ne marchent plus**. C'est cette liste qui décide, pas le score global : un gain de
8 points qui casse ton seul cas critique est une mauvaise migration pour toi.

### Deux refus à connaître

**Suite modifiée → comparaison refusée.** Changer un seul énoncé change l'empreinte de la suite.
Le pack refuse alors de comparer, il n'avertit pas. Les deux issues honnêtes : rejouer l'ancien
modèle sur la suite courante, ou renoncer.

**Juge modifié → comparaison refusée aussi.** Élargir ce qui compte comme un refus valide change
les verdicts sans toucher une question. La version du juge voyage donc avec chaque exécution.

## Le score public

```bash
node cli.ts scorecard mon-adaptateur.ts
```

Produit une fiche lisible sans culture statistique, plus un bêtisier reproductible. Règle stricte :
le format public **ne recalcule rien**. Il lit le même objet que le rapport technique et le
traduit. Chaque note affiche la métrique exacte dont elle sort, et un contrôle mécanique refuse de
publier si les deux lectures se contredisent.

Quand une donnée manque, la fiche affiche **« pas assez de données »** — jamais une estimation
pour faire joli, et jamais un seuil assoupli par rapport au rapport technique.

---

## Les erreurs qui coûtent cher

1. **Mesurer dans l'absolu.** Un score seul ne dit rien. Le pack refuse pour cette raison.
2. **Confondre « pas de différence détectée » et « pas de différence ».** Regarde le nombre de cas.
3. **Lire un taux sans son intervalle.** 20 réussites sur 20 donnent [83,9 % ; 100 %] : un système
   qui échoue une fois sur six reste compatible avec ce résultat.
4. **Conclure sur un segment de 5 cas.** Le pack les affiche nommés dans « écartés pour échantillon
   insuffisant », précisément pour que tu ne le fasses pas.
5. **Se satisfaire de battre le hasard.** C'est nécessaire, jamais suffisant. Le système d'origine
   battait le taux de base de 29,2 % et ne valait rien.

---

## Et après

- [ADAPTER-GUIDE.md](ADAPTER-GUIDE.md) — un adaptateur commenté ligne à ligne, et les pièges.
- `node cli.ts run <adaptateur> --lang en` — les rapports en anglais.
- [../extraction/METHODE.md](../extraction/METHODE.md) — les quatre pièges d'évaluation, avec les
  chiffres qui les prouvent.
