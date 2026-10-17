# eval-pack

**An evaluation harness that refuses to give you a verdict you haven't earned.**

Most eval tools hand you a number. A number on its own is close to meaningless: a Brier score of
0.16 is excellent on a coin-flip question and mediocre on a 95/5 one. Its value is mostly the
difficulty of the problem, not the quality of your system.

So this one asks a different question — *better than what?* — and if you don't answer it, it
**refuses to grade your system**.

```
[REFUS]

Aucun verdict de compétence : sans baseline, une bonne calibration ne prouve rien.
Fournissez une référence.
```

Not a warning. A refusal, printed first, above every metric.

## Where the refusal comes from

This pack was extracted from a real forecasting project: 42 days, 225 commits, a prediction engine
that was **perfectly calibrated and completely worthless**. Global bias −0.42 points. Skill score
+29.2 % against the base rate. Every dashboard green.

It was worthless because it copied its reference: correlation **0.9933**, median gap **0.9 points**.
It started from someone else's answer and nudged it. A system anchored like that cannot beat its
reference — not for want of tuning, but arithmetically.

Nobody noticed for six weeks, because every measurement was made **in absolute terms**.

The measurement apparatus that eventually proved it is in [`../extraction/`](../extraction), with
the four documented traps and the recomputed figures. This pack is that apparatus turned into
something you can point at your own system.

## Beating the base rate is not a result

The pack computes trivial baselines for free — base rate, majority class, random. It reports them,
and it says plainly what they are worth:

> Les battre est **nécessaire**. Ça n'a jamais été suffisant : le système à l'origine de ce pack
> battait le taux de base de 29,2 % et ne valait rien.

A verdict requires a **contrastive** baseline — something a person could actually ship instead of
your system:

- the previous version (prompt, model, settings);
- a smaller or cheaper model;
- a non-learned method: a rule, a lexical search, a heuristic;
- an external reference: another vendor, a published benchmark;
- a human, even on a 50-case subsample;
- your system with its most expensive stage removed (RAG off, tool dropped, chain shortened).

There is always one. That is the point of the list.

## What it actually is

Three layers, strictly separated:

```
core/      Never changes between projects. Zero notion of any domain.
adapters/  The only thing you write. ~50 lines.
report/    Console, Markdown, and a self-contained HTML file you can hand to a client.
```

You write one file. It has **four required members and two optional ones**, and the interface will
not grow:

```ts
export interface Adapter<TItem> {
  name: string;
  loadItems(): Promise<TItem[]>;              // the cases to evaluate
  predict(item: TItem): Promise<Prediction>;  // what your system says
  truth(item: TItem): Promise<Outcome>;       // what should have happened
  baseline?(item: TItem): Promise<Prediction>;// the reference — strongly recommended
  category?(item: TItem): string;             // for the per-segment breakdown
}
```

Everything else — pairing, bootstrap intervals, McNemar, sample-size guards, the calibration curve,
the anchoring check, the verdict, the three report formats — lives in `core/` and you never touch
it.

## Three commands

```bash
node cli.ts run forecast
```

```bash
node cli.ts audit forecast --client "Acme" --out audit.html
```

```bash
node cli.ts compare before.json after.json
```

`run` prints the report. `audit` writes a standalone HTML file — cover page, verdict, defects ranked
by severity and reproducible one by one, methodological reservations, and what to measure next.
`compare` detects drift between two runs, and **refuses to call it drift** if the data fingerprints
differ, because then you are comparing two different test sets and not two versions of a system.

`run` exits with code 1 when the pack refuses to conclude or when your system is measurably worse
than its reference — so it drops into CI without a wrapper script.

## Real output

Running the shipped `forecast` adapter on the 3 671 archived predictions from the original project:

