# Sound Implementation

## Purpose

This document explains how sound was implemented in Bifourcation from the first idea to the current design.

The goal was not just to play background audio.

The goal was:

```txt
make the drawing audible
without making users want to turn it off immediately
```

The sound should feel tied to the path and Fourier animation, but it should also be pleasant enough to draw with for a long time.

The desired references were:

```txt
musical glasses
rain drums
wind chimes
grass / breeze
soft ambient game music
```

The rejected sound was:

```txt
mosquito buzzing
retro horror tones
raw harsh sonification
```

The current sound system is a musicalized sonification layer:

```txt
drawing-controlled
Fourier-aware
animation-synced
but musically constrained
```

It does not literally play the Fourier transform as raw audio. It uses the drawing path, Fourier terms, animation mode, and rotor view as control signals for a browser-native Web Audio instrument.

---

## The first idea

The first idea was direct sonification.

The app already had Fourier terms, and each Fourier term has:

```txt
frequency
amplitude
phase
```

It was tempting to convert those directly into audible oscillators.

That would mean:

```txt
Fourier frequency → audio frequency
Fourier amplitude → audio gain
Fourier phase → audio phase
```

This is conceptually elegant.

But it does not automatically sound good.

The drawing frequencies are animation frequencies, not musical frequencies.

Raw mappings can easily produce:

```txt
buzzing
beating
piercing tones
muddy clusters
mosquito-like high frequencies
```

That was not acceptable for the app.

---

## Why raw Fourier audio was rejected

Raw Fourier coefficients are excellent for shape reconstruction.

They are not automatically good instrument controls.

A drawing may contain hundreds or thousands of terms. If too many are mapped to sound, the result becomes noisy.

The frequency spacing of the visual Fourier terms is also not the same as a pleasing musical scale.

So the first major sound decision was:

```txt
do not literally play every Fourier term as an oscillator
```

The sound should be shaped by the drawing and Fourier state, but it should not be a raw audio dump of the transform.

The final principle became:

```txt
Use Fourier data as musical control material, not as literal audio material.
```

---

## Browser-native Web Audio

The sound engine uses the Web Audio API.

That keeps the system:

```txt
browser-native
dependency-free
real-time
small
easy to start and stop with animation
```

The core Web Audio pieces are:

```txt
AudioContext
oscillators
gain nodes
filters
stereo panning
envelopes
delay / feedback
compression
master gain
```

The audio engine is kept separate from the visual renderer.

The renderer draws frames.

The sound engine receives enough animation state to update sound.

---

## User gesture and autoplay

Browsers restrict autoplay.

That means sound cannot always start until the user performs an interaction.

The app therefore treats sound as an explicit user-controlled feature.

The sound preference can be saved locally, but actual audio start may still require a gesture.

The final behavior is:

```txt
speaker button opens volume drawer
volume = 0 behaves as muted
volume > 0 behaves as enabled
animation starts sound only if audible volume is present
pause stops or fades sound
clear resets sound
```

This keeps the app aligned with browser rules.

---

## Sound state

The sound system needs to know:

```txt
is sound volume above zero?
is compatibility enabled flag true?
is animation active?
is animation playing?
which strokes exist?
which animation mode is active?
which rotor view is active?
what is the current animation clock?
```

Sound should not play while drawing normally.

It should play while the animated reconstruction is happening.

That makes the sound feel like it belongs to the Fourier / rotor performance.

The current sound tick receives:

```ts
activeEngine.tick(sonicStrokes, bivectorView, animationTraceMode);
```

where:

```txt
sonicStrokes
  path and Fourier data for every stroke

bivectorView
  Disk, Blade, or Companion

animationTraceMode
  Sequential or Together
```

---

## Sonic stroke data

The app sends the sound engine a reduced audio-facing stroke type:

```ts
type SonicStroke = {
	id: string;
	color: string;
	width: number;
	path: Point[];
	terms: FourierTerm[];
};
```

This mirrors the animation data.

The sound engine does not need React state, canvas state, or drawing UI state. It only needs the ordered path and Fourier terms for each stroke.

That separation keeps sound downstream of the same pipeline:

