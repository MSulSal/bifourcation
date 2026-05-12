# Animation Implementation

## Purpose

This document explains how the animation system in Bifourcation was implemented from the first version to the current version.

The animation system has one main job:

```txt
take computed Fourier terms
evaluate them over time
draw the rotor chain
trace the endpoint
preserve completed Fourier-drawn strokes
support different animation timing modes
```

It also coordinates drawing mode, pause behavior, snapshots, the rotor view selector, the settings drawer, shape placement, history changes, and sound timing.

The most important current rule is:

```txt
same traced distance → same amount of time
```

Earlier versions gave every stroke the same animation duration. That was simple, but it was wrong for the intended feel of the app. A tiny stroke should not take as long to trace as a long contour.

The current animation system is path-length based.

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
	terms,
}
```

The important design decision was that every input source becomes a normal stroke before animation.

```txt
freehand drawing
shape placement
image tracing
→ Stroke[]
→ resampled path
→ Fourier terms
→ animation
```

The animation renderer does not care whether a stroke came from a pointer gesture, a generated shape, or an imported image contour.

---

## The old fixed-duration model

The first multi-stroke version used a fixed duration for each stroke.

Conceptually:

```txt
total animation time = stroke count × stroke duration
```

The active stroke index was computed from elapsed time:

```txt
strokeIndex = floor(loopElapsed / STROKE_DURATION_MS)
```

The progress within that stroke was:

```txt
progress = strokeElapsed / STROKE_DURATION_MS
```

That worked mechanically, but it had a bad visual consequence:

```txt
short stroke → same duration as long stroke
long stroke  → same duration as short stroke
```

A small line, a tiny dot-like contour, a large circle, and a long traced image outline all took the same amount of time.

That made the animation feel like a slideshow of strokes instead of a drawing reconstruction.

---

## Length-based timing

The current model uses path length.

The rule is:

```txt
duration = path length / drawing speed
```

with minimum and maximum duration clamps so extremely tiny or extremely long strokes remain usable.

Conceptually:

```ts
const DRAW_SPEED_PX_PER_MS = 0.16;
const MIN_STROKE_DURATION_MS = 900;
const MAX_STROKE_DURATION_MS = 28000;
```

The helper for measuring a path is:

```ts
function getPathLength(points: Point[]) {
	let total = 0;

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];

		total += Math.hypot(current.x - previous.x, current.y - previous.y);
	}

	return total;
}
```

The duration of a stroke is:

```ts
function getStrokeDurationMs(stroke: AnimatedStroke) {
	const length = getPathLength(stroke.path);

	if (length === 0) return MIN_STROKE_DURATION_MS;

	return Math.min(
		MAX_STROKE_DURATION_MS,
		Math.max(MIN_STROKE_DURATION_MS, length / DRAW_SPEED_PX_PER_MS),
	);
}
```

This gives the behavior the app wants:

```txt
same length → same duration
shorter stroke → shorter duration
longer stroke → longer duration
```

The animation now feels more like drawing at a consistent tracing speed.

---

## Sequential mode

Sequential mode is the original conceptual animation mode, now with length-based timing.

It traces strokes in drawing order:

```txt
stroke 1 animates
stroke 1 remains as a Fourier trace
stroke 2 animates
stroke 1 and stroke 2 remain as Fourier traces
stroke 3 animates
...
```

The difference from the earlier version is that each stroke gets its own duration based on its path length.

So the total duration is no longer:

```txt
stroke count × fixed duration
```

It is now:

```txt
sum of all stroke durations
```

A sequential timeline is built like this:

```ts
type StrokeTimelineEntry = {
	stroke: AnimatedStroke;
	startMs: number;
	endMs: number;
	durationMs: number;
};

