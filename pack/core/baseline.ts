// La comparaison à une référence. Le module qui justifie le pack.
//
// Deux étages, et il ne faut jamais les confondre :
//
//   • les références TRIVIALES — taux de base, classe majoritaire, hasard. Calculées
//     automatiquement à partir des seules vérités terrain, donc toujours disponibles. Les battre
//     est NÉCESSAIRE. Ça n'a jamais été suffisant : le système d'origine les battait de +29,2 % de
//     skill et ne valait rien.
//
//   • la référence CONTRASTIVE — ce que l'adaptateur fournit : version précédente, modèle moins
//     cher, méthode non apprise, humain. C'est la seule qui autorise un verdict de compétence,
//     parce que c'est la seule qui répond à la vraie question : « et si on ne déployait pas ce
//     système, on obtiendrait quoi ? »

import { bootstrapCI, containsZero, pairedBootstrapCI } from "./bootstrap.ts";
import { mcNemar, successRate, wilson, type McNemarResult } from "./binary.ts";
import { t, tf } from "./i18n.ts";
import { brier, climatologyBrier, logLoss } from "./metrics.ts";
import type { Interval, Observation, Trial } from "./types.ts";

/** Le verdict de compétence. `REFUSED` est un état de plein droit, pas une erreur. */
export type VerdictKind = "BAT" | "ÉQUIVALENT" | "MOINS BON" | "INDÉCIDABLE" | "REFUSÉ";

/** Les références gratuites, calculées à partir des seules vérités terrain. */
export interface TrivialBaselines {
  n: number;
  /**
   * Fréquence de l'issue positive.
   *
   * ATTENTION AU SENS, il change avec le mode : en mode « événement » c'est la fréquence de
   * survenue de l'événement ; dans les autres modes c'est le taux de réussite du système.
   */
  positiveRate: number;
  /** Brier de « annoncer toujours le taux de base ». `null` si le système ne produit pas de proba. */
  climatologyBrier: number | null;
  beatsClimatology: boolean | null;
  /**
   * Exactitude de « répondre toujours l'étiquette la plus fréquente ».
   *
   * `null` quand les vérités terrain ne portent pas d'étiquette — c'est le cas d'un agent jugé
   * réussite/échec, ou d'un événement. Y calculer une « classe majoritaire » à partir du taux de
   * réussite serait circulaire : on comparerait le système à lui-même.
   */
  majorityLabelAccuracy: number | null;
  beatsMajorityLabel: boolean | null;
  /** Exactitude d'une réponse tirée au hasard parmi les étiquettes vues. `null` sans étiquettes. */
  randomLabelAccuracy: number | null;
  /**
   * Brier attendu d'une probabilité tirée au hasard sur [0,1].
   *
   * E[(U − y)²] = 1/3 − y + y², et y² = y pour une issue binaire : le terme en y s'annule et la
   * valeur vaut exactement 1/3, quelle que soit la difficulté du problème. C'est le plancher le
   * plus bête qui soit, et il est utile précisément pour ça.
   */
  randomBrier: number;
}

/**
 * Les planchers gratuits.
 *
 * Chaque champ vaut `null` quand il n'a pas de sens dans le mode courant. Un `null` est une
 * information — « cette comparaison ne s'applique pas ici » — là où un `false` par défaut serait
 * un mensonge, et un `0` une invitation à conclure de travers.
 */
export function trivialBaselines(
  observations: Observation[],
  trials: Trial[],
  truthLabels: string[] = [],
): TrivialBaselines {
  const n = observations.length > 0 ? observations.length : trials.length;
  const hits =
    observations.length > 0
      ? observations.filter((o) => o.outcome).length
      : trials.filter((t) => t.pass).length;
  const positiveRate = n > 0 ? hits / n : 0;

  // Le plancher « taux de base » devient DÉGÉNÉRÉ quand l'issue est constante : son Brier vaut
  // alors exactement 0, et aucun système ne peut faire mieux. Le déclarer « non battu » ferait
  // lire un échec là où il n'y a qu'une comparaison vide de sens — typiquement un système parfait
  // sur son jeu de test, ou un jeu où tout le monde échoue.
  const clim = observations.length > 0 ? climatologyBrier(observations) : null;
  const degenerate = clim !== null && clim === 0;

  // Le plancher « classe majoritaire » se calcule sur les ÉTIQUETTES VRAIES, jamais sur la série
  // des réussites : « toujours répondre l'étiquette la plus fréquente » est une stratégie, et son
  // exactitude est la fréquence de cette étiquette.
  let majorityLabelAccuracy: number | null = null;
  let randomLabelAccuracy: number | null = null;
  if (truthLabels.length > 0) {
    const counts = new Map<string, number>();
    for (const l of truthLabels) counts.set(l, (counts.get(l) ?? 0) + 1);
    majorityLabelAccuracy = Math.max(...counts.values()) / truthLabels.length;
    randomLabelAccuracy = 1 / counts.size;
  }

  const accuracy = trials.length > 0 ? successRate(trials) : null;

  return {
    n,
    positiveRate,
    climatologyBrier: clim,
    beatsClimatology:
      observations.length > 0 && clim !== null && !degenerate ? brier(observations) < clim : null,
    majorityLabelAccuracy,
    beatsMajorityLabel:
      majorityLabelAccuracy !== null && accuracy !== null ? accuracy > majorityLabelAccuracy : null,
    randomLabelAccuracy,
    randomBrier: 1 / 3,
  };
}

