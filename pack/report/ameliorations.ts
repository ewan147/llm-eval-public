// Les points d'amélioration : que faire du résultat.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// UN RAPPORT QUI NE DIT PAS QUOI FAIRE LAISSE SON LECTEUR SEUL.
//
// Une évaluation qui s'arrête au verdict a rempli la moitié de son contrat. « MOINS BON que sa
// référence » est vrai, utile, et ne dit pas par où commencer. Ce module conclut : il transforme
// ce qui a été mesuré en une liste ordonnée d'actions.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA RÈGLE QUI GOUVERNE CE FICHIER, ET C'EST LA SEULE QUI COMPTE.
//
// **Chaque point d'amélioration cite le chiffre qui le déclenche.** Aucun conseil n'existe sans
// une mesure qui le porte, et le champ `preuve` nomme cette mesure.
//
// C'est ici que ce projet risquait le plus. Un générateur de recommandations est la porte grande
// ouverte au conseil plausible : « améliorez votre couverture de test », « surveillez la
// robustesse », « pensez au coût » — des phrases vraies partout, donc utiles nulle part, et que
// rien dans les données ne justifie. Elles ont l'autorité d'un rapport de mesure sans en avoir la
// substance, ce qui est pire que le silence.
//
// Donc : pas de catalogue de bonnes pratiques. Une règle par point, chaque règle déclenchée par
// une condition vérifiable sur le résultat, et rien quand rien ne se déclenche. Une évaluation
// qui ne produit aucun point d'amélioration est un résultat en soi — pas un échec du module.
// ═════════════════════════════════════════════════════════════════════════════════════════════

import { t } from "../core/i18n.ts";
import type { EvalResult } from "../core/evaluate.ts";

/**
 * Priorité d'un point.
 *
 * `bloquant` ne veut pas dire « grave », il veut dire : tant que ce n'est pas réglé, les chiffres
 * de ce rapport ne veulent pas dire ce qu'on croit. Ces points passent donc avant toute
 * amélioration du système lui-même — corriger un système sur la foi d'une mesure fausse est la
 * façon la plus coûteuse de perdre du temps.
 */
export type Priorite = "bloquant" | "important" | "utile";

export interface Amelioration {
  priorite: Priorite;
  /** Ce qu'il faut faire, en une ligne, à l'impératif. */
  titre: string;
  /** Le FAIT mesuré qui déclenche ce point. Jamais une opinion. */
  constat: string;
  /** Pourquoi ça compte, et ce que ça change. */
  pourquoi: string;
  /** La mesure exacte d'où vient le constat. Rend le point contestable. */
  preuve: string;
}

const ORDRE: Record<Priorite, number> = { bloquant: 0, important: 1, utile: 2 };

/**
 * Déduit les points d'amélioration d'un résultat d'évaluation.
 *
 * Ne consulte QUE `r`. Aucune connaissance du domaine, aucun catalogue : si un conseil ne peut
 * pas être rattaché à un champ du résultat, il n'apparaît pas.
 */
