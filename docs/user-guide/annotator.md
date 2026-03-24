# Annotator Walkthrough

This guide covers the annotator workflow from logging in to marking a room as complete.

---

## 1. Log in

Navigate to the LACE frontend (default: `http://localhost:3721`) and log in with your credentials.

Your home screen lists all projects and chat rooms you have been assigned to, along with their completion status.

---

## 2. Open a Room

Click on a room name to open the annotation interface. The view differs depending on the project's annotation type.

---

## 3. Disentanglement Mode

Turns are displayed chronologically. Each turn shows the author, text, and its current thread colour.

![Disentanglement interface](../screenshots/disentanglement.png)

**Assigning a turn to a thread:**

- Click a **colour swatch** in the right-hand panel to assign the selected turn to that thread.
- Type a thread label directly to assign or create a thread on the fly.
- Press **N** to create a new thread instantly.

**Keyboard shortcuts:**

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate between turns |
| `N` | Create a new thread |
| `1`–`9` | Assign to thread by position in the swatch panel |

!!! tip
    Annotations are saved automatically after every change — no explicit save button is needed.

---

## 4. Adjacency Pairs Mode

Turns are displayed chronologically with colour-coded SVG arcs overlaid for each existing link.

![Adjacency Pairs interface](../screenshots/adjacency_pairs.png)

**Creating a link:**

1. Click a **source turn** to select it (it highlights).
2. Click the **target turn** — a dialog appears to choose the relation type.
3. Confirm to create the directed link. The arc is rendered immediately.

**Deleting a link:**

- Click the arc and confirm removal in the dialog.

**Marking turns as read:**

Each turn has a **read/unread toggle**. Mark a turn as read once you have reviewed it and decided whether links need to be created. You can also use **Mark all as read** to bulk-mark all turns at once. Read status is saved to the server and is visible to the admin in the room view.

!!! note
    If the corpus CSV included a `reply_to_turn` column, suggested links are shown as dashed arcs. Confirm or dismiss each suggestion as you work through the room.

---

## 5. Mark as Complete

When you have finished annotating all turns in a room, click **Mark as Complete** at the top of the interface.

This records your completion in the database and signals to the admin that your annotations for this room are ready for IAA computation. You can unmark a room if you need to make further changes.