function getSequentialTimeline(strokes: AnimatedStroke[]) {
	const timeline: StrokeTimelineEntry[] = [];
	let cursorMs = 0;

	for (const stroke of strokes) {
		const durationMs = getStrokeDurationMs(stroke);

		timeline.push({
			stroke,
			startMs: cursorMs,
			endMs: cursorMs + durationMs,
			durationMs,
		});

		cursorMs += durationMs;
	}

	return {
		timeline,
		totalDurationMs: Math.max(cursorMs, MIN_STROKE_DURATION_MS),
	};
}
```

Then a loop time is mapped into the active stroke and local progress:

```ts
function getSequentialFrame(strokes: AnimatedStroke[], loopElapsed: number) {
	const { timeline } = getSequentialTimeline(strokes);

	if (timeline.length === 0) {
		return {
			strokeIndex: 0,
			progress: 0,
		};
	}

	const timelineIndex = timeline.findIndex(
		entry => loopElapsed >= entry.startMs && loopElapsed < entry.endMs,
	);

	const strokeIndex =
		timelineIndex === -1 ? timeline.length - 1 : timelineIndex;

	const entry = timeline[strokeIndex];
	const strokeElapsed = loopElapsed - entry.startMs;

	return {
		strokeIndex,
		progress: Math.min(1, Math.max(0, strokeElapsed / entry.durationMs)),
	};
}
```

The current stroke is evaluated at that local progress.

---

## Together mode

Together mode was added later because sequential reconstruction is not the only useful view.

Sequential mode says:

```txt
show me the drawing being rebuilt stroke by stroke
```

Together mode says:

```txt
show me the whole drawing emerging as one synchronized system
```

In Together mode:

```txt
all strokes begin at the same time
each stroke uses its own length-based duration
short strokes finish first
long strokes continue
the loop ends when the longest stroke finishes
```

The full cycle duration is:

```ts
function getSimultaneousCycleDuration(strokes: AnimatedStroke[]) {
	if (strokes.length === 0) return MIN_STROKE_DURATION_MS;

	return Math.max(...strokes.map(getStrokeDurationMs));
}
```

Each stroke maps the shared loop time into its own progress:

```ts
function getSimultaneousStrokeProgress(
	stroke: AnimatedStroke,
	loopElapsed: number,
) {
	const durationMs = getStrokeDurationMs(stroke);

	return Math.min(1, Math.max(0, loopElapsed / durationMs));
}
```

This means that at the same loop time:

```txt
short stroke:
  may already be finished

long stroke:
  may still be tracing

very long stroke:
  may be much earlier in its reconstruction
```

That is the intended behavior. Together mode starts every stroke together, but it does not pretend all strokes have the same length.

---

## Animation mode type

The animation mode is represented explicitly:

```ts
export type AnimationTraceMode = "sequential" | "simultaneous";
```

The UI labels are:

```txt
Sequential
Together
```

The internal value is `simultaneous`, but the user-facing label is `Together` because it is clearer.

The mode is passed into `RotorCanvas`:

```tsx
<RotorCanvas
	strokes={animatedStrokes}
	isActive={isAnimationMode}
	isPlaying={isAnimationPlaying}
	termLimit={visibleTermCount}
	bivectorView={bivectorView}
	animationTraceMode={animationTraceMode}
/>
```

---

## Why Together mode needed separate trace caches

Sequential mode only has one active stroke at a time.

That means it can use one active trace:

```ts
const traceRef = useRef<Multivector[]>([]);
```

Together mode has multiple active strokes at the same time.

So it needs one trace per stroke:

```ts
const simultaneousTraceCacheRef = useRef<Map<string, Multivector[]>>(new Map());
```

Each stroke gets its own endpoint trace:

```ts
function getSimultaneousTrace(strokeId: string) {
	const existingTrace = simultaneousTraceCacheRef.current.get(strokeId);

	if (existingTrace) return existingTrace;

	const nextTrace: Multivector[] = [];
	simultaneousTraceCacheRef.current.set(strokeId, nextTrace);

	return nextTrace;
}
```

When the Together loop wraps back to the beginning, all simultaneous traces are cleared:

```ts
if (loopElapsed < lastSimultaneousLoopElapsedRef.current) {
	clearSimultaneousTraces();
}
```

This prevents stale traces from a previous loop from remaining in the new cycle.

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

In Sequential mode, completed traces are stored in:

```ts
const completedTraceCacheRef = useRef<
	Map<string, { path: Point[]; progress: number }>