```txt
freehand drawing
shape placement
image tracing
→ Stroke[]
→ resampled path
→ Fourier terms
→ SonicStroke[]
→ sound engine
```

The sound system does not care whether a stroke came from hand drawing, a generated shape, or an imported image contour.

---

## First sound character

The first sound versions were too harsh.

They sounded more like:

```txt
old horror game
electronic mosquito
detuned alarm
```

The reason was that even softened oscillators can sound unpleasant if the frequency content is too direct or too static.

Simply lowering gain or adding filters made the sound quieter, but not more characterful.

This led to an important distinction:

```txt
hushed is not the same as pleasant
```

The sound needed timbre, not only lower volume.

---

## Drawing-shaped sound

The next idea was to use the drawing as control material.

Instead of treating the sound as a fixed loop affected slightly by the drawing, the sound should be driven by the path.

Useful control signals include:

```txt
path position
path tangent
path curvature
stroke progress
Fourier amplitude
Fourier frequency sign
active rotor view
active animation mode
```

The sound model became:

```txt
path position → pitch contour / stereo position
path tangent → melodic motion
path curvature → sparkle / density
Fourier amplitude → loudness / intensity
frequency sign → stereo or orientation character
view mode → instrument family
animation mode → timing and voice scheduling
```

This made the sound feel more connected to the drawing.

---

## Why the sound should not be too literal

A perfect sonification of the drawing might be mathematically interesting, but unpleasant.

The app needs to be usable as a creative toy.

The final sound direction is therefore musicalized sonification:

```txt
drawing-controlled
but musically constrained
```

That means values can be quantized or smoothed.

For example:

```txt
raw y position
→ mapped into a pleasant pitch range

curvature
→ mapped into occasional sparkle

Fourier amplitude
→ shaped into gain

frequency sign
→ subtle orientation cue

animation mode
→ scheduling model
```

The drawing controls the sound, but the sound engine keeps it inside a pleasant palette.

---

## Timing had to follow animation

The original sound engine followed the original animation model.

That old visual model was:

```txt
every stroke gets the same duration
one active stroke at a time
```

The old sound model matched that:

```txt
total time = stroke count × fixed stroke duration
strokeIndex = floor(loopElapsed / fixed stroke duration)
progress = strokeElapsed / fixed stroke duration
```

That became wrong after two visual changes:

```txt
1. animation timing became path-length based
2. Together mode was added
```

If the sound stayed fixed-duration while the visual animation became length-based, sound and image would disagree.

The fix was to give the sound engine the same timing concepts as the animation renderer:

```txt
stroke duration depends on path length
Sequential mode uses a stroke timeline
Together mode uses a shared loop clock
each stroke maps that clock into its own progress
```

The guiding rule is now the same for sound and visuals:

```txt
same traced distance → same amount of time
```

---

## Length-based sound timing

The sound engine measures each stroke path.

Conceptually:

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

Then it converts length into duration:

```ts
const DRAW_SPEED_PX_PER_MS = 0.16;
const MIN_STROKE_DURATION_MS = 900;
const MAX_STROKE_DURATION_MS = 28000;

function getStrokeDurationMs(stroke: SonicStroke) {
	const length = getPathLength(stroke.path);

	if (length === 0) return MIN_STROKE_DURATION_MS;

	return Math.min(
		MAX_STROKE_DURATION_MS,
		Math.max(MIN_STROKE_DURATION_MS, length / DRAW_SPEED_PX_PER_MS),
	);
}
```

This means:

```txt
short sound stroke → shorter duration
long sound stroke  → longer duration
```

The minimum and maximum clamps keep the sound playable.

Without the minimum, tiny strokes would blip too quickly.

Without the maximum, very large traced image contours could take too long.

---

## Sequential sound mode

Sequential sound mode follows the Sequential visual mode.

It sounds one active stroke at a time.

The active stroke is chosen from a path-length-based timeline.

Conceptually:

```txt
stroke 1 starts at 0ms
stroke 1 duration = length(stroke 1) / speed

stroke 2 starts when stroke 1 ends
stroke 2 duration = length(stroke 2) / speed

stroke 3 starts when stroke 2 ends
...
```