```
════════════════════════════════════════════════════════════════════════════════════
ÉVALUATION — Prévision probabiliste archivée (3671 observations)
════════════════════════════════════════════════════════════════════════════════════

[ÉQUIVALENT À LA RÉFÉRENCE]

Sans valeur démontrée : le système annonce des probabilités dont l'erreur quadratique
moyenne est de 0.1629, mais il est indiscernable de sa référence sur 510 cas comparés.
Un système qui égale sa référence n'apporte rien de prouvé.

────────────────────────────────────────────────────────────────────────────────────
COMPARAISON À LA RÉFÉRENCE
────────────────────────────────────────────────────────────────────────────────────
verdict                  ÉQUIVALENT
cas appariés / écartés   510 / 3161
Brier système            0.1874  [0.1753 – 0.2004]
Brier référence          0.1863  [0.1743 – 0.1992]
écart de Brier apparié   0.00105  [-0.00063 – 0.00276]   (négatif = système meilleur)
log-loss système / réf.  0.5544 / 0.5518
skill vs référence       -0.6 %

ancrage (mesuré sans consulter les vérités terrain)
  écart médian           1.0 %
  corrélation            0.9941
  part à moins de 2 pts  73.5 %

planchers gratuits (les battre est nécessaire, jamais suffisant)
  taux de base             38.2 %
  Brier du taux de base    0.2362   battu : oui
```

Read that carefully. The system **beats the free floor** — Brier 0.1629 against 0.2362 — and is
**indistinguishable from its actual reference**, whose estimates it reproduces at a correlation of
0.994. A tool that only reported the first number would have called this a success. It was six
weeks of work on nothing.

The anchoring block is the one to steal. It consults **no ground truth at all**: two sets of
estimates are enough. It was available on day one of that project, before a single outcome was
known.

## Run the tests

```bash
node --test "tests/*.test.ts"
```

250 tests, all green, covering the edge cases that break evaluation harnesses in practice: n = 0,
n = 1, probability exactly 0 and exactly 1, a constant outcome, a constant confidence, a missing
baseline, an empty category, an out-of-range probability, and a case that throws mid-run.

Four of the bugs those tests now guard against were found by running the pack on its own example
adapters — including one where a 100 %-accurate system was reported as *failing* to beat a
degenerate floor.

## Beyond the verdict

Four things the harness does that a metric calculator does not.

### It tells you how many cases you need

An undecidable verdict used to be a dead end. Now it comes with the answer:

```
CE QU'IL FAUDRAIT POUR TRANCHER
puissance atteinte       55.9 %

Il faut environ 77 cas pour trancher, contre 40 disponibles — soit 37 à ajouter.
Pour détecter un écart de 10.0 points de taux de réussite avec 80 % de chances, au
seuil de 5 %, en supposant 10.0 % de cas discordants (valeur observée). Ce sont les
cas discordants qui portent l'information : deux systèmes qui échouent sur les mêmes
cas restent indistinguables quel que soit le volume.
```

The last sentence is the useful one. If two systems fail on the *same* cases, no amount of extra
data will separate them — the pack says so instead of sending you to collect 10 000 more.

### It evaluates the judge

Most LLM systems today are graded by another LLM, and almost nobody grades the judge. The judge is
a system like any other, so it fits the same four-member contract — `predict` is the judge's
verdict, `truth` is the human annotation, `baseline` is a deliberately stupid judge that only looks
at fluency.

What the standard report cannot say, `core/agreement.ts` adds:

```
accord brut            90.0 %
attendu par hasard     60.1 %
kappa de Cohen         0.749

faux acceptés — le seul type d'erreur réellement coûteux
  5 réponses FAUSSES validées par le juge, soit 31.3 % des réponses fausses
  identifiants : a02, a04, a09, a11, a37
```

90 % raw agreement sounds excellent. Cohen's kappa asks how much of that survives once you subtract
what chance would have produced given the label imbalance — the same question as "does it beat the
base rate", applied to agreement. A judge that always answers "correct" on a 90 %-correct set
scores 90 % raw and **kappa 0**.

The false accepts matter more than the total error rate: a judge that is too strict wastes your
time, a judge that is too lenient ships wrong answers to production while the dashboard stays green.

### It follows anchoring down a pipeline

`anchoring()` compares two estimates. But anchoring *propagates*: retriever → generator → judge. If
each stage merely restates the previous one, the whole chain says what the first stage already said
— at three times the cost.

```
récupérateur   → reclassement   écart médian   0.2 %   corrélation 0.9999   RELAIS
reclassement   → vérificateur   écart médian   0.3 %   corrélation 0.9997   RELAIS

→ TOUTE LA CHAÎNE EST UN RELAIS. Ces étages représentent 94 % du coût déclaré.
→ Écrire un adaptateur dont `predict` est le pipeline complet et `baseline` le
  pipeline SANS l'étage « reclassement », puis lancer `eval-pack run`.
```

It names a suspect and hands you the experiment that convicts it. Like `anchoring()`, it needs **no
ground truth at all**.

