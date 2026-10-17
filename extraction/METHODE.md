# MÉTHODE — évaluer un système probabiliste sans se raconter d'histoires

Ce document décrit une méthode d'évaluation et quatre pièges. Elle vient d'un projet réel de
42 jours et 225 commits, dont le moteur de prédiction s'est révélé **sans valeur** : il ne battait
pas sa référence. L'appareil de mesure construit autour, lui, a fait son travail — il a fini par le
prouver. C'est cet appareil qui est extrait ici.

Le critère de tri appliqué à chaque ligne du dépôt d'origine : *est-ce que ça reste vrai si je
remplace « match » par « réponse d'un modèle de langage » ?* Tout ce qui suit passe ce test.

Les chiffres cités sont **recalculés** dans [PREUVES.md](PREUVES.md), pas recopiés des commentaires
du dépôt d'origine.

---

## Ce qu'est un système probabiliste évaluable

Un système qui, sur des questions à issue binaire vérifiable, annonce une probabilité **avant** de
connaître l'issue. Un juge LLM qui note « cette réponse est correcte, confiance 0,8 ». Un
classifieur qui rend une probabilité. Un moteur de recherche qui ordonne. Un modèle météo. Un
pronostiqueur sportif.

L'unité de mesure est toujours la même :

```ts
{ prob: 0.72, outcome: true }
```

Tout le reste — `itemId`, `category`, `group`, `cohort`, `observedAt` — sert à découper, apparier,
et retrouver d'où vient une observation. Rien d'autre n'est nécessaire.

---

## Les quatre mesures, dans l'ordre où il faut les lire

### 0. La réconciliation, avant toute chose

*Ce qui était annoncé a-t-il laissé une trace ?* Voir [`src/reconcile.ts`](src/reconcile.ts).

Cette question précède toutes les autres, et elle est presque toujours sautée. Des métriques
calculées sur un journal incomplet sont justes, cohérentes, et fausses : elles ne mesurent que les
cas qui ont survécu au trajet. Un système d'évaluation qui perd 20 % de ses cas en route produit
des scores impeccables sur les 80 % restants, sans jamais dire lesquels manquent — et les cas
perdus ne le sont jamais au hasard.

`completeness()` répond en un nombre. Sous 1, **tout ce qui suit porte une réserve**.

### 1. La comparaison à une référence

*Mieux que quoi ?* Voir [`src/baseline.ts`](src/baseline.ts).

**Un score absolu ne dit rien.** Un Brier de 0,16 est excellent sur une question à 50/50 et
médiocre sur une question à 95/5 : sa valeur est d'abord celle de la difficulté du problème.

Il faut au moins **deux** références, jamais une seule :

- **la référence gratuite** — annoncer toujours le taux de base. Un système qui ne la bat pas
  n'apporte aucune information, quelle que soit sa sophistication ;
- **la référence externe** — l'estimation de quelqu'un d'autre sur les mêmes items : le prix d'un
  marché, un modèle concurrent, un annotateur humain, la version précédente du système.

La comparaison se fait **appariée**, item par item. Comparer deux scores globaux sans apparier
revient à comparer deux moyennes de populations différentes : l'écart réel se noie dans la variance
entre items. `compareToBaseline` rend l'écart apparié **avec son intervalle de confiance**, et
refuse de conclure quand l'intervalle contient zéro.

### 2. La décomposition

*Le système sait-il séparer les cas, ou répète-t-il la moyenne ?* Voir [`src/metrics.ts`](src/metrics.ts).

Décomposition de Murphy : **Brier = Fiabilité − Résolution + Incertitude**.

| terme | ce qu'il mesure | sens |
|---|---|---|
| Fiabilité | écart entre annoncé et réalisé, par tranche | plus bas = mieux |
| Résolution | de combien on s'écarte du taux de base, à raison | plus haut = mieux |
| Incertitude | le bruit irréductible du problème | ni bon ni mauvais |

Un prévisionniste n'est utile que si sa **résolution dépasse sa fiabilité**. Le score
`(résolution − fiabilité) / incertitude` met ça en un nombre.

*Réserve d'honnêteté, héritée du projet d'origine :* la décomposition exacte suppose des
probabilités discrètes. Le regroupement par tranche laisse de la variance intra-tranche, donc les
trois termes ne se recomposent pas au centième près. Les ordres de grandeur sont justes.

