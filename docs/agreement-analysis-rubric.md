# Agreement/Disagreement-Form Rubric

Used by projects of type **Agreement Analysis** (`annotation_type = "agreement_analysis"`).
This page summarises the *Agreement/disagreement-form backbone annotation manual* (v0.1) of the
DebaQi adjacency-pair work and how it maps onto the platform. It is the sibling of the
[question-form rubric](question-analysis-rubric.md).

---

## Core rule

Mark a turn only when **its own wording explicitly displays agreement or disagreement**.

This is a *form* annotation: it does not decide whether the turn actually agrees with an Assessment,
what it responds to, or whether it forms an adjacency pair — that is the pairing instrument's job.
Each turn is judged **independently**: do not read backward or forward.

> **Context-independence test:** if you must inspect another turn to decide whether the current turn
> displays agreement or disagreement, the current turn is **not marked**.

---

## What counts (rubric §4)

| Label | Check | Examples |
|---|---|---|
| `agreement-form` | `agreement_verb` | *I agree · I completely agree · I couldn't agree more* |
| `agreement-form` | `correctness_formula` | *You're right · That's correct · I think you're right* |
| `agreement-form` | `truth_confirmation_formula` | *That's true · Very true · So true* |
| `agreement-form` | `shared_position_formula` | *I feel the same way · I share that view · I see it the same way* |
| `disagreement-form` | `disagreement_verb` | *I disagree · I don't agree · I can't agree with that* |
| `disagreement-form` | `incorrectness_formula` | *You're wrong · That's not right · That's incorrect* |
| `disagreement-form` | `falsity_formula` | *That's not true · I don't think that's true · That's false* |
| `disagreement-form` | `alternative_position_formula` | *I see it differently · I don't share that view · I have a different opinion* |

Each check has exclusions: reported agreement (*She agrees with him*), other senses of *right* /
*wrong* / *true* (*Turn right*, *I took the wrong bus*), and a different proposition stated without an
explicit contrast marker (*I think beauty depends on culture*) are not marked.

## What does not count (rubric §5)

Bare *yes / yeah / no / nope*; bare *right / exactly / absolutely / definitely / indeed / sure*
(but *You're absolutely right* and *I definitely agree* do count); positive or negative assessments
(*That's interesting*, *That's ridiculous*); independent opinions; semantic compatibility or opposition
between turns; epistemic uncertainty (*maybe*, *I'm not sure*).

---

## Recording in the platform (rubric §6)

| Manual field | Platform field | Values |
|---|---|---|
| Turn ID | the turn being annotated | — |
| Label | `form` | `agreement-form`, `disagreement-form`, or `none` (*Not marked*) |
| Triggering marker — check | `marker_check` | one of the 4 checks of the chosen label (single choice) |
| Triggering marker — cited span | `marker_span` | the exact token or span, ≤ 300 characters |
| Clarity | `borderline` | unchecked = `clear`, checked = `borderline` |
| Multi-form flag | `multiform` (*Also question-form*) | `yes` when the turn also carries question-form |

- **Not marked** is stored as an explicit `none` decision so that "reviewed, not marked" can be told
  apart from "not reviewed yet". Annotators do not need to set it turn by turn: **Finish room** saves
  every turn left without a decision as `none` and marks the room as finished.
- A marked turn is **incomplete** until both the check and the cited span are filled in. Incomplete
  turns are flagged in the interface and block **Finish room**.
- `borderline` is for indeterminacy in the **form itself** (partial, garbled or genuinely ambiguous
  wording), never to rescue context-dependent agreement such as a bare *Yes*.
- A turn with markers of both polarities gets a single label and is marked **borderline**.

---

## Inter-annotator agreement

Computed per pair of annotators over the turns **both** have completed (every turn has a complete
decision once a room is finished):

| Component | Over | Definition |
|---|---|---|
| Form agreement | all common turns | % of turns with the same label (agreement-form / disagreement-form / none) |
| Form κ | all common turns | Cohen's κ on the same 3-way label; *n/a* when undefined (both annotators used one identical label throughout) |
| Marker agreement | turns both marked with the same label | % with the same check |
| Clarity agreement | turns both marked | % with the same clarity |
| Multi-form agreement | turns both marked | % with the same multi-form flag |
| **Combined IAA** | — | mean of the percentage components above that have turns to compare |

Unlike question analysis, clarity and multi-form are only compared on turns both annotators marked:
on unmarked turns they are always false and would inflate agreement. A room's status is
**Complete** when every assigned annotator has finished it, **Partial** when at least two have, and
**Not enough data** otherwise.
