# How I Implemented Fourier Reconstruction in Bifourcation

## Purpose

This document explains how the Fourier series / transform part of Bifourcation was implemented from the first version to the current version.

The goal was to take a drawn or traced path and turn it into a chain of rotating geometric-algebra terms:

```txt
f(t) = Σ cₖRₖ(t)
```

where:

```txt
cₖ      = Fourier coefficient
Rₖ(t)   = rotor in the e₁e₂ plane
t       = animation progress
```

The final implementation keeps the classic discrete Fourier transform behavior, but expresses the phase through geometric algebra rotors.

---

## The first version

The first useful Fourier version followed the standard Fourier drawing pattern:

```txt
path points
→ resampled points
→ DFT coefficients
→ sorted components
→ animated reconstruction
```

A stroke began as raw pointer data:

```ts
type Stroke = {
  color: string;
  width: number;
  points: Point[];
};
```

The points were resampled to an even count so the transform had a clean signal.

The early Fourier signal was basically:

```txt
point n = xₙ + iyₙ
```

but the project did not keep the imaginary-unit interpretation.

Instead, the signal became:

```txt
point n = xₙ + yₙe₁e₂
```

That was done by mapping canvas vectors into the even subalgebra.

---

## Converting points into a signal

The current pipeline is:

```txt
Point[]
→ vector signal
→ even-subalgebra signal
```

A canvas point:

```txt
(x, y)
```

is first represented as:

```txt
x e₁ + y e₂
```

Then it is converted into:

```txt
x + y e₁e₂
```

In code, this is separated into small helpers:

```ts
pointsToVectorSignal(points)
vectorSignalToEvenSignal(vectors)
pointsToEvenSignal(points)
```

This separation was useful because it kept the geometric-algebra conversion visible.

---

## The DFT

The first DFT was a direct implementation, not an FFT.

For each frequency `k`, it accumulated:

```txt
Σ sampleₙ · R(-2πkn/N)
```

where:

```txt
R(θ) = cos θ + e₁e₂ sin θ
```

In code, each contribution is a geometric product:

```ts
const angle = (-2 * Math.PI * k * n) / sampleCount;
const basis = rotor(angle);
const contribution = geometricProduct(samples[n], basis);
```

Then the sum is divided by the sample count:

```ts
coefficient = sum / N
```

The frequency is normalized into positive and negative values:

```ts
frequency = k <= N / 2 ? k : k - N;
```

That means high array indices become negative frequencies, which is important for orientation.

---

## Fourier terms

Each Fourier term stores:

```ts
type FourierTerm = {
  frequency: number;
  coefficient: Multivector;
  amplitude: number;
  phase: number;
};
```

The amplitude is computed from the even multivector coefficient.

The phase is also extracted from the scalar-plus-bivector coefficient.

Terms are sorted by descending amplitude:

```txt
largest broad components first
smaller detail components later
```

This sorting produces the familiar articulated-arm effect:

```txt
large segment
→ smaller segment
→ smaller segment
→ final drawing point
```

The order is not the original frequency order. It is a visual order that makes the reconstruction readable.

---

## Evaluation

The reconstruction evaluates each active term at an animation progress value.

For each term:

```txt
rotating term = coefficient · rotor(2πfrequency·progress)
```

Then each rotating term is added to the running sum.

The important thing is that the visual chain is built during this summation.

For every term, the implementation records:

```ts
type RotorState = {
  center: Multivector;
  tip: Multivector;
  radius: number;
  frequency: number;
  phase: number;
};
```

The center is the current sum before adding the term.

The tip is the current sum after adding the term.

That gives the renderer exactly what it needs:

```txt
draw a segment from center to tip
then draw the next segment from that tip
```

This is why the Fourier series feels like an articulated finger.

---

## The articulated finger model

The current intuition is:

```txt
a Fourier reconstruction is a synchronized articulated arm
```

Each term is one segment in the chain.

The largest segment gets the drawing point into the general region. Smaller segments refine the movement. All of them rotate at fixed frequencies. Nothing chases the curve directly.

The drawing appears because of superposition:

```txt
f(t) = Σ cₖRₖ(t)
```

The “finger” and “wave” interpretations are the same idea:

```txt
articulated finger:
  add rotating segments head-to-tail

wave superposition:
  add oscillating components pointwise
```

The final point is the sum of all active terms at that moment.

---

## Rotor-first interpretation

The first Fourier implementation could have been described as complex-number epicycles. The later implementation was intentionally reframed.

The final language is:

```txt
Fourier terms advanced by rotors in the e₁e₂ plane
```

The phase factor is:

```txt
Rₖ(t) = e^(e₁e₂ · 2πkt)
```

The term is:

```txt
termₖ(t) = cₖRₖ(t)
```

The reconstruction is:

```txt
f(t) = Σ cₖRₖ(t)
```

This kept the Fourier math recognizable while making the geometric interpretation explicit.

---

## Open strokes and the periodic seam

One difficult issue was open strokes.

A standard DFT is periodic. It assumes:

```txt
sample N = sample 0
```

For a closed drawing loop, that is fine.

For a hand-drawn open stroke, it can create endpoint artifacts because the transform implicitly sees:

```txt
last point → first point
```

That caused visible horn-like or zipper-like behavior at the stroke ends.

Several fixes were considered.

---

## Considered fix: redraw the original stroke

The first tempting fix was to let the Fourier animation run, then leave the original stroke behind when the next stroke starts.

That looked clean because the original stroke has no Fourier seam artifact.

But it was conceptually wrong.

The goal was:

```txt
completed stroke remains Fourier-drawn
```

not:

```txt
completed stroke becomes the original input path again
```

So this was rejected.

---

## Considered fix: cache the completed Fourier trace

The next improvement was to cache the exact Fourier trace that had been drawn during animation and use that for completed strokes.

This fixed the issue where completed strokes were swapped back to the original path.

But it did not solve the endpoint artifact itself. It only preserved whatever had already been drawn.

This was still useful, but it was not a complete fix for open-stroke seam behavior.

---

## Considered fix: mirror open strokes

Another option was to build the Fourier signal as:

```txt
forward stroke
then backward stroke
```

This makes the signal periodic without a jump.

It removes the endpoint seam, but it changes the character of the reconstruction. The stroke begins to feel like it is being traced by a forward/backward construction instead of the original rotor-chain behavior.

That was rejected because it made the animation feel like a lie.

---

## Considered fix: hidden smooth closure

Another option was:

```txt
visible stroke
+ invisible smooth return curve
```

The DFT would see a smooth closed loop, while the renderer would display only the visible interval.

This is mathematically reasonable, but in practice it also changed the behavior too much. The hidden return curve influences the coefficients, so the visible trace no longer felt like the same Fourier reconstruction of the drawn stroke.

This was rejected for the same reason: the result did not feel honest to the original app.

---

## Considered fix: detrend the open stroke

Another option was to split the stroke into:

```txt
straight start→end trend
+ Fourier residual
```

The DFT would reconstruct only the residual, then the trend would be added back.

This treats start and end as separate, which is conceptually attractive.

But it made the animation look too much like the original stroke was being directly redrawn. It reduced the rotor-chain feel.

That was rejected because it changed the visual language too much.

---

## Considered fix: cosine series

A cosine-series / DCT-style open-interval basis was also considered.

This is the mathematically cleanest way to say:

```txt
start is start
end is end
no periodic seam
```

Each cosine harmonic can be represented as a pair of counter-rotating rotors.

But visually, it produced a smoother, less wave-like reconstruction. It no longer looked like the same rotor-chain Fourier behavior.

This was rejected because Bifourcation is not only trying to approximate an open curve. It is trying to show a rotor-driven Fourier chain.

---

## Final open-stroke decision

The final compromise keeps the original periodic DFT and rotor reconstruction.

The app simply avoids evaluating the final artificial seam.

The DFT samples are:

```txt
sample 0
sample 1
...
sample N - 1
```

A periodic DFT also implies:

```txt
sample N = sample 0
```

For visible stroke animation, the app treats the display interval as:

```txt
0 → (N - 1) / N
```

instead of:

```txt
0 → 1
```

So the visible animation goes:

```txt
first sample → last sample
```

not:

```txt
first sample → last sample → first sample
```

This does not mathematically remove all endpoint ringing. It does prevent the renderer/evaluator from intentionally entering the artificial return-to-start seam.

This is the least invasive decision because it preserves:

```txt
the original DFT
the rotor-chain behavior
the wave-like trace
the existing visual language
```

while avoiding the most obvious seam display.

---

## Final Fourier decisions

The final Fourier implementation keeps these decisions:

```txt
Use a direct DFT, not FFT.
Use geometric-algebra rotors for phase.
Use even-subalgebra coefficients.
Sort terms by amplitude for visual clarity.
Evaluate each term into a rotor state with center and tip.
Preserve the rotor-chain / articulated-finger behavior.
Treat the visible stroke interval as open by avoiding the final period seam.
```

The final implementation is not trying to be the mathematically purest open-curve approximation. It is trying to preserve the identity of the app:

```txt
a rotor-driven Fourier drawing system
```

The trade-off is accepted:

```txt
periodic Fourier reconstruction may still have some endpoint behavior
but the app does not display the artificial final return segment
```

That is the final product.