The timeline entry shape is:

```ts
type StrokeTimelineEntry = {
	stroke: SonicStroke;
	startMs: number;
	endMs: number;
	durationMs: number;
};
```

The timeline is built by accumulating durations:

```ts
function getSequentialTimeline(strokes: SonicStroke[]) {
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

Each audio tick maps the current loop time into:

```txt
active stroke
stroke-local progress
stroke duration
```

Then the sound engine samples that stroke path at the same conceptual progress the visual system is tracing.

Sequential mode therefore sounds like:

```txt
one stroke being drawn at a time
with musical events following the current path
```

---

## Together sound mode

Together sound mode follows the Together visual mode.

In Together mode:

```txt
all strokes start together
each stroke has its own length-based duration
short strokes finish first
long strokes continue
the loop ends when the longest stroke ends
```

The shared loop duration is:

```ts
function getSimultaneousCycleDuration(strokes: SonicStroke[]) {
	if (strokes.length === 0) return MIN_STROKE_DURATION_MS;

	return Math.max(...strokes.map(getStrokeDurationMs));
}
```

For each stroke, the sound engine computes:

```txt
progress = loopElapsed / strokeDuration
```

clamped to:

```txt
0 → 1
```

A stroke is considered active for sound while:

```txt
loopElapsed <= strokeDuration
```

So in Together mode:

```txt
a short shape may finish sounding early
a long contour may keep sounding
all active strokes share the same global loop clock
```

This matches the visual behavior.

---

## Why Together sound is capped

Together mode can involve many strokes at once.

If every active stroke triggered audio on every tick, the result would quickly become cluttered.

A traced image might create dozens of contours.

Playing all of them simultaneously would not sound like a drawing; it would sound like noise.

So Together mode caps simultaneous sound voices:

```ts
const MAX_SIMULTANEOUS_SOUND_STROKES = 3;
```

The engine chooses a small rotating window of active strokes.

Conceptually:

```txt
find active strokes
choose up to 3
trigger musical events for those strokes
advance cursor
repeat
```

This gives Together mode a denser and more global sound than Sequential mode, but it avoids turning complex drawings into a wall of tones.

---

## Active stroke selection in Together mode

Together mode builds a list of active sound strokes.

Each active sound stroke contains:

```ts
type ActiveSoundStroke = {
	stroke: SonicStroke;
	progress: number;
	durationMs: number;
	sampled: SampledPathPoint;
};
```

The active list is filtered so the engine prefers strokes that:

```txt
are still in progress
have usable Fourier terms
have nonzero frequency content
```

This avoids spending sound events on finished strokes or silent/degenerate strokes.

The engine then cycles through the active list with a cursor:

```txt
tick 1:
  strokes 1, 2, 3

tick 2:
  strokes 2, 3, 4

tick 3:
  strokes 3, 4, 5
```

When the Together loop wraps back to the beginning, the cursor and note index reset.

That makes each cycle feel fresh rather than carrying stale scheduling state across loops.

---

## Sampling the path

The sound engine samples a stroke path at current progress.

It needs more than just the point.

It computes:

```txt
current point
previous point
next point
normalized x position
normalized y position
curvature
tangent angle
```

The resulting type is:

```ts
type SampledPathPoint = {
	point: Point;
	previous: Point;
	next: Point;
	normalizedX: number;
	normalizedY: number;
	curvature: number;
	tangentAngle: number;
};
```

This is the main bridge between geometry and sound.

The path sample provides the controls for:

```txt
pitch
pan
density
sparkle
melodic direction
```

---

## Position mapping

Path position contributes to sound in two main ways.

Horizontal position controls stereo placement:

```txt
x position → left/right pan
```

Vertical position controls pitch contour:

```txt
y position → scale step
```

This makes the sound spatially follow the drawing.

A stroke moving across the canvas can move across the stereo field.

A stroke moving upward or downward can shift the melody.

This is not literal physics. It is an expressive mapping from visual geometry to musical space.

---

## Tangent mapping

The tangent angle describes the local direction of the path.

The sound engine uses the tangent to influence melodic motion.

Conceptually:

```txt
upward tangent
  can lift the melodic contour

