# Export Implementation

## Purpose

This document explains how MP4 export is implemented in Bifourcation.

The goal was:

```txt
export what the user actually sees
avoid blocking the app with full-screen modal UI
support cancel and progress
support optional captured audio
stay browser-native
```

---

## Entry point and panel model

Export is launched from the snapshot menu in `App.tsx`.

The trigger dispatches:

```txt
bifourcation:open-video-export
```

`VideoExportOverlay` listens for this event and opens a floating panel.

Important UI choice:

```txt
panel is fixed and bounded
no full-viewport dark backdrop
```

This prevents accidental "blank screen" behavior on small devices.

---

## Animation control contract

Export drives animation through explicit events:

```txt
bifourcation:export-animation-control
  action: reset | play | pause
```

Flow:

```txt
reset to start
play
capture frames on schedule
pause when finished or canceled
```

This keeps export timing deterministic without coupling the overlay to app internals.

---

## Rendering pipeline

The export code:

```txt
find visible canvas elements
compute effective opacity and stacking score
sort by stack order
composite into an offscreen export canvas
feed frames to MP4 encoder
```

A union rectangle is used so source canvases are fit into the selected export aspect ratio while preserving content.

---

## Dynamic encoder loading

Mediabunny is loaded lazily inside export code:

```ts
type MediabunnyModule = typeof import("mediabunny");
async function loadMediabunny(): Promise<MediabunnyModule> {
	return await import("mediabunny");
}
```

This prevents encoder import failures from breaking initial app render.

---

## Audio export integration

Export requests an audio track with:

```txt
bifourcation:export-request-audio-track
```

`App.tsx` responds with a capture track from `DrawingSoundEngine` when volume is audible.

If no track is available, video export still continues without audio.

---

## Cancellation

Export uses `AbortController`.

Cancellation points:

```txt
user presses Cancel export
panel closes while exporting
component unmounts
```

Abort is checked throughout the frame loop and mapped to a dedicated `ExportCanceledError` path.

---

## Storage estimates and user feedback

Before export, the overlay estimates output size from:

```txt
duration
video bitrate
audio bitrate
overhead factor
```

It then checks `navigator.storage.estimate()` when available.

Outcomes:

```txt
hard stop if estimate exceeds available space
warning notice when estimate is close to available space
```

This does not guarantee success, but it catches obvious low-space failures early.

---

## Progress and sharing

The panel shows frame progress as percentage.

After successful export:

```txt
auto-download MP4
store last blob in memory
allow Share last export action
```

Share uses browser-native file sharing when supported, and download fallback otherwise.

---

## Persisted export settings

The overlay persists:

```txt
bifourcation.export.aspect
bifourcation.export.quality
bifourcation.export.duration
```

This keeps repeated exports fast without persisting temporary runtime state.

---

## Final mental model

```txt
Export is a bounded floating workflow.
It orchestrates app animation through events.
It composites visible canvas layers in order.
It can capture audio when available.
It supports cancel, progress, and storage-aware feedback.
```