export function ameliorations(r: EvalResult): Amelioration[] {
  const out: Amelioration[] = [];
  const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
  const aReserve = (motif: RegExp) => r.reservations.some((x) => motif.test(x));

  // ── BLOQUANTS : tant qu'ils tiennent, les chiffres ne disent pas ce qu'on croit ─────────────

  if (r.refusal) {
    out.push({
      priorite: "bloquant",
      titre: t({
        fr: "Écrire une référence, même bête",
        en: "Write a baseline, however dumb",
      }),
      constat: t({
        fr: "Aucune référence n'a répondu : le pack refuse de dire si ce système est compétent.",
        en: "No baseline answered: the pack refuses to judge competence.",
      }),
      pourquoi: t({
        fr: "C'est la seule réserve que vous pouvez lever vous-même, et celle qui débloque tout le "
          + "reste. Un taux de réussite ne veut rien dire tant qu'on ignore ce qu'aurait donné la "
          + "méthode la plus simple : répondre toujours la classe majoritaire, reprendre la valeur "
          + "d'hier, suivre la tendance. Dix lignes suffisent.",
        en: "It is the only reservation you can lift yourself, and it unlocks everything else.",
      }),
      preuve: "EvalResult.refusal",
    });
  }

  if (aReserve(/baseline\(\) a échoué/)) {
    out.push({
      priorite: "bloquant",
      titre: t({ fr: "Réparer la méthode `baseline()`", en: "Fix the `baseline()` method" }),
      constat: t({
        fr: "La référence existe mais lève une exception : elle n'a répondu sur aucun cas.",
        en: "The baseline exists but throws: it answered on no case.",
      }),
      pourquoi: t({
        fr: "Le système, lui, a bien été mesuré. Il ne manque que la comparaison — et c'est elle "
          + "qui porte le verdict. Le message d'erreur est dans les réserves.",
        en: "The system itself was measured. Only the comparison is missing, and it carries the verdict.",
      }),
      preuve: "réserve « baseline() a échoué »",
    });
  }

  if (aReserve(/SUSPECT/)) {
    const taux = r.binary?.successRate.value;
    out.push({
      priorite: "bloquant",
      titre: t({
        fr: "Chercher une fuite avant de se réjouir",
        en: "Look for a leak before celebrating",
      }),
      constat: t({
        fr: `Taux de réussite de ${taux !== undefined ? pc(taux) : "près de 100 %"}.`,
        en: `Success rate of ${taux !== undefined ? pc(taux) : "nearly 100 %"}.`,
      }),
      pourquoi: t({
        fr: "Sur des données réelles, un score aussi élevé vient presque toujours d'une fuite. "
          + "Trois questions, dans l'ordre : le système voit-il, au moment de prédire, quelque "
          + "chose qu'il n'aura pas en production ? ces cas ont-ils servi à le régler ? un "
          + "identifiant encode-t-il la réponse ? Tant qu'elles n'ont pas de réponse, ce chiffre "
          + "ne doit être montré à personne.",
        en: "On real data such a score almost always comes from a leak. Do not show this number "
          + "until the three questions are answered.",
      }),
      preuve: "binary.successRate",
    });
  }

  if (aReserve(/MÊME vérité terrain|portent la même vérité terrain/)) {
    out.push({
      priorite: "bloquant",
      titre: t({
        fr: "Rééquilibrer le jeu de test",
        en: "Rebalance the test set",
      }),
      constat: t({
        fr: "La vérité terrain est presque constante : une même réponse couvre la quasi-totalité "
          + "des cas.",
        en: "The ground truth is nearly constant.",
      }),
      pourquoi: t({
        fr: "« Répondre toujours pareil » obtient alors un score excellent sans rien savoir, et "
          + "aucun système ne peut être distingué d'un autre sur ce jeu. Ce n'est pas le système "
          + "qu'il faut changer, c'est l'échantillon : il faut y ramener des cas de la classe "
          + "minoritaire.",
        en: "Answering the same thing every time scores well while knowing nothing. Fix the "
          + "sample, not the system.",
      }),
      preuve: t({ fr: "distribution des étiquettes de `truth()`", en: "distribution of truth labels" }),
    });
  }

  if (aReserve(/TOUJOURS la même chose/)) {
    out.push({
      priorite: "bloquant",
      titre: t({
        fr: "Vérifier que l'adaptateur appelle vraiment le système",
        en: "Check that the adapter really calls the system",
      }),
      constat: t({
        fr: "Le système renvoie la même réponse sur tous les cas.",
        en: "The system returns the same answer on every case.",
      }),
      pourquoi: t({
        fr: "Son taux de réussite n'est alors que la fréquence de cette réponse dans la vérité "
          + "terrain : il ne mesure aucune capacité à distinguer. Deux causes, et la première est "
          + "de loin la plus fréquente : l'adaptateur n'appelle pas le système, ou ne lui transmet "
          + "pas l'entrée. La seconde : le système est réellement dégénéré.",
        en: "Its success rate is merely the frequency of that answer in the ground truth.",
      }),
      preuve: t({ fr: "distribution des sorties de `predict()`", en: "distribution of predict() outputs" }),
    });
  }

  // ── IMPORTANTS : la mesure tient, mais elle ne permet pas encore de décider ─────────────────

  if (aReserve(/grappes seulement/)) {
    out.push({
      priorite: "important",
      titre: t({
        fr: "Recueillir plus de grappes, pas plus de cas",
        en: "Collect more clusters, not more cases",
      }),
      constat: t({
        fr: `Les ${r.n} cas se concentrent sur un petit nombre de grappes déclarées dépendantes.`,
        en: `The ${r.n} cases concentrate into few clusters declared dependent.`,
      }),
      pourquoi: t({
        fr: "Les intervalles et les tests de ce rapport supposent des observations indépendantes : "
          + "ils sont donc trop étroits, et un écart qui paraît significatif peut n'être rien. "
          + "Ajouter des cas dans les mêmes grappes n'y changera rien — c'est le nombre de grappes "
          + "qui fait l'effectif utile.",
        en: "The intervals assume independent observations and are therefore too narrow. Adding "
          + "cases inside the same clusters changes nothing.",
      }),
      preuve: t({ fr: "clés rendues par `cluster()`", en: "keys returned by cluster()" }),
    });
  }

  const cb = r.contrastive?.binary;
  if (cb && r.contrastive?.verdict === "MOINS BON") {
    out.push({
      priorite: "important",
      titre: t({
        fr: "Décider si ce système mérite d'être déployé",
        en: "Decide whether this system is worth deploying",
      }),
      constat: t({
        fr: `Le système réussit ${pc(cb.systemRate.value)} contre ${pc(cb.baselineRate.value)} `
          + `pour la référence (McNemar p = ${cb.mcnemar.pValue.toFixed(4)}).`,
        en: `System ${pc(cb.systemRate.value)} against baseline ${pc(cb.baselineRate.value)}.`,
      }),
      pourquoi: t({
        fr: "La référence fait mieux, de façon mesurable. Ce n'est pas un réglage à ajuster : sur "
          + "cette question et sur ces données, la méthode simple l'emporte. Deux issues honnêtes "
          + "— comprendre pourquoi le système fait pire que le trivial, ou déployer la référence.",
        en: "The baseline does measurably better. Either understand why, or deploy the baseline.",
      }),
      preuve: "contrastive.binary.mcnemar",
    });
  }

  // Calibration : la confiance annoncée est-elle pire qu'une constante ?
  const cp = r.contrastive?.probabilistic;
  if (cp && cp.brierDifference.value > 0 && cp.brierDifference.low > 0) {
    out.push({
      priorite: "important",
      titre: t({
        fr: "Recalibrer la confiance affichée, ou cesser de l'afficher",
        en: "Recalibrate the displayed confidence, or stop displaying it",
      }),
      constat: t({
        fr: `Score de Brier ${cp.systemBrier.value.toFixed(4)} contre `
          + `${cp.baselineBrier.value.toFixed(4)} pour la référence.`,
        en: `Brier ${cp.systemBrier.value.toFixed(4)} against ${cp.baselineBrier.value.toFixed(4)}.`,
      }),
      pourquoi: t({
        fr: "La confiance annoncée ne se contente pas de ne rien apprendre : elle dégrade la "
          + "prévision. Un utilisateur qui s'y fie décide moins bien que s'il l'ignorait. "
          + "L'afficher sans la corriger revient à publier un chiffre trompeur.",
        en: "The stated confidence does not merely fail to inform: it degrades the forecast.",
      }),
      preuve: "contrastive.probabilistic.brierDifference",
    });
  }

  if (r.n > 0 && r.n < r.reproducibility.minPaired && !r.refusal) {
    out.push({
      priorite: "important",
      titre: t({ fr: "Augmenter le nombre de cas", en: "Increase the number of cases" }),
      constat: t({
        fr: `${r.n} cas évalués, seuil de ${r.reproducibility.minPaired} pour départager deux `
          + "systèmes proches.",
        en: `${r.n} cases evaluated, threshold ${r.reproducibility.minPaired}.`,
      }),
      pourquoi: t({
        fr: "À ce volume, seul un écart énorme ressort. Un système légèrement meilleur restera "
          + "indécidable quoi qu'il arrive, et l'absence de conclusion sera prise à tort pour une "
          + "absence de différence.",
        en: "At this volume only a huge gap shows. A slightly better system stays undecidable.",
      }),
      preuve: "EvalResult.n",
    });
  }

  // Tranches faibles : seulement celles qui sont CONCLUSIVES, et nettement sous le global.
  const global = r.binary?.successRate.value;
  const faibles = (r.binary?.byCategory ?? []).filter(
    (c) => c.conclusive && global !== undefined && c.rate.high < global,
  );
  for (const c of faibles) {
    out.push({
      priorite: "important",
      titre: t({
        fr: `Regarder ce qui se passe sur « ${c.category} »`,
        en: `Investigate the « ${c.category} » slice`,
      }),
      constat: t({
        fr: `${pc(c.rate.value)} sur ${c.n} cas [${pc(c.rate.low)} – ${pc(c.rate.high)}], contre `
          + `${pc(global!)} au global.`,
        en: `${pc(c.rate.value)} over ${c.n} cases, against ${pc(global!)} overall.`,
      }),
      pourquoi: t({
        fr: "L'intervalle de cette tranche est entièrement sous le taux global, et elle compte "
          + "assez de cas pour qu'on en parle. C'est la piste la plus concrète du rapport : une "
          + "faiblesse localisée se corrige, une faiblesse diffuse ne se corrige pas.",
        en: "This slice's interval sits entirely below the overall rate, on enough cases to matter.",
      }),
      preuve: `binary.byCategory[${c.category}]`,
    });
  }

  if (r.errors > 0) {
    out.push({
      priorite: "important",
      titre: t({ fr: "Traiter les cas en échec", en: "Handle the failing cases" }),
      constat: t({
        fr: `${r.errors} cas sur ${r.errors + r.n} ont échoué et sont exclus des mesures.`,
        en: `${r.errors} cases failed and are excluded.`,
      }),
      pourquoi: t({
        fr: "Des cas perdus ne le sont jamais au hasard : ce sont souvent les plus difficiles, les "
          + "plus longs, les plus inhabituels. Les scores portent donc sur un échantillon plus "
          + "facile que la réalité, et sont optimistes d'un montant inconnu.",
        en: "Lost cases are never lost at random. The scores cover an easier sample than reality.",
      }),
      preuve: "EvalResult.errors",
    });
  }

  // ── UTILES : ce qui rendrait la PROCHAINE mesure plus tranchante ────────────────────────────

  if (r.probabilistic === null && !r.refusal) {
    out.push({
      priorite: "utile",
      titre: t({
        fr: "Faire produire une confiance chiffrée au système",
        en: "Have the system emit a numeric confidence",
      }),
      constat: t({
        fr: "Le système ne rend aucune probabilité : `predict()` ne renvoie que des étiquettes.",
        en: "The system emits no probability.",
      }),
      pourquoi: t({
        fr: "On sait s'il a raison, pas s'il sait quand il a tort. Sans confiance chiffrée, "
          + "impossible de décider à quel moment lui faire confiance et à quel moment demander un "
          + "humain — c'est souvent ce qui rend un système utilisable plutôt que juste correct.",
        en: "You know whether it is right, not whether it knows when it is wrong.",
      }),
      preuve: "EvalResult.probabilistic === null",
    });
  }

  if (r.cost.coverage === 0) {
    out.push({
      priorite: "utile",
      titre: t({ fr: "Déclarer le coût de chaque appel", en: "Declare the cost of each call" }),
      constat: t({
        fr: "Aucun coût n'est remonté par l'adaptateur : jetons, durée ou euros.",
        en: "No cost is reported by the adapter.",
      }),
      pourquoi: t({
        fr: "Le coût par réponse CORRECTE est le chiffre qui tranche une décision de changement. "
          + "Sans lui, on compare des qualités sans comparer des prix, et l'option la plus chère "
          + "gagne par défaut dès qu'elle est un peu meilleure.",
        en: "Cost per CORRECT answer is the number that settles a migration decision.",
      }),
      preuve: "cost.coverage === 0",
    });
  }

  if (r.contrastive?.anchoring?.anchored) {
    out.push({
      priorite: "important",
      titre: t({
        fr: "Rendre la référence indépendante du système",
        en: "Make the baseline independent of the system",
      }),
      constat: t({
        fr: "Les estimations du système et de la référence sont fortement liées.",
        en: "System and baseline estimates are strongly linked.",
      }),
      pourquoi: t({
        fr: "Une référence qui part du résultat du système ne peut pas le contredire : la "
          + "comparaison est alors décorative, quel que soit l'écart mesuré. Une référence doit "
          + "être calculée sans jamais consulter la sortie du système.",
        en: "A baseline derived from the system's output cannot contradict it.",
      }),
      preuve: "contrastive.anchoring",
    });
  }

  return out.sort((a, b) => ORDRE[a.priorite] - ORDRE[b.priorite]);
}