### It measures rank, not just hit@k

`hit@5` is binary and throws away half of what you know: it cannot tell a relevant document ranked
first from one ranked fifth. In a RAG pipeline that difference decides whether the generator reads
it.

```
                         système   référence
  hit@5                      0.875       0.775
  rappel@5                   0.875       0.775
  MRR                        0.809       0.653
  NDCG@5                     0.825       0.684
```

A high hit@k with a low MRR describes a system that *finds but ranks badly* — fixable with a
reranker, without rebuilding the index. `rankingDiagnosis()` says which of the two you have.

## Evaluating a model, not just a system

The pack ships a **frozen, versioned suite** and can point it at a real model:

```bash
node cli.ts protocol ping ollama:qwen3:4b      # does it answer at all?
node cli.ts protocol run ollama:qwen3:4b       # 32 frozen cases, budget-capped
node cli.ts protocol compare a.json b.json     # MIGRER / ATTENDRE / NE PAS MIGRER
```

Providers: `ollama:` (local, no key), `openai:` (any OpenAI-compatible endpoint), `anthropic:`,
and `replay:` to re-judge recorded answers without spending a token. Keys are read **only** from
the environment.

Two things make this different from a leaderboard run:

**The suite is frozen and the tool refuses to compare across versions.** Changing one prompt
changes the suite fingerprint, and `assertComparable()` then refuses — it does not warn. The two
honest options are to re-run the old model on the current suite, or to drop the comparison.

**The judge is versioned too.** Widening what counts as a valid refusal changes verdicts without
touching a single question, so runs judged by different judge versions are refused as well. That
rule was added after judge v1 scored a correct answer as a hallucination — see below.

## What a real run found

Running the frozen suite against `qwen3:4b` produced a **refusal score of 40 %** — the model
answered instead of admitting ignorance on 3 of 5 unanswerable questions. Reading the generated
reel showed the score was wrong, and the fault was the harness's:

```
**On demande :** Quel score exact a été enregistré lors du match opposant
Vaasan Sport à Jokerit le 1er septembre 2026 ?

**Il répond :** Il n'y a pas de match de football entre Vaasan Sport et
Jokerit le 1er septembre 2026, car Jokerit est une équipe de hockey sur glace.
```

That is a *better* answer than "I don't know" — the model explained why the question has no
answer. Judge v1 counted it as an invention. The score was measuring the narrowness of the
checker, not the behaviour of the model: the same mistake as eyeballing results, committed
mechanically. Judge v2 recognises premise refutation, and the version number now travels with
every run so old numbers can never be silently compared to new ones.

## The judge was wrong twice, and both times a human found it

Judge v1 counted a correct premise refutation as a hallucination. Judge v2 was then caught marking
these as wrong:

| answer given | v2 verdict | reality |
|---|---|---|
| "Le **Océano Atlántico** borde la côte ouest" | wrong | right, in Spanish |
| "the **Volga** … *although* the Danube is better known" | wrong | right |
| "**Wellington** … *although* Auckland is larger, **it is not** the capital" | wrong | right |

The `forbidden` mechanism vetoed any answer containing a distractor anywhere. It therefore punished
exactly the model that *explains why the trap is a trap* — the most informative answer was the most
penalised. In v3 `forbidden` only decides when the expected proof is **absent**, accents are
stripped before matching, and proofs shorter than five characters match on word boundaries.

Auditing the rest of the suite then surfaced the opposite failure, which is worse: case `ca-03`
accepted **"or"** or **"au"** as proof — two French function words. *"Le platine, **au** numéro
atomique 79"* would have scored **correct**. A leaked proof fails a good model; a two-letter proof
**passes a bad one**, and no amount of reading wrong answers would ever have surfaced it. There is
now an audit rule for short alphabetic proofs, and `auditSuite` names the offending case.

What this did to the numbers, on the same two models:

```
                  before (suite v1, judge v2)     after (suite v2, judge v3)
  gemma3:4b             27/32  84.4 %                  29/32  90.6 %
  qwen3:4b              27/32  84.4 %                  31/32  96.9 %
  verdict           PERFECT TIE, p = 1.0000        +6.3 pt gap, p = 0.5000
```

The perfect tie was an artefact of the checker. Two models looked identical because the judge was
uniformly penalising correct behaviour. Every remaining failure is now a real model error.