downward tangent
  can lower the melodic contour

sideways tangent
  keeps the line steadier
```

The tangent also influences which Fourier term is selected for a sound event.

That keeps the sound connected to local movement rather than only to absolute position.

---

## Curvature mapping

Curvature describes how sharply the path turns.

A straight segment has low curvature.

A corner or tight bend has higher curvature.

The sound engine maps curvature to:

```txt
event density
sparkle
ornamentation
droplet accents
```

For example:

```txt
low curvature:
  calmer, more even tones

high curvature:
  denser or brighter accents
```

This makes corners and complex shapes sound more animated than straight lines.

---

## Fourier term selection

The sound engine does not play every Fourier term.

Instead, it selects from the strongest audible terms:

```ts
const MAX_SOUND_TERMS = 14;
```

It filters for useful terms:

```txt
frequency is not zero
amplitude is greater than zero
```

Then it chooses a term based on:

```txt
stroke progress
path tangent
note index
voice offset
```

This gives the sound a relationship to the Fourier decomposition without turning the whole transform into raw audio.

The chosen term contributes:

```txt
amplitude
frequency sign
frequency magnitude
```

to the musical mapping.

---

## Amplitude mapping

Fourier amplitude affects intensity.

The engine compares the selected term against the largest audible term:

```txt
amplitudeRatio = selected amplitude / max amplitude
```

Then it maps that ratio into gain.

This makes major structural components sound stronger than tiny detail terms.

The mapping is shaped, not linear, so moderate terms still remain audible without letting the largest term dominate too much.

---

## Frequency sign mapping

Fourier frequency sign carries orientation information.

Positive and negative frequencies rotate in opposite directions.

The sound engine uses this as a subtle stereo/orientation cue.

Conceptually:

```txt
positive frequency
  slight pan or orientation bias one way

negative frequency
  slight pan or orientation bias the other way
```

This is deliberately subtle.

The sign should color the sound, not split the drawing into gimmicky left/right effects.

---

## Pitch range

Pleasant ambient tones usually need a constrained range.

Too low becomes muddy.

Too high becomes mosquito-like.

A practical range is constrained to avoid mud and harshness. In the current mapping:

```txt
C2 → C7 on larger screens
C2 → C5 on smaller screens
```

with most activity centered well below the harsh top edge.

The app uses a musical scale instead of raw frequency mapping.

The current scale model uses a diatonic solfege-style interval set:

```ts
const SOLFEGE_INTERVALS = [0, 2, 4, 5, 7, 9, 11, 12];
```

A sampled path point becomes a scale step, and that scale step becomes MIDI, then Hz.

This keeps the sound musical even when the drawing is irregular.

On smaller screens, the octave spread is intentionally reduced and tied to shape coverage:

```txt
3 mobile octaves total
coverage > 75% of screen area  → lowest octave emphasis
coverage < 20% of screen area  → highest octave emphasis
```

This keeps mobile output calmer and less jumpy when finger-drawn strokes vary in size.

---

## Envelopes

Envelopes matter as much as pitch.

A raw oscillator turned on instantly clicks or buzzes.

Each sound should have:

```txt
attack
decay
release behavior
```

For pleasant drawing sound:

```txt
attack:
  soft enough to avoid clicks

decay:
  long enough to feel musical

release:
  smooth enough to avoid abrupt cuts
```

For rain-like sounds, envelopes can be shorter.

For glass-like sounds, envelopes can ring longer.

For breeze-like sounds, the envelope can be more airy and sustained.

---

## Smoothing and master gain

The engine uses a master gain node.

Starting sound ramps the gain up smoothly.

Stopping sound ramps the gain down smoothly.

Conceptually:

```txt
start:
  master gain approaches audible level

stop:
  master gain approaches near silence
```

This avoids hard starts and stops.

The engine also uses envelopes per note so individual voices enter and leave smoothly.

---

## Stereo placement

The drawing position controls stereo pan.

A simple mapping is:

```txt
x position on canvas → left/right pan
```

The selected Fourier frequency sign adds a tiny orientation bias.

So the pan is roughly:

```txt
path pan + orientation pan
```

The result is clamped so it does not become too extreme.

The goal is spatial feeling, not hard left/right separation.

---

## View-specific sound

Each visual rotor view has its own sonic identity.

The mapping is:

```txt
Disk view:
  musical cups / glassy tones