### 3. La calibration

*« 70 % » veut-il dire 70 % ?* Voir [`src/calibration.ts`](src/calibration.ts).

En dernier, parce que c'est la mesure la plus séduisante et la moins concluante. Elle produit une
courbe par tranche, un ECE, un MCE, et des découpages par famille et par cohorte.

Le **biais global** ne suffit jamais : une tranche surconfiante et une tranche sous-confiante
s'annulent. L'ECE, qui somme des valeurs absolues, ne se laisse pas compenser. Sur les données
extraites : biais global −0,42 pt (rassurant), ECE 2,5 % et MCE 6,8 % (moins rassurant), et un
écart de −7,0 points sur le décile 0,7–0,8.

---

## Les quatre pièges

Chacun a coûté des semaines. Chacun est un piège **général** d'évaluation, pas un piège de paris.

---

## Piège 1 — L'ancrage sur la référence

### Le mécanisme

Le système partait du prix affiché par la référence et le déplaçait de 1 à 3 points, en fonction de
ce qu'il croyait savoir en plus. C'est une démarche qui semble raisonnable : *pourquoi ignorer une
estimation que quelqu'un d'autre a déjà faite, et probablement bien faite ?*

Parce qu'un système qui **part** de la réponse d'une référence ne peut plus la battre. Il la
reproduit avec un peu de bruit en plus. Ce n'est pas un défaut de réglage : c'est une conséquence
arithmétique. Un déplacement de ±2 points sur une estimation déjà bonne produit, en moyenne, une
estimation légèrement moins bonne.

### La preuve chiffrée

Sur les 242 observations appariées à une référence externe :

| | système | référence |
|---|---|---|
| Brier | **0,158245** | **0,156981** |
| log-loss | 0,488602 | 0,485030 |

Écart apparié : **+0,001264 ± 0,002170**. L'intervalle contient zéro. **Indiscernable**, avec la
référence très légèrement devant.

Et surtout, l'ancrage mesuré **sans consulter une seule issue** :

```
écart médian |système − référence|    0,9 %
écart moyen                           1,4 %
corrélation                           0,9933
part à moins de 2 points             78,5 %
```

Le système est à moins d'un point de sa référence sur la moitié des items, à moins de deux points
sur 78,5 % d'entre eux, avec une corrélation de **0,9933**. Il ne l'approxime pas : il la recopie.

Le journal de leçons du projet d'origine documente le même constat, en langage métier
([`fixtures/lessons.json`](fixtures/lessons.json), entrée `2026-08-29-ancrage-marche-supprime-toute-valeur`) :
sur 170 événements, **zéro** occasion à espérance positive ; sur 621 observations réglées, **une**
seule occasion rétrospective. Le constat y est qualifié de « structurel et non conjoncturel ».

### La leçon générale

**Toujours mesurer contre une baseline, jamais seulement dans l'absolu.** Et mesurer l'ancrage,
qui ne demande aucune issue : deux séries d'estimations suffisent, donc la mesure est disponible
**dès le premier jour**, avant la première observation réglée.

Sur ces données, six semaines de travail auraient été économisées par ce seul chiffre : `0,9933`.

### Comment l'appliquer à un système de LLM

- Un juge LLM à qui l'on montre la réponse d'un autre juge est ancré. Mesurer la corrélation.
- Un modèle affiné à partir des sorties d'un modèle plus gros est ancré sur lui. Il ne le battra
  pas ; le comparer au petit modèle non affiné, pas au grand.
- Un système RAG dont la réponse reprend le premier document récupéré est ancré sur le
  récupérateur. Comparer au récupérateur seul.
- Un pipeline « modèle + post-traitement » doit être comparé au **modèle nu**, jamais seulement au
  hasard.

---

## Piège 2 — La calibration ne prouve rien à elle seule

### Le mécanisme

Le système était **bien calibré**. Biais global de −0,42 point, à peu près nul. Le tableau de bord
l'affichait, et l'affichait sincèrement.