/** La comparaison appariée à une référence contrastive. */
export interface ContrastiveComparison {
  /** Cas où le système ET la référence ont tous deux répondu. Les seuls comparables. */
  n: number;
  /** Cas écartés faute de réponse de la référence. De l'information perdue, jamais neutre. */
  unmatched: number;
  verdict: VerdictKind;
  /** La phrase à lire si l'on n'en lit qu'une. */
  statement: string;

  /** Volet probabiliste, présent seulement si les deux camps produisent des probabilités. */
  probabilistic?: {
    systemBrier: Interval;
    baselineBrier: Interval;
    systemLogLoss: number;
    baselineLogLoss: number;
    /** Différence appariée Brier(système) − Brier(référence). Négatif = système meilleur. */
    brierDifference: Interval;
    /** 1 − Brier(système)/Brier(référence). > 0 = le système bat la référence. */
    skillScore: number;
    /**
     * La comparaison de Brier est-elle STRUCTURELLEMENT biaisée en faveur du système ?
     *
     * Vrai quand la référence ne produit que des 0 et des 1 alors que le système nuance. Une
     * référence qui n'hésite jamais est battue d'avance sur un score qui récompense la nuance :
     * chacune de ses erreurs coûte le maximum. L'écart de Brier mesure alors le fait qu'elle ne
     * nuance pas, pas le fait qu'elle se trompe.
     *
     * Trouvé sur des données réelles : un système affichait Brier 0,279 contre 0,488, tout en
     * ayant un taux de réussite INFÉRIEUR à la même référence.
     */
    referenceSansNuance: boolean;
  };

  /** Volet binaire, présent dès que les deux camps produisent une réussite/échec. */
  binary?: {
    systemRate: Interval;
    baselineRate: Interval;
    /** Différence appariée de taux de réussite. */
    rateDifference: Interval;
    mcnemar: McNemarResult;
  };

  /** Le système dérive-t-il de sa référence au lieu de raisonner ? Voir `anchoring`. */
  anchoring?: AnchoringReport;
}

/**
 * Le système reproduit-il simplement sa référence ?
 *
 * CETTE MESURE NE CONSULTE AUCUNE VÉRITÉ TERRAIN. Elle se calcule dès que les deux estimations
 * existent — donc avant d'avoir un seul résultat, dès le premier jour du projet.
 *
 * C'est la mesure qui aurait épargné six semaines au projet d'origine : corrélation 0,9933 entre
 * son estimation et celle de sa référence. Un système ainsi ancré ne peut pas battre sa référence.
 * Ce n'est pas un défaut de réglage, c'est une conséquence arithmétique : déplacer de ±2 points
 * une estimation déjà bonne produit en moyenne une estimation légèrement moins bonne.
 */
export interface AnchoringReport {
  n: number;
  meanAbsoluteDistance: number;
  medianAbsoluteDistance: number;
  correlation: number;
  shareWithin2pts: number;
  /** Vrai quand le système est indiscernable de sa référence par construction. */
  anchored: boolean;
  statement: string;
}