Blade view:
  wind chime / rain-drum / airy tones

Companion view:
  paired water / droplet tones
```

This makes the view selector meaningful in two senses:

```txt
visual representation
sonic representation
```

The same Fourier reconstruction can feel different depending on how the bivector / rotor component is being viewed.

---

## Disk sound

Disk view is rotational and smooth.

The desired sound is:

```txt
musical cups
glass bowls
soft bell-like resonance
```

This suggests:

```txt
sine-like oscillators
long gentle decay
soft attack
clean resonance
quiet upper partials
```

Disk view should not sound like a buzz.

It should feel like touching tuned glasses.

In code, Disk view uses the musical cup voice:

```txt
triggerMusicalCup
```

with a small sine cluster and longer resonance.

---

## Blade sound

Blade view emphasizes oriented area.

The desired sound is:

```txt
wind chimes
grass
breeze
airy struck tones
```

The implementation currently uses a soft struck/rain-drum-like voice for Blade mode.

The idea is:

```txt
shorter than Disk
more percussive than Disk
still soft enough to avoid harshness
responsive to curvature
```

Blade mode should feel more textured than Disk mode.

It represents oriented area, so the sound can be more tactile and field-like.

In code, Blade view uses:

```txt
triggerRainDrum
```

with optional small droplet accents for curvature or term-index events.

---

## Companion sound

Companion view emphasizes the vector and its rotated companion.

The desired sound is:

```txt
paired droplets
echoing tones
water-like motion
small ripples
```

This maps naturally to paired notes:

```txt
primary vector
companion vector
```

The companion note can be offset in scale degree and stereo position.

In code, Companion view uses:

```txt
triggerCompanionPair
```

It triggers two related sine clusters:

```txt
first tone:
  primary note

second tone:
  delayed companion note
  opposite-ish pan
  related pitch
```

This makes the companion relationship audible without requiring literal geometric audio.

---

## Shared audio graph

The sound engine builds one shared Web Audio graph.

Conceptually:

```txt
input gain
→ dry gain
→ highpass
→ lowpass
→ compressor
→ master gain
→ destination
```

It also includes a delay return:

```txt
input gain
→ delay
→ feedback
→ delay return
→ filters / compressor / master
```

The delay gives the sound a soft ambient tail.

The filters keep the result from getting muddy or piercing.

The compressor keeps overlapping tones under control.

The master gain handles smooth fade in/out.

---

## Voice generation

Each note event creates a small voice.

The core voice type is a sine cluster:

```txt
one or more sine oscillators
partial gains
stereo panner
voice gain envelope
optional frequency drift
optional start delay
```

The helper is:

```txt
triggerSineCluster
```

It supports:

```txt
frequency
pan
gain
attack
decay
partials
drift
delaySeconds
```

This gives the engine enough flexibility to create:

```txt
glassy cups
soft struck tones
paired droplets
```

without needing samples or external audio files.

---

## Droplet accents

Some high-curvature or periodic events trigger small droplet accents.

These are short sine events through a bandpass filter.

The goal is not to create realistic rain.

The goal is to add:

```txt
small sparkle
motion detail
curvature emphasis
```

Droplets are especially useful when the path turns sharply.

They make corners feel audible.

---

## Note density

The sound engine does not trigger audio every animation frame.

That would be too dense.

Instead, it uses a step interval.

The interval depends on:

```txt
rotor view
curvature
animation mode
```

Sequential mode uses a calmer rate.

Together mode uses a shorter step because it rotates through multiple active strokes, but it still caps voices so the density remains musical.

Conceptually:

```txt
Disk:
  slower, smoother

Blade:
  quicker, more textured

Companion:
  medium, paired

Together:
  denser than Sequential, but capped
