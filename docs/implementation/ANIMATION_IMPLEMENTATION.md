# How I Implemented Animation in Bifourcation

## Purpose

This document explains how the animation system in Bifourcation was implemented from the first version to the current version.

The animation system has one main job:

```txt
take computed Fourier terms
evaluate them over time
draw the rotor chain
trace the endpoint
move through strokes in order
preserve completed Fourier-drawn strokes
```

It also coordinates drawing mode, pause behavior, snapshots, the view selector, and sound timing.

---

## The first version

The first animation version was simple:

```txt
one drawn path
→ compute Fourier terms
→ animate rotating components
→ draw the endpoint trace
```

The canvas had two conceptual layers:

```txt
original drawing layer
animation overlay
```

The drawing layer showed the user's stroke.

The animation overlay drew the Fourier reconstruction.

The first version could animate a single path, but it did not yet handle multiple strokes elegantly.

---

## Moving to multiple strokes

The next major update was sequential stroke animation.

The desired behavior was:

```txt
stroke 1 animates
stroke 1 remains visible
stroke 2 animates
stroke 1 remains paused in place
stroke 2 remains visible
stroke 3 animates
...
```

Each stroke therefore needed its own:

```txt
path
Fourier terms
color
width
animation identity
```

The app computes an `animatedStrokes` array where each stroke contains:

```ts
{
  id,
  color,
  width,
  path,
  terms
}
```

The animation duration is divided by stroke:

```txt
total animation time = stroke count × stroke duration
```

The active stroke index is computed from elapsed time:

```txt
strokeIndex = floor(loopElapsed / STROKE_DURATION_MS)
```

The progress within the current stroke is:

```txt
progress = strokeElapsed / STROKE_DURATION_MS
```

This made the animation naturally step through strokes in order.

---

## The original canvas opacity

Once animation mode was added, the original drawing layer needed to stay visible enough to feel like tracing, but not so visible that it looked like the final result.

The final behavior is:

```txt
draw mode:
  original canvas opacity = normal

animation mode:
  original canvas opacity = heavily reduced
```

This gives the feeling of tracing over the drawing.

It also helps users see that the animated reconstruction is doing the work, not the original canvas.

---

## Draw, animate, pause, and clear

The controls evolved into a small bottom row:

```txt
Draw
Animate / Pause
Clear canvas
```

The final behavior is:

```txt
Draw:
  enters drawing mode
  stops animation
  stops sound
  resets animation clock

Animate:
  enters animation mode
  starts animation

Pause:
  pauses animation but stays in animation mode
  keeps the current frame visible
  does not return to drawing mode

Clear canvas:
  clears raw strokes
  clears animation overlay
  clears completed traces
  resets sound and clock
```

The pause behavior mattered. Pressing pause should not mean:

```txt
leave animation mode
```

It should mean:

```txt
pause the current rotor reconstruction frame
```

A translucent pause icon was added in the center of the canvas to make this state clear.

---

## Button consistency

The button system was later cleaned up.

The active button is white.

Inactive buttons are clear/dark.

This made the controls consistent:

```txt
active mode/action:
  white button

available inactive action:
  clear button

disabled action:
  dimmed button
```

The animation button text changes between:

```txt
Animate
Pause
```

The draw button remains a separate mode control. Pausing animation does not automatically activate drawing.

---

## Rotor views

The animation originally had a simpler component view. Later, the view system became:

```txt
Disk
Blade
Companion
```

The view toggle appears only while animation is active, positioned near the lower-left canvas area.

This placement was chosen because:

```txt
the bottom row should only contain primary controls
the view selector is contextual to animation
```

The view selector changes how each rotor component is drawn, but it does not change the Fourier terms.

The same evaluated term data can be rendered as:

```txt
equal-area disk
oriented blade
companion vector pair
```

---

## The right-side drawer

The UI originally had too much control clutter around the canvas.

The final layout moves secondary controls into a right-side translucent drawer.

The drawer contains:

```txt
color palette
pen width
image import
rotor-plane explanation
```

Only primary controls remain at the bottom.

On mobile, the drawer starts collapsed so it does not crowd the canvas.

The canvas also shows metrics as faint top text instead of large cards, so drawing space remains usable.

---

## Completed strokes

One of the most important animation fixes involved completed strokes.

The early multi-stroke version left the original stroke visible after a stroke finished. That was wrong because the goal was not:

```txt
animate with Fourier, then replace with the user's raw drawing
```

The goal was:

```txt
animate with Fourier, then preserve the Fourier-drawn result
```

So completed strokes needed to be kept as Fourier traces.

The correct behavior is:

```txt
while stroke is active:
  draw rotor chain
  trace the endpoint

when moving to the next stroke:
  preserve the trace that was drawn

later frames:
  redraw that preserved Fourier trace
  do not redraw the original input path
```

This keeps the final drawing honest to the animation.

---

## Avoiding completed-stroke artifacts

The first attempt at preserving completed strokes recomputed a full reconstructed path after the stroke ended.

That caused problems because recomputing a full periodic path can include the artificial period seam:

```txt
end → start
```

This produced connecting lines or horn-like endpoint artifacts.

The better principle became:

```txt
preserve what was actually traced
```

Instead of replacing the completed stroke with a new reconstructed path or with the original path, the animation should cache the endpoint trace that appeared during the active animation.

That keeps completed strokes consistent with what the user watched being drawn.

---

## The open-stroke seam problem

A standard DFT is periodic.

For open strokes, that means the transform naturally wants:

```txt
last sample → first sample
```

That can produce endpoint behavior.

Several approaches were considered:

```txt
mirror the stroke
add a hidden smooth closure
detrend the open path
use a cosine series
redraw the raw path
```

Each of those changed the identity of the animation too much.

The final animation-side decision is more conservative:

```txt
the Fourier terms remain the original periodic DFT terms
the visible animation avoids the final artificial seam interval
completed strokes preserve the actually drawn trace
```

This keeps the rotor-chain behavior intact.

---

## Rotor labels

Tiny rotor labels were added to the animation layer.

The labels are drawn near the first few large rotor components:

```txt
cₖRₖ(t)
```

They are faint and small by design.

They are meant to support the math explanation without turning the canvas into a textbook diagram.

The labels are skipped for tiny components so the screen does not become cluttered.

---

## Stroke colors and widths

Each stroke keeps its original color and width.

The animation uses those same values:

```txt
rotor components match stroke color
endpoint trace matches stroke color
completed trace matches stroke color
stroke width influences trace width
```

This made the final reconstruction feel like the drawing was recreated, not just approximated by a generic white line.

---

## Image-traced strokes

When image tracing was added, imported contours were converted into the same `Stroke` format used by hand drawing:

```ts
type Stroke = {
  color: string;
  width: number;
  points: Point[];
};
```

That was important because it meant image strokes did not need a separate animation system.

The same pipeline applies:

```txt
hand-drawn stroke
or image-traced contour
→ resample path
→ compute Fourier terms
→ animate rotor chain
```

---

## Snapshot behavior

A snapshot button was added as a floating camera icon.

The final behavior is:

```txt
capture current canvas layers
pause animation after snapshot
offer share/download options
```

The button was moved out of the bottom control row because it crowded the primary controls.

On desktop, the snapshot menu includes a direct download option.

On platforms that support native sharing, the share option can use the Web Share API.

---

## Sound timing

Sound was integrated with animation rather than drawing.

The sound engine runs only when:

```txt
sound is enabled
animation mode is active
animation is playing
there are strokes to animate
```

On every animation frame, the sound engine receives:

```txt
sonic strokes
current view
```

The clock used by sound is reset when the animation is reset, cleared, or moved back into drawing mode.

This keeps sound synchronized with the active animated stroke.

The final sound system was intentionally kept separate from the visual renderer. It reads the same stroke and Fourier data, but it does not control drawing.

---

## Responsiveness

The animation canvas is resized with a `ResizeObserver`.

When the canvas display size changes:

```txt
canvas backing size updates
device pixel ratio is respected
last frame is redrawn if animation is active
overlay is cleared if animation is inactive
```

This keeps the overlay sharp and prevents stale animation artifacts after resizing.

The UI also avoids placing large control cards over the canvas in mobile view.

---

## Final animation decisions

The final animation system keeps these decisions:

```txt
Draw and animate are separate modes.
Pause stays inside animation mode.
The original drawing fades during animation.
Strokes animate sequentially.
Completed strokes remain Fourier-drawn.
Rotor components stay visible for completed strokes.
The view mode changes the glyphs, not the math.
Primary controls stay at the bottom.
Secondary controls live in the right drawer.
Snapshot and sound are floating contextual controls.
```

The final product is an animation system that behaves like:

```txt
a drawing is decomposed into rotor terms
each stroke is rebuilt by a synchronized rotor chain
completed reconstructions remain on the canvas
the next stroke begins without erasing the previous one
```

---

## Final mental model

The animation is best understood as a fingertip at the end of a synchronized rotor chain.

Each component contributes one segment.

All segments rotate at fixed frequencies.

The endpoint traces the stroke.

The completed trace remains.

The next stroke starts.

The whole drawing appears through superposition.