Or on peut être parfaitement calibré et totalement inutile. Quelqu'un qui annonce toujours le taux
de base a une fiabilité impeccable et un pouvoir discriminant **nul** : il ne distingue jamais un
cas d'un autre. La calibration mesure si les étiquettes sont honnêtes ; elle ne dit rien sur le fait
qu'elles distinguent quoi que ce soit.

C'est la **résolution** qui distingue. Une calibration parfaite avec une résolution nulle décrit un
système qui ne sert à rien.

### La preuve chiffrée

Le test le plus court du dossier
([`tests/metrics.test.ts`](tests/metrics.test.ts), « démasque le prévisionniste PARFAITEMENT
calibré et totalement inutile ») :

```ts
// Il annonce toujours 50 % et réalise 50 %.
const o = Array.from({ length: 100 }, (_, i) => obs(0.5, i % 2 === 0));
bias      → 0        « bien calibré »
resolution → 0        ... et pourtant sans valeur
skill      → ≤ 0
```

### Le cas vicieux : le zéro par construction

Sur les données réelles, **quatre familles sur neuf affichent un biais rigoureusement nul** :

| famille | n | biais | structure conservée ? |
|---|---|---|---|
| group_01 | 931 | 0,0000 pt | **OUI (ordre 1, 348 items)** |
| group_08 | 303 | 0,0000 pt | **OUI (ordre 2, 101 items)** |
| group_05 | 198 | 0,0000 pt | **OUI (ordre 1, 99 items)** |
| group_06 | 10 | 0,0000 pt | **OUI (ordre 1, 5 items)** |

Ces zéros ne mesurent rien. Sur ces familles, la somme des probabilités d'un item égale le nombre
d'issues qui s'y réalisent — donc la moyenne annoncée égale la moyenne réalisée **quelles que
soient les probabilités**. Un générateur aléatoire obtiendrait le même zéro.

Le cas `group_08` est le plus retors : trois questions par item, **deux** se réalisent, les
probabilités somment à **exactement 2**. Rien n'y ressemble à une partition, et pourtant le biais
est nul par le même mécanisme. Le projet d'origine avait identifié le cas d'ordre 1 (leçon
`2026-09-02-biais-par-famille-structurellement-nul`) et pas celui-là.

`conservedStructure()` détecte les deux. Quand il répond oui, **la ligne « biais » de ce groupe est
à ignorer** — et le défaut est à chercher au croisement tranche × famille, qui n'a pas cette
propriété. Sur les données d'origine, ce croisement révélait +4,4 pt sur une tranche et −13,6 pt
sur une autre, là où la colonne « famille » affichait 1,67 × 10⁻¹⁶.

### La leçon générale

**Ne jamais conclure d'une seule métrique, et se demander de chaque zéro s'il est mesuré ou
mécanique.** Une métrique qui ne peut pas être mauvaise n'est pas une métrique.

### Comment l'appliquer à un système de LLM

- Un juge LLM bien calibré qui note tout à 0,7 est inutile. Mesurer la résolution.
- Une note moyenne conservée par construction (« exactement une des N réponses est correcte »)
  produit un biais nul mécanique. Découper autrement.
- Un banc d'évaluation dont le score ne peut pas descendre sous une valeur plancher ne mesure pas
  cette valeur plancher : il la décore.

---

## Piège 3 — Les données agrégées fabriquent de faux signaux

### Le mécanisme

Croiser des mesures issues de **sources différentes**, ou de **moments différents**, produit des
résultats spectaculaires et faux. Deux formes, toutes deux vérifiées ici.

**Forme A — la partition amputée.** On vérifie une propriété qui n'a de sens que si toutes les
issues d'une question sont présentes, et une issue manque sans qu'on le sache. La somme amputée
tombe sous le seuil, et l'anomalie apparaît partout.

**Forme B — la colonne agrégée.** Une source publie des colonnes « maximum tous fournisseurs
confondus ». Ces maximums viennent de fournisseurs différents, relevés à des instants différents,
et **n'ont jamais coexisté**. Les combiner produit des incohérences qui n'ont jamais été
disponibles.

### La preuve chiffrée

Sur 1 868 ensembles complets, sources réelles, une seule passe de collecte :

```
incohérences exploitables (≥ 0,5 %)      0
la plus proche manquait encore       1,50 point
surronde médiane des sources         9,34 %
```