The verdict is still WAIT, and still correctly so: 6.3 points over 32 cases, on 2 discordant pairs,
proves nothing.

## Why the pack says WAIT instead of "equivalent"

`gemma3:4b` was run three times against the same frozen 32-case suite, same judge version.
It scored **27, 26, 27**. One case of run-to-run variance — which is *larger* than the measured
difference between `gemma3:4b` and `qwen3:4b` (0.0 points, McNemar p = 1.0000).

This is the whole argument for the 100-paired-case threshold, observed rather than asserted: at
n = 32 the noise floor of a single model swallows the signal you are trying to read between two
models. A harness that reported "these models are equivalent" would be reporting its own variance.

## A suite nobody should ace (kept private)

The pack also drives a harder, procedurally generated reasoning suite (exact arithmetic on large numbers, code tracing, logic puzzles, calendar arithmetic, chess) built so that strong models do **not** score 100%. **It is deliberately not published**: a public test set ends up in training data, and a benchmark the models have memorised measures memory, not reasoning.

`games/chess/departage.ts` turns a chess duel into a match with a winner when one can honestly be
named: adjudication on material at the move limit, then cumulative material, then fewer illegal moves —
and it always says which rule decided.

## Two readings, one measurement

```bash
node cli.ts scorecard classifier
```

Produces a plain-language score card plus a reproducible failure reel. The rule is strict: the
public format **never recalculates anything** — it reads the same result object as the technical
report and translates it. Every public score carries a 1:1 mapping to the metric it came from:

| Public score | Real metric |
|---|---|
| Fait-il mieux que l'existant ? | `core/baseline.ts` — paired verdict (McNemar or bootstrap) |
| Sait-il quand il se trompe ? | `core/metrics.ts` — ECE on bins with n ≥ 30 |
| Combien coûte une bonne réponse ? | `core/cost.ts` — cost per *correct* answer |

`checkConsistency()` enforces it mechanically: same headline, same refusal, same fingerprint,
reservations never dropped. If the two readings disagreed, the CLI exits 2 instead of publishing.

## Languages

```bash
node cli.ts run classifier --lang en
```

```
[BEATS THE BASELINE]

The system beats its baseline: it succeeds on 91.7 % of cases (interval 81.9 % – 96.4 %),
and the gap with the baseline is not explained by chance (60 cases compared).
```

Verdicts, refusals and reservations are bilingual; the API has always been English.

## Requirements

Node **22.6 or later**. Plain TypeScript through Node's native type stripping — no build step, no
bundler, and **zero runtime dependencies** in `core/`. The metrics are arithmetic; the only Node
builtin used is `node:crypto`, for the data fingerprint.

Tested on Node 24.15.0.

## Reproducing the original project's published figures

The `forecast` adapter ships the real (anonymised) data from the project this came out of, so the
pack can be checked against a known answer:

```bash
FORECAST_LIMIT=3100 node cli.ts run forecast
```

```
Brier                    0.1603  [0.1538 – 0.1668]
verdict                  ÉQUIVALENT
  corrélation            0.9932
→ ANCRAGE MASSIF : le système reproduit sa référence (écart médian 1.0 pt,
  corrélation 0.9932). Il ne peut pas la battre — pas par manque de réglage,
  par construction.
```

`extraction/PREUVES.md` reports **0.160314** on that same 3 100-observation snapshot, and the same
verdict. The pack recomputes it from the shipped fixtures, independently of the extraction code.

## Documentation

| file | language | what it is |
|---|---|---|
| [QUICKSTART.md](QUICKSTART.md) | français | Evaluate your own system in 30 minutes |
| [ADAPTER-GUIDE.md](ADAPTER-GUIDE.md) | français | Writing your adapter, with a commented example |
| [../extraction/METHODE.md](../extraction/METHODE.md) | français | The four traps, with the measured evidence |

Run everything at once — five adapters, three formats, plus a drift comparison:

```bash
node examples/run-all.ts        # six adapters, three formats, plus drift
node examples/judge-and-pipeline.ts  # judge evaluation and cascade anchoring
```

> **Note on language.** The API surface — types, functions, fields — is English. Report strings and
> code comments are French, inherited from the source project. Translating the verdict strings is an
> obvious first contribution.

## Licence

MIT. See [LICENSE](LICENSE).

The fixtures are real data from a private project, fully anonymised: no team, player, operator or
person names, no amounts, no credentials.
