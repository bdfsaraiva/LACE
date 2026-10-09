# Exporting Results

Exports are available from the project view in the Admin Dashboard.

---

## Disentanglement — JSON

Each annotator's labels for each room are exported as a JSON file.

**Trigger:** Open the project → click **Export**.

**Output:** A ZIP archive containing one JSON file per annotator per room.

```json
{
  "project": "My Project",
  "room": "room-01",
  "annotator": "alice",
  "annotations": [
    { "turn_id": "T001", "thread_id": "A" },
    { "turn_id": "T002", "thread_id": "A" },
    { "turn_id": "T003", "thread_id": "B" }
  ]
}
```

---

## Adjacency Pairs — ZIP

Each annotator's links for each room are exported as a plain-text file, one directed edge per line.

**Trigger:** Open the project → click **Export**.

**Output:** A ZIP archive containing one `.txt` file per annotator per room.

```
T002,T001,Question - Response
T004,T001,Assessment - Agreement/Disagreement
```

Format: `<from_turn_id>,<to_turn_id>,<relation_type>` — one directed edge per line, no header row.

This format is the same as the import format, so exported files can be re-imported directly.

---

## Agreement Analysis — JSON and CSV

**Trigger:** Open the project → click **Export JSON** or **Export CSV** on a room.

**JSON** — every decision of every annotator, *Not marked* (`none`) included, with export metadata
(completion status, per-annotator coverage):

```json
{
  "turn_id": "6",
  "turn_text": "I agree, but don't you think culture matters too?",
  "annotations": [
    {
      "annotator_username": "alice",
      "form": "agreement-form",
      "marker_check": "agreement_verb",
      "marker_span": "I agree",
      "clarity": "clear",
      "multiform": true,
      "complete": true
    }
  ]
}
```

**CSV** — the rubric's record table, one row per **marked** turn, as a ZIP with one file per assigned
annotator:

```
turn_id,label,triggering_marker_check,triggering_marker_span,clarity,multi_form
1,agreement-form,agreement_verb,I completely agree,clear,no
6,agreement-form,agreement_verb,I agree,clear,yes
```

---

## IAA Matrix

The inter-annotator agreement matrix can be viewed in the **IAA** tab of the project and is included in the export package.

| Metric | Annotation type | Description |
|---|---|---|
| Per-message accuracy (o2o) | Disentanglement | Fraction of messages consistent under the optimal thread alignment (Hungarian algorithm), following Elsner & Charniak (2008) |
| α × LinkF1 + (1−α) × TypeAcc | Adjacency pairs | Linear interpolation between structural (LinkF1) and label (TypeAcc) agreement; α=1 → LinkF1, α=0 → TypeAcc; α configurable per project |
| Combined IAA + Cohen's κ | Agreement analysis | Mean of form, marker-check, clarity and multi-form agreement, with Cohen's κ on the form label shown in the **Pairwise details** table — see the [rubric](../agreement-analysis-rubric.md#inter-annotator-agreement) |

See [Architecture — IAA](../development/architecture.md#iaa--metrics) for the formal definitions.