export function anchoring(pairs: Array<{ prob: number; reference: number }>): AnchoringReport {
  const n = pairs.length;
  if (n === 0) {
    return {
      n: 0,
      meanAbsoluteDistance: 0,
      medianAbsoluteDistance: 0,
      correlation: 0,
      shareWithin2pts: 0,
      anchored: false,
      statement: t({ fr: "Aucune paire de probabilités : ancrage non mesurable.", en: "No probability pairs: anchoring is not measurable." }),
    };
  }
  const d = pairs.map((p) => Math.abs(p.prob - p.reference));
  const mean = d.reduce((a, x) => a + x, 0) / n;
  const med = median(d);
  const r = pearson(pairs.map((p) => p.prob), pairs.map((p) => p.reference));
  const within = d.filter((x) => x < 0.02).length / n;

  let anchored = false;
  let statement: string;
  if (med < 0.01 && r > 0.98) {
    anchored = true;
    statement = tf({
      fr: (m: string, c: string) =>
        `ANCRAGE MASSIF : le système reproduit sa référence (écart médian ${m} pt, corrélation ${c}). `
        + "Il ne peut pas la battre — pas par manque de réglage, par construction. La seule sortie "
        + "est une information que la référence n'a pas.",
      en: (m: string, c: string) =>
        `SEVERE ANCHORING: the system reproduces its baseline (median gap ${m} pts, correlation ${c}). `
        + "It cannot beat it — not for want of tuning, but by construction. The only way out is "
        + "information the baseline does not have.",
    })((med * 100).toFixed(1), r.toFixed(4));
  } else if (med < 0.03 && r > 0.9) {
    anchored = true;
    statement = tf({
      fr: (m: string, c: string) =>
        `Ancrage probable : écart médian ${m} pt pour une corrélation ${c}. Le système part de la `
        + "référence et la déplace un peu. Vérifier d'où vient son entrée avant d'interpréter le "
        + "moindre score.",
      en: (m: string, c: string) =>
        `Likely anchoring: median gap ${m} pts for a correlation of ${c}. The system starts from the `
        + "baseline and nudges it. Check where its input comes from before interpreting any score.",
    })((med * 100).toFixed(1), r.toFixed(4));
  } else {
    statement = tf({
      fr: (m: string, c: string) =>
        `Estimations largement indépendantes : écart médian ${m} pt, corrélation ${c}. La `
        + "comparaison des scores est interprétable.",
      en: (m: string, c: string) =>
        `Largely independent estimates: median gap ${m} pts, correlation ${c}. `
        + "The score comparison is interpretable.",
    })((med * 100).toFixed(1), r.toFixed(4));
  }
  return {
    n,
    meanAbsoluteDistance: mean,
    medianAbsoluteDistance: med,
    correlation: r,
    shareWithin2pts: within,
    anchored,
    statement,
  };
}

/**
 * Compare le système à sa référence contrastive, sur les MÊMES cas.
 *
 * Tout est apparié : le bootstrap rééchantillonne les cas, pas chaque série séparément, et
 * McNemar ne regarde que les cas discordants. Comparer deux scores globaux sans apparier revient à
 * comparer deux populations différentes.
 */
