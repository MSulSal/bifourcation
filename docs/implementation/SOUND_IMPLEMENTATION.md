# How I Implemented Sound in Bifourcation

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
delays / feedback if needed
```

The audio engine is kept separate from the visual renderer.

The renderer draws frames.

The sound engine receives enough state to update sound.

---

## User gesture and autoplay

Browsers restrict autoplay.

That means sound cannot always start until the user performs an interaction.

The app therefore treats sound as an explicit user-controlled feature.

The sound preference can be saved locally, but actual audio start may still require a gesture.

The final behavior is:

```txt
speaker button toggles sound preference
animation starts sound only if sound is enabled
pause stops or quiets sound
clear resets sound
```

This keeps the app aligned with browser rules.

---

## Sound state

The sound system needs to know:

```txt
is sound enabled?
is animation active?
is animation playing?
which stroke is active?
what is the current progress?
which visual view is active?
```

Sound should not play while drawing normally.

It should play while the animated reconstruction is happening.

That makes the sound feel like it belongs to the Fourier / rotor performance.

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
stroke speed / progress
Fourier amplitude
Fourier orientation
active view
```

The sound model became:

```txt
path position → pitch / stereo position
path tangent → melodic motion
path curvature → sparkle / density
Fourier amplitude → loudness / intensity
frequency sign → stereo or phase character
view mode → instrument family
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
→ smoothed into gain
```

The drawing controls the sound, but the sound engine keeps it inside a pleasant palette.

---

## View-specific sound

A later idea was that each visual view should have its own sonic identity.

The final intended mapping is:

```txt
Disk view:
  musical cups / glassy tones

Blade view:
  wind chime / grass / breeze tones

Companion view:
  water / rain / soft droplets
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
light FM or detune
long gentle decay
high but not piercing partials
soft attack
clean resonance
```

The sound should feel circular, glassy, and balanced.

Disk view should not sound like a buzz.

It should feel like touching tuned glasses.

---

## Blade sound

Blade view emphasizes oriented area.

The desired sound is:

```txt
wind chimes
grass
breeze
airy tones
```

This suggests:

```txt
soft noise layer
filtered air movement
occasional bell partials
gentle stereo motion
subtle shimmer
```

The blade sound should be less wet than rain and less glassy than disk mode.

It should feel like moving through an oriented field.

---

## Companion sound

Companion view emphasizes the vector and its rotated companion.

The desired sound is:

```txt
water
rain
soft droplets
small ripples
```

This suggests:

```txt
short droplet envelopes
filtered noise bursts
soft plucks
randomized but drawing-controlled density
gentle delay
```

Companion mode can be more granular than disk or blade mode.

The companion vector idea maps well to paired or echoing droplets.

---

## The frequency mapping problem

One of the hardest sound questions was:

```txt
How should visual Fourier frequency become audible frequency?
```

A direct mapping is usually bad.

Visual frequencies are relative to animation progress. Audio frequencies are measured in cycles per second.

A better approach is to map drawing features to a musical pitch range.

For example:

```txt
normalized y position
→ scale degree
path tangent
→ pitch bend / motion
dominant Fourier frequency
→ octave or harmonic color
curvature
→ ornament density
```

This keeps the sound pleasant while still connected to the drawing.

---

## Pitch range

Pleasant ambient tones usually need a constrained range.

Too low becomes muddy.

Too high becomes mosquito-like.

A practical range is something like:

```txt
roughly 180 Hz to 1200 Hz
```

with most activity lower than the harsh upper range.

High partials can exist, but they should be filtered and quiet.

The app should avoid continuously holding piercing tones.

---

## Envelopes

Envelopes matter as much as pitch.

A raw oscillator turned on instantly clicks or buzzes.

Each sound should have:

```txt
attack
decay
sustain or release
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

For breeze-like sounds, the envelope can be more continuous and filtered.

---

## Smoothing

Drawing data can jump from frame to frame.

Audio should not jump with it.

Important values should be smoothed:

```txt
gain
pitch
filter cutoff
pan
density
```

Without smoothing, the sound becomes jittery.

Smoothing makes the sound feel organic.

---

## Stereo placement

The drawing position can control stereo pan.

A simple mapping is:

```txt
x position on canvas → left/right pan
```

This makes the sound spatially follow the drawing.

It should be subtle. Extreme panning can become distracting.

Orientation or frequency sign can also influence stereo character:

```txt
positive frequency → slight right tendency
negative frequency → slight left tendency
```

That should remain subtle because stroke position is more important.

---

## Curvature and sparkle

Curvature is useful because it tells where the path turns.

Sharp turns can create:

```txt
sparkle
droplet
chime strike
density increase
```

Straight sections can be calmer.

This makes the sound respond to the drawing’s shape, not just time.

---

## Sound and rotor terms

The Fourier terms still matter.

Useful term-derived controls include:

```txt
largest active amplitude
term density
positive vs negative frequency balance
current rotor view
active stroke energy
```

But the sound should not play every term literally.

The final decision is:

```txt
Fourier terms shape the instrument behavior.
They do not become a wall of raw oscillators.
```

---

## Persistence

The sound on/off preference is saved locally.

This was added because sound is a personal preference.

The app remembers:

```txt
sound enabled or disabled
```

But actual playback still depends on browser autoplay rules.

So the user may need to interact before sound can start.

---

## Failures and revisions

Several sound directions were rejected.

### Pure oscillator mapping

Rejected because it sounded too harsh.

### Quieting the harsh sound

Rejected because it made the same bad sound quieter instead of better.

### Static ambient loop

Rejected because it did not feel made by the drawing.

### Same instrument for every view

Rejected because visual views have different meanings.

The final direction is:

```txt
drawing-shaped ambient instrument
with view-specific timbre
```

---

## Final sound decision

The final sound implementation is intentionally lightweight.

It uses Web Audio and drawing/Fourier state as live control data.

The guiding rules are:

```txt
sound only during animation
sound follows the drawing
sound is constrained to pleasant ranges
each view has a distinct sonic character
raw Fourier data informs sound but does not dominate it
```

The final mental model is:

```txt
the drawing plays itself
but through a musical instrument
not through a raw oscilloscope
```

---

## Current limitations

The current sound system is still a live browser synthesis layer.

It does not export audio with snapshots.

It does not use sampled instruments.

It does not yet expose detailed user controls for:

```txt
volume
density
scale
instrument brightness
reverb / delay amount
```

Those could become future improvements.

---

## Possible next steps

Useful next improvements would be:

```txt
volume slider
sound intensity slider
separate instrument controls per view
better droplet model for companion view
more glass resonance for disk view
more airy filtered noise for blade view
optional musical scale selection
audio export for video/GIF output
```

The most important principle should remain:

```txt
the sound should feel generated by the drawing
and should stay pleasant for long sessions
```