// ── Rendus ────────────────────────────────────────────────────────────────────────────────────

const ETIQUETTE: Record<Priorite, string> = {
  bloquant: "BLOQUANT",
  important: "IMPORTANT",
  utile: "UTILE",
};

export function renderAmeliorationsConsole(r: EvalResult): string {
  const liste = ameliorations(r);
  const L: string[] = [];
  L.push("─".repeat(96));
  L.push(t({ fr: "POINTS D'AMÉLIORATION — que faire de ce résultat", en: "IMPROVEMENTS" }));
  L.push("─".repeat(96));

  if (liste.length === 0) {
    L.push("");
    L.push(t({
      fr: "Aucun point à signaler : rien dans cette mesure ne déclenche de recommandation. Ce "
        + "n'est pas un satisfecit — c'est l'absence de signal, et c'est un résultat.",
      en: "Nothing in this measurement triggers a recommendation. That is a result, not praise.",
    }));
    return L.join("\n");
  }

  for (const [i, a] of liste.entries()) {
    L.push("");
    L.push(`${i + 1}. [${ETIQUETTE[a.priorite]}] ${a.titre}`);
    L.push(`   constat : ${a.constat}`);
    for (const ligne of couper(a.pourquoi, 88)) L.push(`   ${ligne}`);
    L.push(`   preuve  : ${a.preuve}`);
  }
  return L.join("\n");
}