**Zéro.** Les sources sont largement d'accord, et ce qui les sépare est très inférieur à leur marge
commune.

Maintenant, la forme A — **mêmes valeurs réelles**, on retire simplement l'issue la moins probable :

```
ensembles examinés         324
« gains garantis »         296   ← 91,4 % des ensembles, tous faux
le plus spectaculaire     37,4 % de gain garanti inexistant
```

**91,4 % des ensembles produisent un signal, jusqu'à +37,4 %, et aucun n'existe.** Les chiffres
n'ont pas changé ; seul l'appariement est faux.

La forme B, testée sur ces mêmes données (croisement de deux provenances relevées à des instants
différents), ne produit qu'**1 faux signal sur 330 ensembles, à 1,4 %**. Le mécanisme se déclenche
mais faiblement : la seconde provenance disponible ici est une **moyenne** de sources, pas un
maximum. La forme sévère du piège n'est pas reproductible sur ces fixtures — c'est signalé comme
tel dans PREUVES.md plutôt que présenté comme démontré.

Le dépôt d'origine documentait un cas réel de la forme A, sur données du 2026-09-03 : un marché à
trois issues dont une n'était pas lisible annonçait « +12,7 % garanti ». Sur un item réalisant
l'issue non lue, **les deux mises étaient perdues**.

### La leçon générale

**Une erreur de structure ne dégrade pas doucement un résultat : elle en fabrique un
spectaculaire.** Et un résultat spectaculaire est précisément celui qu'on n'a pas envie de
questionner.

Trois règles, toutes trois codées dans `referenceProbabilities` et dans les tests :

1. **N'accepter qu'une partition complète.** Une issue manquante ne dégrade pas la mesure, elle
   l'inverse. Dès qu'une valeur échappe au classement, écarter **le type entier** — on ignore à
   quelle question l'issue manquante appartenait.
2. **Ne jamais mélanger les provenances.** Chaque valeur voyage avec sa source, jusqu'à
   l'affichage. Les mesures par provenance restent séparées (voir PREUVES.md § 5b : deux
   provenances donnent des Brier de 0,153 et 0,161, et des écarts de **signes opposés**).
3. **Un signal manqué ne coûte rien ; un faux signal coûte tout.** Face à l'ambiguïté, renoncer.

### Comment l'appliquer à un système de LLM

- Agréger les scores de plusieurs juges relevés sur des versions différentes du modèle fabrique
  des écarts qui n'existent pas.
- Un banc dont les questions viennent de plusieurs jeux mesure la composition du mélange autant que
  le modèle. Rapporter par jeu, jamais seulement le total.
- Comparer un modèle A évalué en mars à un modèle B évalué en juin, sur « le même » banc qui a
  changé entre-temps : même piège, autre habillage.
- Un résultat trop beau est d'abord un bug de structure. Le chercher là avant de le publier.

---

## Piège 4 — L'absence d'horodatage par mesure

### Le mécanisme

Les valeurs de référence étaient horodatées **au niveau de l'item**, pas au niveau de la valeur.
Le fichier disait « ces cinq valeurs concernent l'item X, relevées vers telle heure ». Il ne disait
pas quand **chaque** valeur avait été lue, ni de quelle source elle venait exactement.

Conséquence : impossible de certifier la **simultanéité**. Et sans simultanéité, aucune conclusion
tirée d'une comparaison entre deux valeurs n'est défendable.

### La preuve chiffrée

```
items multi-sources                        514
  horodatés au niveau de l'ITEM            514
  horodatés au niveau de la VALEUR           0
références horodatées à l'item          52 / 161
références horodatées à la valeur        0 / 161
```

**Aucune valeur, dans aucune des deux sources, ne porte son propre horodatage.** Et 109 des 161
références n'en portent aucun, même au niveau de l'item.

Le zéro du piège 3 en devient **cohérent mais non certifiable**. S'il avait été un « un », on
n'aurait pas pu savoir si c'était une vraie incohérence ou un décalage entre deux relevés.

### La leçon générale

**Chaque observation doit porter son propre horodatage et sa propre source.** Pas l'objet qui la
contient : l'observation elle-même.

