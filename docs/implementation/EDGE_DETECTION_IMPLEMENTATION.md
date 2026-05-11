# How I Implemented Image Edge Detection in Bifourcation

## Purpose

This document explains how image tracing was implemented in Bifourcation from the first simple version to the current approach.

The goal was not to build a full image-recognition system.

The goal was:

```txt
take an imported image
find visible edges or boundaries
turn those edges into ordered strokes
feed those strokes into the same Fourier / rotor animation pipeline
```

The imported image should behave like a drawing.

That means the final result should become:

```txt
Stroke[]
```

not a special image object.

Once the image becomes strokes, the rest of the app should not care whether those strokes came from a hand, a logo, a sketch, or a traced image.

---

## The first idea

The first idea was simple classic edge detection.

The app could import an image into a hidden canvas, read its pixels, and run a Sobel filter.

The basic Sobel pipeline is:

```txt
image
→ grayscale
→ Sobel x gradient
→ Sobel y gradient
→ gradient magnitude
→ threshold
→ edge pixels
```

Sobel was attractive because it is:

```txt
simple
cheap
browser-native
dependency-free
easy to explain
good enough for many high-contrast images
```

This matched the project philosophy.

Bifourcation should not need a server, an AI model, or a heavy computer-vision dependency just to trace a logo.

---

## Why Sobel alone was not enough

Sobel works by detecting local intensity changes.

That means it finds places where the image changes sharply:

```txt
dark → light
light → dark
color → color
```

For sketches and line art, this can work well.

But for logos, icons, and high-contrast graphics, Sobel can produce noisy or fragmented results.

A thick black shape on a white background may produce two edge contours:

```txt
outer edge
inner edge
```

That can be useful, but it can also make the traced result cluttered.

Sobel also does not understand that a black shape is a foreground object. It just sees brightness changes.

So the first Sobel-only approach was useful, but it did not always give the cleanest paths for the kinds of images I wanted users to import.

---

## The high-contrast logo problem

The problem became obvious with high-contrast logos.

A clean black logo on a white background looks like it should be easy to trace.

But edge detection still has to answer several questions:

```txt
What is foreground?
What is background?
Which edge pixels belong together?
Which tiny details should be ignored?
Should filled shapes become outlines?
Should text become contours?
Should holes inside letters be traced?
```

A human can instantly see the logo.

A simple edge detector just sees pixels.

The app needed something better than raw Sobel for high-contrast images, but still simple enough to run locally in the browser.

---

## The improved approach

The image tracing pipeline became more like this:

```txt
uploaded image
→ hidden canvas
→ grayscale pixels
→ light blur
→ threshold / foreground mask
→ boundary extraction
→ contour tracing
→ path simplification
→ Stroke[]
```

Sobel-style edge detection remained useful as a fallback or supporting idea, but the main high-contrast path became threshold-based boundary extraction.

The key shift was:

```txt
do not only look for gradients
also identify foreground regions
```

For black-and-white or high-contrast logos, this usually gives cleaner results.

---

## Hidden canvas import

The image is first loaded into an offscreen or hidden canvas.

That gives direct access to pixel data:

```ts
const imageData = ctx.getImageData(0, 0, width, height);
```

From there, each pixel can be read as:

```txt
red
green
blue
alpha
```

The image is converted into grayscale with a standard weighted formula or an approximate average.

Conceptually:

```txt
gray = weighted average of red, green, blue
```

Transparency also matters.

If the image has transparent regions, alpha can be used to help decide background vs foreground.

---

## Grayscale conversion

Grayscale conversion reduces the problem to one channel.

Instead of comparing full RGB colors, the algorithm works with brightness:

```txt
0   = black
255 = white
```

That makes thresholding easier.

For a high-contrast logo, the foreground is usually close to one end of the brightness range and the background is close to the other.

---

## Light blur

A small blur is useful before thresholding.

The blur smooths out:

```txt
compression artifacts
anti-aliased edges
tiny speckles
single-pixel noise
```

The blur should be light. Too much blur destroys small logo features.

The goal is not to make the image soft. The goal is to make the foreground/background decision more stable.

---

## Thresholding

Thresholding converts grayscale pixels into a binary mask:

```txt
foreground
background
```

For a black logo on a white background:

```txt
dark pixels → foreground
light pixels → background
```

For some images, the foreground might be light on dark, so the implementation may need to infer whether dark or light pixels dominate the object.

The simplest version assumes dark foreground on light background.

That works best when the user imports trace-friendly images.

This is why a black-and-white, high-contrast logo is much easier to trace than a shaded or transparent graphic.

---

## Boundary extraction

Once there is a foreground mask, the app can find boundary pixels.

A foreground pixel is a boundary if at least one neighboring pixel is background.

Conceptually:

```txt
if pixel is foreground
and any neighbor is background
then pixel is boundary
```

This produces the outline of the foreground shapes.

Boundary extraction is often cleaner than Sobel for logos because it follows the actual foreground silhouette.

---

## Contour tracing

Boundary pixels alone are unordered.