>(new Map());
```

When moving from one stroke to the next, the app caches the trace that was actually drawn:

```ts
function cacheCompletedTrace(stroke: AnimatedStroke | undefined) {
	if (!stroke || traceRef.current.length < 2) return;

	completedTraceCacheRef.current.set(stroke.id, {
		path: traceRef.current.map(getCanvasPoint),
		progress: cachedProgress,
	});
}
```

This is better than recomputing the completed stroke from scratch because it preserves what the viewer actually saw being traced.

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

Instead of replacing the completed stroke with a new reconstructed path or with the original path, the animation caches the endpoint trace that appeared during the active animation.

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

The final animation-side decision is conservative:

```txt
the Fourier terms remain the original periodic DFT terms
the visible animation avoids the final artificial seam interval
completed strokes preserve the actually drawn trace
```

This keeps the rotor-chain behavior intact.

---

## Drawing original input during animation

The app has two visible drawing layers:

```txt
raw drawing canvas
Fourier animation overlay
```

When animation mode is active, the raw drawing canvas remains faintly visible.

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

The primary controls are:

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
  clears selected shape tool

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
  clears selected shape tool
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

A translucent pause icon appears in the center of the canvas to make this state clear.

---

## Resetting animation side effects

Many user actions invalidate the current animation state.

Examples:

```txt
drawing a stroke
placing a shape
importing an image
undo
redo
clear canvas
changing animation mode
```

When the underlying strokes change, stale animation traces must not remain visible.

The app therefore resets animation side effects:

```txt
stop playing
return to draw mode when appropriate
close snapshot menu
stop sound
reset sound clock
clear animation traces
```

This matters especially for undo and redo. Without resetting cached traces, the app could show Fourier traces for strokes that no longer exist.

---

## History and animation

Undo/redo operate on committed drawing states.

A committed drawing state can come from:

```txt
freehand stroke
shape placement
image import
clear canvas
```

History is not animation-specific, but animation has to respond to it.

When history changes, the animation layer resets because the underlying `Stroke[]` has changed.

The animation renderer treats the new stroke array as the source of truth and clears:

```txt
active trace
completed trace cache
simultaneous trace cache
active stroke index
last drawn frame
animation start clock
```

That makes undo/redo safe.

---

## Shape placement and animation

Shape tools do not add a special animation path.

A placed shape becomes a normal `Stroke`.

The placement flow is:

```txt
select shape in gear drawer
press canvas to anchor
drag to scale and rotate
release to finalize
```

Once finalized:

```txt
shape points
→ Stroke
→ resampled path
→ Fourier terms
→ rotor animation
```

The animation system does not need to know that a stroke came from a shape.

That is the main reason shape tools stayed simple.

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

## Disk view

Disk view emphasizes rotational symmetry.

A Fourier term has constant magnitude while its phase changes. Its endpoint traces circular motion.

Disk mode represents the current rotor-driven term with an equal-area disk glyph.

If the current component vector has length:

```txt
|r|
```

then the associated oriented area magnitude is:

```txt
|r|²
```

A disk with radius `R` has area:

```txt
πR²
```

So the radius is chosen as:

```txt
R = |r| / √π
```

The disk is not the rotor itself.

The rotor is the action:

```txt
Rₖ(t) = e^(e₁e₂ · 2πkt)
```

The disk is a glyph for the current rotor-driven term.

The arrows on the disk mark phase/orientation. They do not mean the plane `e₁e₂` itself is rotating.

---

## Blade view

Blade view is the most direct oriented-area view.

Given a component vector:

```txt
r
```

the app draws its `e₁e₂`-rotated companion:

```txt
e₁e₂r
```

Because `e₁e₂` is a unit plane element, the companion has the same length and is perpendicular to `r`.

So the blade spanned by:

```txt
r
e₁e₂r
```

appears as a square.

That does not mean bivectors are squares. A bivector is oriented area. The square is a representative of the oriented area generated by that vector and its companion.

The wording to keep in mind is:

```txt
Blade mode represents each component's oriented area using the square spanned by the component vector and its e₁e₂-rotated companion.
```

---

## Companion view

Companion view shows the action of `e₁e₂` directly.

Given the current component vector:

```txt
r
```

the companion vector is:

```txt
e₁e₂r
```

The visual shows:

```txt
r
and
e₁e₂r
```

This makes the 90° plane action visible without filling in the oriented area.

Companion view is useful when the user wants to see:

```txt
the vector
its bivector-generated quarter-turn
the relationship between them
```

---

## Positive and negative frequencies

Positive and negative Fourier frequencies are visually distinguished by orientation cues, not by unrelated colors.

The stroke color remains the identity of the stroke.

Opposite frequency orientation is shown through:

```txt
direction arrows
hatching
dashed companion lines
```

This keeps the color system meaningful:

```txt
color = stroke identity
orientation cues = frequency direction
```

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

This makes the final reconstruction feel like the drawing was recreated, not just approximated by a generic white line.

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
or generated shape
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
offer share if supported
fall back to PNG download
```