Ce n'est pas une exigence de propreté. C'est ce qui rend une mesure **réfutable** — et une mesure
non réfutable est le pire état possible pour une mesure, parce qu'elle a l'apparence complète d'un
résultat sans en avoir la substance. On ne peut ni la confirmer, ni la contredire, ni l'expliquer.

Le champ `observedAt` de [`src/types.ts`](src/types.ts) est là pour ça, et il est **par
observation**. Les fixtures conservent le défaut d'origine, et le déclarent :
`provenance.perValueTimestamp: false`.

### Comment l'appliquer à un système de LLM

- Chaque évaluation doit porter : quel modèle, quelle version, quel prompt, quelle température,
  quand. « GPT évalué en mars » n'est pas une provenance.
- Une réponse mise en cache et rejouée n'a pas l'horodatage de son rejeu. Le distinguer.
- Un banc dont les items ont été révisés entre deux exécutions produit une comparaison invalide, et
  sans horodatage par item on ne peut même pas le savoir après coup.
- Si deux mesures sont comparées, savoir si elles pouvaient coexister. Sinon, le dire.

---

## L'ordre de lecture d'un rapport

Voir [`src/report.ts`](src/report.ts). Trois règles, et elles ne sont pas cosmétiques.

**1. Le verdict le plus défavorable l'emporte.** Un système bien calibré, indiscernable de sa
référence, est **inutile** — pas « bien calibré, à améliorer ».

**2. Les réserves montent en haut.** Un échantillon insuffisant, une couverture partielle, un
ancrage détecté sont des raisons de **ne pas conclure**, pas des nuances de bas de page.

**3. Aucune formulation positive n'est atteignable sous le seuil d'observations.** « Pas encore
mesurable » est une réponse complète.

Sur les données extraites, les deux rapports possibles disent ceci :

> **Rapport ne lisant que la calibration :** biais global −0,42 pt, skill 29,2 % →
> « Utile : le système sépare réellement les issues. »

> **Rapport lisant aussi la baseline :** « SANS VALEUR DÉMONTRÉE : indiscernable de sa référence.
> Un système qui égale sa référence n'apporte rien. »

Les deux phrases décrivent **les mêmes données**. La seconde est vraie.

---

## La boucle d'auto-critique

[`fixtures/lessons.json`](fixtures/lessons.json) contient 42 entrées du journal d'auto-critique du
projet d'origine, conservées telles quelles. C'est le seul artefact du dossier qui n'a pas été
traduit en vocabulaire neutre : le neutraliser détruirait sa valeur de preuve.

La structure est ce qui compte, et elle est reproductible dans n'importe quel domaine :

```
observation  — ce qui a été constaté
evidence     — les CHIFFRES qui le soutiennent
action       — ce qui a été changé en conséquence
status       — ouverte | confirmee | appliquee | abandonnee
outcome      — ce qui a été constaté APRÈS l'action
```

Trois propriétés en font autre chose qu'un journal de bord :

1. **`evidence` est chiffré, toujours.** Une observation sans nombre n'entre pas.
2. **`status` peut valoir `abandonnee`.** Trois entrées sur 42 le sont : ce sont des constats que
   la mesure suivante a démentis. Une boucle qui ne peut pas se contredire n'apprend pas.
3. **`outcome` est rempli plus tard, par une autre mesure.** C'est ce qui ferme la boucle. Sans lui,
   on tient un journal ; on n'apprend pas.

Trois garde-fous encadrent le passage du constat à l'action
([`boundedAdjustment`](src/calibration.ts)) :

1. rien sous le seuil d'observations ;
2. rien si l'intervalle de confiance contient zéro ;
3. une **fraction** de l'effet mesuré, plafonnée.

Le troisième est le moins évident et le plus important : un ajustement qui croit la mesure sur
parole sur-corrige, et le réglage se met à osciller d'un passage à l'autre. On avance de la moitié
du chemin, on remesure, on recommence.

Et une interdiction, reprise telle quelle du projet d'origine : **la boucle ne touche jamais aux
probabilités**. Elle déplace des seuils de décision. Déplacer un seuil, c'est décider quand agir ;
déplacer une probabilité, c'est réécrire ce qu'on croit — et gonfler ses probabilités pour faire
apparaître de la valeur est l'erreur qui détruit ce genre de système.