Fourier reconstruction needs ordered paths.

So the next step is contour tracing:

```txt
boundary pixel cloud
→ ordered contour paths
```

The tracer walks from boundary pixel to neighboring boundary pixel, collecting points in sequence.

This matters because Fourier reconstruction is order-sensitive.

If the path order is wrong, the animation can jump, skip, or trace sections in the wrong sequence.

The app therefore needs to produce a list of ordered contours:

```ts
Point[][]
```

Each contour can then become a stroke.

---

## Path simplification

Raw contours can contain too many points.

A boundary may include hundreds or thousands of adjacent pixels. Feeding every pixel into the Fourier system is expensive and often visually noisy.

The path is simplified before becoming a stroke.

The simplification should preserve the overall shape while removing redundant points.

The trade-off is:

```txt
too little simplification:
  noisy paths
  expensive DFT
  jittery animation

too much simplification:
  lost details
  angular shapes
  less faithful tracing
```

The final approach keeps simplification conservative.

The traced image should still look like the source, but it should not overload the Fourier transform.

---

## Converting contours to strokes

After contours are traced and simplified, each contour is converted into a normal app stroke:

```ts
type Stroke = {
  color: string;
  width: number;
  points: Point[];
};
```

The image tracing code does not create a separate image object.

That was an important design decision.

The rest of the app already knows how to handle strokes:

```txt
resample stroke
compute Fourier terms
animate rotor chain
draw trace
```

So image tracing ends where the normal drawing pipeline begins.

---

## Why this stayed dependency-free

A third-party image tracing library could have been used.

That might have improved tracing quality, especially for complex logos or photos.

But it would also add trade-offs:

```txt
larger dependency surface
more configuration
less educational transparency
harder to explain in the from-scratch build
less control over the path format
```

The final project favors a simple local implementation.

The tracing is not perfect, but it is understandable.

That matters because Bifourcation is also a teaching project.

---

## What works best

The current image tracing approach works best with:

```txt
black-and-white logos
icons
simple sketches
clear line art
silhouettes
high-contrast shapes
images without heavy texture
```

These images have clear foreground/background separation.

The app can turn them into clean contours without needing semantic understanding.

---

## What works poorly

The approach works less well with:

```txt
low-contrast photos
busy backgrounds
soft shadows
gradients
textures
transparent checkerboard previews
tiny text
thin decorative details
overlapping shapes with similar brightness
```

The app is not trying to understand the image.

It is only tracing pixels.

If the pixels do not separate cleanly, the result will not either.

---

## Logo preparation

For the best tracing results, a logo should be prepared as:

```txt
pure black artwork
pure white background
no gradients
no glow
no shadows
no transparency checkerboard
bold strokes
clear separated shapes
simple curves
high resolution
```

This kind of image gives the edge detector strong boundaries.

A trace-friendly README snapshot source should therefore be flatter and harsher than a polished app icon.

The app icon can have color, glow, and depth.

The trace source should be more mechanical:

```txt
black and white
hard edges
clear contours
```

---

## Why color was not preserved during tracing

The tracing system is primarily geometric.

Its job is to recover paths.

The current pen color and width can be applied to imported strokes after tracing.

That means the imported image does not need to preserve original image colors.

This was a useful simplification because Fourier reconstruction works on geometry, not image color.

The final path can still inherit an app color:

```txt
current pen color
or selected trace color
```

---

## Trade-offs considered

Several options were considered.

### Full image recognition

This was rejected.

The app does not need to know what the image is. It only needs paths.

```txt
recognition:
  too heavy
  unnecessary
  not aligned with the project
```

### Third-party vectorization

This was possible, but rejected for the current version.

```txt
pros:
  better tracing
  more mature algorithms

cons:
  extra dependency
  less transparent
  harder to teach from scratch
```

### Sobel only

This was simple, but not always clean enough.

```txt
pros:
  very easy
  classic edge detection
  good for line drawings

cons:
  noisy on filled shapes
  can produce fragmented edges
  not always ideal for logos
```

### Threshold boundary extraction

This became the preferred method for high-contrast images.

```txt
pros:
  clean for logos
  simple
  dependency-free
  easy to explain

cons:
  depends on good contrast
  can struggle with photos
  does not understand objects semantically
```

---

## Final image-tracing decision

The final implementation uses classic local image processing:

```txt
grayscale
light blur
threshold / foreground mask
boundary extraction
contour tracing
simplification
Stroke[]
```

The key decision is:

```txt
image tracing produces strokes, not images
```

Once the image becomes strokes, it enters the same pipeline as everything else.

That keeps the app coherent:

```txt
drawn stroke
traced image contour
same Fourier transform
same rotor animation
same visual modes
```

---

## Final mental model

The image tracing feature is not AI.

It is not recognition.

It is a mechanical bridge:

```txt
pixels → contours → strokes → Fourier rotors
```

A good source image gives the algorithm clean boundaries.

A bad source image gives it confusion.

The most trace-friendly image is not necessarily the prettiest image. It is the image with the clearest edges.