export function compareToBaseline(args: {
  systemObs: Observation[];
  baselineObs: Observation[];
  systemTrials: Trial[];
  baselineTrials: Trial[];
  minPaired: number;
  level: number;
  bootstrapSamples: number;
  seed: number;
}): ContrastiveComparison {
  const {
    systemObs, baselineObs, systemTrials, baselineTrials, minPaired, level, bootstrapSamples, seed,
  } = args;

  // ── Appariement binaire : c'est le socle, il existe toujours.
  const baseTrialById = new Map(baselineTrials.map((t) => [t.itemId, t]));
  const pairedTrials = systemTrials
    .map((s) => ({ s, b: baseTrialById.get(s.itemId) }))
    .filter((p): p is { s: Trial; b: Trial } => !!p.b);
  // En mode « événement » il n'existe aucun essai binaire (voir resolve.ts) : l'appariement se
  // fait alors sur les observations probabilistes. Compter `n` sur les seuls essais donnerait
  // zéro et ferait conclure « INDÉCIDABLE » sur une comparaison parfaitement faisable.
  const baseObsIndex = new Map(baselineObs.map((o) => [o.itemId, o]));
  const pairedObsCount = systemObs.filter((o) => baseObsIndex.has(o.itemId)).length;

  const n = pairedTrials.length > 0 ? pairedTrials.length : pairedObsCount;
  const unmatched =
    pairedTrials.length > 0
      ? systemTrials.length - pairedTrials.length
      : systemObs.length - pairedObsCount;

  const out: ContrastiveComparison = {
    n,
    unmatched,
    verdict: "INDÉCIDABLE",
    statement: "",
  };

  if (pairedTrials.length > 0) {
    const m = pairedTrials.length;
    const sysRate = wilson(pairedTrials.filter((p) => p.s.pass).length, m, level);
    const baseRateI = wilson(pairedTrials.filter((p) => p.b.pass).length, m, level);
    const rateDifference = pairedBootstrapCI(
      pairedTrials,
      (sample) =>
        sample.reduce((a, p) => a + (p.s.pass ? 1 : 0) - (p.b.pass ? 1 : 0), 0) / (sample.length || 1),
      { samples: bootstrapSamples, level, seed },
    );
    out.binary = {
      systemRate: sysRate,
      baselineRate: baseRateI,
      rateDifference,
      mcnemar: mcNemar(
        pairedTrials.map((p) => p.s),
        pairedTrials.map((p) => p.b),
        level,
      ),
    };
  }

  // ── Appariement probabiliste, seulement si les deux camps produisent des probabilités.
  const pairedObs = systemObs
    .map((s) => ({ s, b: baseObsIndex.get(s.itemId) }))
    .filter((p): p is { s: Observation; b: Observation } => !!p.b);

  if (pairedObs.length > 0) {
    const sysOnly = pairedObs.map((p) => p.s);
    const baseOnly = pairedObs.map((p) => p.b);
    const sBrier = bootstrapCI(sysOnly, brier, { samples: bootstrapSamples, level, seed });
    const bBrier = bootstrapCI(baseOnly, brier, { samples: bootstrapSamples, level, seed });
    const brierDifference = pairedBootstrapCI(
      pairedObs,
      (sample) => brier(sample.map((p) => p.s)) - brier(sample.map((p) => p.b)),
      { samples: bootstrapSamples, level, seed },
    );
    // Une probabilité vaut 0 ou 1 « en dur » : aucune nuance. On tolère un epsilon pour ne pas
    // classer ainsi un modèle qui sort 0,999.
    const dur = (o: Observation) => o.prob <= 1e-9 || o.prob >= 1 - 1e-9;
    const referenceSansNuance = baseOnly.every(dur) && !sysOnly.every(dur);

    out.probabilistic = {
      referenceSansNuance,
      systemBrier: sBrier,
      baselineBrier: bBrier,
      systemLogLoss: logLoss(sysOnly),
      baselineLogLoss: logLoss(baseOnly),
      brierDifference,
      skillScore: bBrier.value > 0 ? 1 - sBrier.value / bBrier.value : 0,
    };
    out.anchoring = anchoring(pairedObs.map((p) => ({ prob: p.s.prob, reference: p.b.prob })));
  }

  const decided = decide(out, minPaired);
  out.verdict = decided.verdict;
  out.statement = decided.statement;
  return out;
}

/**
 * Le verdict, et la règle qui gouverne le seuil d'échantillon.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POURQUOI LE SEUIL NE BLOQUE QUE LES CONCLUSIONS NÉGATIVES.
 *
 * Le garde-fou de taille d'échantillon existe pour empêcher de conclure « équivalent » à partir
 * d'un test qui n'avait aucune chance de détecter une différence. Absence de preuve n'est pas
 * preuve d'absence : c'est exactement l'erreur qui a laissé passer le système d'origine.
 *
 * Mais il ne doit PAS bloquer une différence déjà démontrée. Un intervalle de confiance qui exclut
 * zéro tient déjà compte de l'effectif : si l'écart sort du bruit sur 40 cas, c'est qu'il est
 * énorme, et refuser de le dire serait une seconde erreur, symétrique de la première.
 *
 * D'où la règle :
 *   • écart significatif        → BAT ou MOINS BON, quel que soit n ;
 *   • non significatif, n grand → ÉQUIVALENT (test correctement dimensionné, aucune différence) ;
 *   • non significatif, n petit → INDÉCIDABLE (on ne sait pas, et on le dit).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
/** Un taux en pourcentage, une décimale. */
function pct(v: number): string {
  return `${(v * 100).toFixed(1)} %`;
}

/**
 * Nomme l'écart OBSERVÉ quand il penche visiblement d'un côté, avant de dire qu'il n'est pas
 * démontré. Deux phrases différentes pour deux choses différentes.
 */
function ecartObserve(c: ContrastiveComparison): string {
  const b = c.binary;
  if (!b) return "";
  const ecart = b.systemRate.value - b.baselineRate.value;
  if (Math.abs(ecart) < 0.02) return "";
  return t({
    fr: `Écart observé de ${pct(Math.abs(ecart))} `
      + `${ecart > 0 ? "en faveur du système" : "en DÉFAVEUR du système"} `
      + `(${pct(b.systemRate.value)} contre ${pct(b.baselineRate.value)}), non démontré. `,
    en: `Observed gap of ${pct(Math.abs(ecart))} `
      + `${ecart > 0 ? "favouring the system" : "AGAINST the system"} `
      + `(${pct(b.systemRate.value)} vs ${pct(b.baselineRate.value)}), not demonstrated. `,
  });
}