The snapshot function composites the visible canvas layers into a new canvas and exports a PNG.

If animation is currently active, the snapshot captures the current frame and then pauses. That prevents the image from changing immediately after the user captures it.

---

## Settings drawer

The UI originally had too much control clutter around the canvas.

The final layout moves secondary controls into a right-side translucent drawer.

The drawer is opened with a gear icon because it now contains general tools and settings, not just color controls.

The drawer contains:

```txt
history controls
animation mode selector
shape tools
color palette
pen width
image import
rotor-plane explanation
```

Only primary controls remain at the bottom.

The canvas also shows metrics as faint top text instead of large cards, so drawing space remains usable.

---

## Animation mode selector

The drawer includes the animation mode selector:

```txt
Sequential
Together
```

Sequential is the classic stroke-by-stroke reconstruction.

Together starts all strokes at the same time.

This selector changes the orchestration of the animation, but it does not change the Fourier terms.

The same strokes and terms are used in both modes.

---

## Sound synchronization

The sound engine originally followed the old fixed-duration sequential animation model.

That became wrong after two updates:

```txt
1. animation timing became path-length based
2. Together mode was added
```

The sound engine now receives the animation trace mode:

```ts
activeEngine.tick(sonicStrokes, bivectorView, animationTraceMode);
```

The sound engine uses the same timing idea as the visual system:

```txt
Sequential:
  one active stroke at a time
  stroke progress follows path-length duration

Together:
  multiple active strokes can sound
  all strokes share the same loop clock
  each stroke maps that clock into its own path-length duration
```

Together mode caps simultaneous sound voices so dense drawings do not turn into noise.

The sound remains musicalized sonification, not literal Fourier audio.

---

## Rendering philosophy

The animation renderer owns visualization, not mathematics.

The math pipeline gives it:

```txt
resampled path
Fourier terms
evaluated rotor states
current reconstructed point
```

The renderer decides how to display those states:

```txt
traces
component chains
disks
blades
companions
labels
tip marker
completed strokes
```

This separation matters because visual modes should not modify the Fourier terms.

The same mathematical reconstruction can be shown in multiple visual languages.

---

## Main data flow

The current animation pipeline is:

```txt
Stroke[]
→ resample each stroke by arc length
→ compute Fourier terms for each stroke
→ AnimatedStroke[]
→ choose animation mode
→ compute time/progress
→ evaluate Fourier terms
→ draw rotor chain
→ append endpoint trace
→ cache completed traces when needed
```

The animation mode changes only the timing and orchestration.

It does not change:

```txt
stroke data
resampling
Fourier terms
geometric algebra operations
visual glyph definitions
```

---

## Current final behavior

The current animation system supports:

```txt
freehand strokes
shape strokes
image-traced strokes
undo / redo-safe drawing state
path-length-based timing
Sequential mode
Together mode
completed Fourier trace caching
Disk / Blade / Companion rotor views
tiny rotor labels
snapshot capture
sound synchronization
```

The most important conceptual change from the earlier version is:

```txt
The app no longer treats each stroke as equal-time.
It treats equal path length as equal tracing time.
```

That makes the animation feel much closer to drawing.

---

## Final mental model

```txt
A stroke is not a timed slide.
A stroke is a path with length.

The Fourier terms reconstruct that path.
The endpoint traces the reconstruction.

Sequential mode asks:
  Which stroke is currently being traced?

Together mode asks:
  Where is each stroke along its own length-based clock?

Completed traces are not raw input.
They are the Fourier traces the animation actually drew.

The drawing appears by rotor-driven superposition in the e₁e₂ plane.
```