```

---

## Sound reset behavior

Several app actions reset sound timing:

```txt
pause animation
enter draw mode
clear canvas
undo
redo
place shape
import image
change animation mode
```

Resetting sound matters because the sound engine has internal timing state:

```txt
startedAtMs
lastTriggerAtMs
noteIndex
activeStrokeId
togetherCursor
lastTogetherLoopElapsed
```

If those values are not reset, the sound can resume from the wrong part of the old animation.

The `resetClock` method clears this timing state.

The `stop` method fades audio down.

Together, they make sound react cleanly to app state changes.

---

## Pause behavior

When animation is paused, sound stops.

This matches the visual behavior.

Pause means:

```txt
the rotor reconstruction frame remains visible
the audio performance stops
the animation clock stops advancing
```

This avoids a confusing state where the image is frozen but the sound continues.

---

## Clear behavior

Clearing the canvas stops sound and resets sound timing.

That is necessary because the old sound data no longer exists.

Clear should mean:

```txt
remove strokes
remove Fourier animation
remove completed traces
stop sound
reset audio clock
```

The app can keep the user's sound preference, but it should not keep sounding after the drawing disappears.

---

## Snapshot behavior

Taking a snapshot captures the current visual state.

If the animation is playing, the app pauses after capture.

Sound should also stop when the animation pauses.

That keeps the snapshot action from feeling like the app keeps performing after the user captured the frame.

---

## Persistence

The app persists the sound preference:

```txt
sound volume value
compatibility soundEnabled flag (derived from volume > 0)
```

This does not mean audio will autoplay on page load.

It means:

```txt
when the user next animates,
and browser rules allow sound,
the app remembers the previous volume/mute intent
```

Browser autoplay restrictions still apply.

---

## Why sound is not persisted as composition

The drawing itself is not persisted, and neither is the sound performance.

The app does not save:

```txt
generated audio
note history
MIDI events
audio graph state
```

The sound is generated live from the current drawing and animation state.

This is intentional.

The sound belongs to the live reconstruction.

---

## Relation to Fourier math

The sound engine depends on Fourier terms, but it is not part of the Fourier math.

The math layer answers:

```txt
what rotating terms reconstruct this path?
```

The sound layer asks:

```txt
how can the current path and terms control a pleasant instrument?
```

That distinction matters.

The sound layer is expressive.

The Fourier layer is reconstructive.

---

## Relation to geometric algebra

The sound engine does not perform geometric algebra operations directly.

It receives already-computed Fourier terms and path data.

However, it responds to geometric-algebra-inspired view modes:

```txt
Disk
Blade
Companion
```

Each view has a different sonic identity.

So the sound layer is not a GA implementation, but it is tied to the app's GA interpretation.

---

## What works well

The current sound system works best with:

```txt
simple freehand strokes
geometric shapes
logos with clean contours
drawings with varied curvature
multi-stroke drawings with moderate stroke count
```

These produce enough variation in:

```txt
position
tangent
curvature
Fourier amplitude
stroke duration
```

to create interesting sound.

---

## What can get messy

The sound can become denser with:

```txt
large image imports
many tiny contours
very complex traced logos
many short strokes in Together mode
```

Together mode caps voices, but very dense input can still feel busy.

This is a normal trade-off. The app is sonifying drawing structure, and complex structure can produce complex sound.

---

## Current final behavior

The current sound system supports:

```txt
path-driven pitch and pan
curvature-driven density and accents
Fourier-amplitude-driven gain
Fourier-sign orientation cues
view-specific timbre
Sequential animation timing
Together animation timing
path-length-based duration
capped simultaneous voices
smooth start/stop
browser-native Web Audio
no external audio assets
```

The key update from the earlier sound implementation is:

```txt
Sound now follows the same timing model as the visual animation.
```

So the current relationship is:

```txt
Sequential visuals:
  length-based, one stroke at a time

Sequential sound:
  length-based, one stroke at a time

Together visuals:
  all strokes start together, each with length-based progress

Together sound:
  multiple active strokes sampled from the same shared loop clock,
  with capped voices to stay musical
```

---

## Final mental model

```txt
The drawing is the score.

The path gives position, direction, and curvature.
The Fourier terms give amplitude and orientation structure.
The animation mode gives the clock.
The rotor view gives the instrument family.

The sound does not play the math literally.
It lets the drawing perform itself musically.
```
