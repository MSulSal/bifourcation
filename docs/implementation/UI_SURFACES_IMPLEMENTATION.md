# UI Surfaces Implementation

## Purpose

This document explains the current control-surface architecture in Bifourcation.

The goal was:

```txt
keep the canvas clear
keep primary actions always reachable
keep mobile interactions practical
avoid full-screen control overlays
```

---

## Why the old layout changed

Earlier versions concentrated many controls in a single settings drawer.

That worked functionally, but it had drawbacks:

```txt
too many unrelated controls in one place
extra taps to reach common actions
more chance of controls overlapping working canvas space
```

The app moved to smaller, task-focused floating surfaces.

---

## Current control map

Bottom bar primary actions:

```txt
Draw
Edit
Fill
Animate / Pause
Clear
```

Right-side floating buttons:

```txt
rotor drawer
shape drawer
color drawer
stroke-width drawer
animation style toggle
```

Bottom-right utility buttons:

```txt
volume drawer
image import
snapshot menu
```

Floating history controls:

```txt
undo
redo
```

The selected-object action bar appears in edit mode:

```txt
Duplicate
Copy
Paste
Flip H
Flip V
Delete
```

---

## Drawer positioning and behavior

Right-side drawers open to the left of their buttons so the trigger remains visible.

This prevents a common mobile issue where the panel covers the control that should close it.

Drawers use a shared tap-away behavior:

```txt
if pointer down is outside [data-floating-ui='true']:
  close all open floating drawers
```

Escape also closes open drawers.

---

## Animation style toggle

Animation style is a single toggle button rather than a popover list.

Icon mapping:

```txt
ArrowDown01         = Sequential
ArrowDownFromLine   = Together (parallel)
```

The toggle affects orchestration only, not Fourier term computation.

---

## Volume-first sound UX

The visible sound control is volume-first:

```txt
tap speaker icon → open vertical volume drawer
volume 0         → muted icon and no sound playback
volume > 0       → active icon and sound-eligible playback
```

This avoids a separate on/off button while keeping muting explicit and fast.

---

## Snapshot and export entrypoint

MP4 export was moved under the snapshot menu to avoid crowding the mobile bottom bar.

Snapshot menu actions:

```txt
Export MP4
Share snapshot
Download PNG
```

This keeps capture-related actions grouped in one place.

---

## Mobile-oriented interaction choices

Keyboard shortcuts still exist, but mobile now has explicit equivalents:

```txt
copy/paste/duplicate/flip/delete via selected-object action bar
always-visible undo/redo buttons
```

The action bar is horizontally scrollable to stay usable on narrow screens.

---

## Persistence boundaries

Persisted UI preferences:

```txt
tool mode
selected shape
pen color
pen width
animation trace mode
bivector view
visible term count
sound volume
```

Not persisted (intentional):

```txt
open/closed drawer state
selection id
context menu position
animation play state
drawing history
```

This keeps restore behavior predictable without reviving stale transient UI states.

---

## Final mental model

```txt
Primary actions stay fixed.
Secondary actions live in small drawers.
Drawers open beside their trigger, not over it.
Tap-away closes temporary surfaces.
Canvas work remains the center of the app.
```