function anchorNoteOf(c: ContrastiveComparison): string {
  return c.anchoring?.anchored ? ` ${c.anchoring.statement}` : "";
}

function decide(
  c: ContrastiveComparison,
  minPaired: number,
): { verdict: VerdictKind; statement: string } {
  if (c.n === 0) {
    return {
      verdict: "INDÉCIDABLE",
      statement: t({
        fr: "Aucun cas apparié : la référence n'a répondu sur aucun des cas évalués. La comparaison "
          + "n'a pas eu lieu.",
        en: "No paired cases: the baseline answered on none of the evaluated cases. The comparison "
          + "did not take place.",
      }),
    };
  }

  // ── Choix du test, et il n'est pas indifférent ────────────────────────────────────────────
  //
  // Le volet probabiliste prime quand il existe : il utilise bien plus d'information que le
  // binaire, et le bootstrap est l'outil adapté à un score continu.
  //
  // Sur des données binaires appariées, en revanche, c'est McNemar qui tranche — PAS l'intervalle
  // bootstrap. Sur de très petits nombres de cas discordants, l'intervalle percentile devient
  // optimiste : avec 4 cas discordants tous favorables, il peut exclure zéro alors que la
  // probabilité d'obtenir ce résultat à pile ou face est de 12,5 %. McNemar, exact, le dit. Se
  // fier au bootstrap ici ferait déclarer « BAT » sur quatre cas.
  let significant: boolean;
  let systemAhead: boolean;

  if (c.probabilistic) {
    const d = c.probabilistic.brierDifference;
    // Sur le Brier, plus bas = mieux : un écart négatif signifie que le système est meilleur.
    significant = !containsZero(d);
    systemAhead = d.value < 0;

    // ── QUAND LES DEUX LECTURES SE CONTREDISENT, ON LE DIT ──────────────────────────────────
    //
    // DÉFAUT TROUVÉ SUR DES DONNÉES RÉELLES. Un système de sélection d'actions obtenait :
    //   · Brier    0,279 contre 0,488 pour la référence → le système est bien meilleur
    //   · réussite 51,2 % contre 61,8 %                 → le système est moins bon
    // Le pack annonçait « BAT LA RÉFÉRENCE » et citait « il réussit 51,2 % des cas » dans la
    // MÊME phrase. Deux lectures opposées, dont une seule au titre, et la plus flatteuse.
    //
    // « Le probabiliste prime » reste le bon choix de TEST — il utilise plus d'information. Mais
    // primer ne veut pas dire faire taire : deux métriques qui pointent en sens inverse est une
    // information majeure, pas un détail d'arrondi. Elle signifie que le système classe mieux ses
    // certitudes tout en ayant tort plus souvent, ou que la référence ne nuance jamais ses
    // réponses. Les deux méritent d'être regardées avant de conclure quoi que ce soit.
    const contradiction = c.binary !== null && c.binary !== undefined
      && Math.sign(c.binary.mcnemar.difference) !== 0
      && (c.binary.mcnemar.difference > 0) !== systemAhead;

    if (contradiction && c.binary) {
      return {
        verdict: "INDÉCIDABLE",
        statement: tf({
          fr: (n: number) =>
            `Les deux lectures se contredisent sur ${n} cas appariés, et aucune ne peut être `
            + "retenue seule. Sur le score probabiliste, "
            + `${systemAhead ? "le système" : "la référence"} devance l'autre ; sur le simple taux `
            + `de réussite, c'est l'inverse (${pct(c.binary.systemRate.value)} contre `
            + `${pct(c.binary.baselineRate.value)}). Un système peut très bien mieux graduer ses `
            + "certitudes tout en se trompant plus souvent — ou une référence qui ne nuance jamais "
            + "peut sembler mauvaise au score probabiliste sans l'être. Il faut regarder les deux "
            + "et décider ce qui compte pour l'usage visé ; annoncer un seul verdict reviendrait à "
            + "choisir la lecture la plus flatteuse.",
          en: (n: number) =>
            `The two readings contradict each other over ${n} paired cases, and neither can stand `
            + "alone. On the probabilistic score, "
            + `${systemAhead ? "the system" : "the baseline"} leads; on the plain success rate it `
            + `is the opposite (${pct(c.binary.systemRate.value)} against `
            + `${pct(c.binary.baselineRate.value)}). Look at both and decide what matters for the `
            + "intended use; announcing a single verdict would mean picking the flattering one.",
        })(c.n) + anchorNoteOf(c),
      };
    }
  } else if (c.binary) {
    significant = c.binary.mcnemar.significant;
    systemAhead = c.binary.mcnemar.difference > 0;
  } else {
    return {
      verdict: "INDÉCIDABLE",
      statement: t({
        fr: "Aucune métrique comparable entre les deux camps.",
        en: "No metric is comparable between the two sides.",
      }),
    };
  }

  const anchorNote = anchorNoteOf(c);

  if (significant) {
    if (systemAhead) {
      return {
        verdict: "BAT",
        statement:
          tf({
            fr: (n: number) =>
              `Bat sa référence sur ${n} cas appariés : l'intervalle de confiance de l'écart exclut `
              + "zéro, donc la différence ne s'explique pas par le hasard d'échantillonnage.",
            en: (n: number) =>
              `Beats its baseline on ${n} paired cases: the confidence interval of the difference `
              + "excludes zero, so the gap is not explained by sampling noise.",
          })(c.n) + anchorNote,
      };
    }
    return {
      verdict: "MOINS BON",
      statement:
        tf({
          fr: (n: number) =>
            `Fait MOINS BIEN que sa référence sur ${n} cas appariés, et l'écart exclut zéro. `
            + "Déployer la référence coûterait moins cher et donnerait un meilleur résultat.",
          en: (n: number) =>
            `Does WORSE than its baseline on ${n} paired cases, and the difference excludes zero. `
            + "Deploying the baseline would cost less and give a better result.",
        })(c.n) + anchorNote,
    };
  }

  // Pas de différence détectée. Reste à savoir si c'est parce qu'il n'y en a pas, ou parce que le
  // test était trop faible pour la voir. C'est ici, et seulement ici, que le seuil intervient.
  if (c.n < minPaired) {
    const mcnemarNote =
      c.binary && !c.probabilistic
        ? tf({
            fr: (a: number, b: number, p: string) =>
              ` (McNemar : ${a} cas gagnés contre ${b} perdus, p = ${p})`,
            en: (a: number, b: number, p: string) =>
              ` (McNemar: ${a} cases won against ${b} lost, p = ${p})`,
          })(c.binary.mcnemar.systemOnly, c.binary.mcnemar.baselineOnly, c.binary.mcnemar.pValue.toFixed(3))
        : "";
    return {
      verdict: "INDÉCIDABLE",
      statement:
        tf({
          fr: (n: number, min: number) =>
            `${n} cas appariés, seuil de ${min} : aucune différence n'est détectée, mais le test `
            + "n'était pas assez puissant pour en détecter une. On ne peut PAS en conclure que les "
            + "deux systèmes se valent — seulement qu'on n'en sait rien. Ajouter des cas.",
          en: (n: number, min: number) =>
            `${n} paired cases, threshold of ${min}: no difference was detected, but the test was `
            + "not powerful enough to detect one. You may NOT conclude that the two systems are "
            + "equivalent — only that you do not know. Add cases.",
        })(c.n, minPaired)
        + mcnemarNote
        + anchorNote,
    };
  }
  return {
    verdict: "ÉQUIVALENT",
    statement:
      // « Indiscernable » ne doit pas escamoter le SENS de l'écart observé. Sur des données
      // réelles, un système affichait 51,2 % contre 61,8 % pour sa référence — dix points en sa
      // défaveur — et la phrase disait seulement « indiscernable ». C'est vrai statistiquement, et
      // trompeur à la lecture : l'écart non démontré penchait clairement d'un côté, et le taire
      // revient toujours à flatter celui qui est derrière.
      ecartObserve(c)
      + tf({
        fr: (n: number) =>
          `Indiscernable de sa référence sur ${n} cas appariés : l'intervalle de confiance de `
          + "l'écart contient zéro, sur un échantillon suffisant pour détecter une différence "
          + "utile. Un système qui égale sa référence n'apporte rien de démontré.",
        en: (n: number) =>
          `Indistinguishable from its baseline on ${n} paired cases: the confidence interval of `
          + "the difference contains zero, on a sample large enough to detect a useful gap. "
          + "A system that equals its baseline contributes nothing demonstrated.",
      })(c.n) + anchorNote,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}