export function renderAmeliorationsMarkdown(r: EvalResult): string {
  const liste = ameliorations(r);
  const L: string[] = [];
  L.push(t({ fr: "## Points d'amélioration", en: "## Improvements" }));
  L.push("");

  if (liste.length === 0) {
    L.push(t({
      fr: "*Aucun point : rien dans cette mesure ne déclenche de recommandation. Ce n'est pas un "
        + "satisfecit, c'est l'absence de signal.*",
      en: "*Nothing in this measurement triggers a recommendation.*",
    }));
    return L.join("\n");
  }

  for (const [i, a] of liste.entries()) {
    L.push(`### ${i + 1}. ${a.titre}`);
    L.push("");
    L.push(`**${ETIQUETTE[a.priorite]}** — ${a.constat}`);
    L.push("");
    L.push(a.pourquoi);
    L.push("");
    L.push(`*Mesure : \`${a.preuve}\`*`);
    L.push("");
  }
  return L.join("\n");
}

function couper(texte: string, largeur: number): string[] {
  const out: string[] = [];
  let ligne = "";
  for (const mot of texte.split(/\s+/)) {
    if (ligne.length + mot.length + 1 > largeur) {
      out.push(ligne);
      ligne = mot;
    } else ligne = ligne ? `${ligne} ${mot}` : mot;
  }
  if (ligne) out.push(ligne);
  return out;
}
