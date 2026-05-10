import type { FourierTerm } from "../math/fourier";
import type { Point } from "../types/geometry";

export type SonicStroke = {
	id: string;
	color: string;
	width: number;
	path: Point[];
	terms: FourierTerm[];
};

const STROKE_DURATION_MS = 6500;
const SOUND_STEP_MS = 260;
const MAX_SOUND_TERMS = 12;

// D major pentatonic: soft, open, hard to make ugly.
// This is intentionally more "musical cups / C418-ish" than "raw spectrum."
const ROOT_MIDI = 50; // D3
const SCALE = [0, 2, 4, 7, 9];
const OCTAVE_COUNT = 4;

const MASTER_GAIN = 0.105;

type WebAudioWindow = Window &
	typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	};

type SampledPathPoint = {
	point: Point;
	previous: Point;
	next: Point;
	normalizedX: number;
	normalizedY: number;
	curvature: number;
};

function midiToHz(midi: number) {
	return 440 * 2 ** ((midi - 69) / 12);
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
	return {
		x: lerp(a.x, b.x, t),
		y: lerp(a.y, b.y, t),
	};
}

function getAudioContextConstructor() {
	return (
		window.AudioContext ??
		(window as WebAudioWindow).webkitAudioContext ??
		null
	);
}

function getPathBounds(path: Point[]) {
	if (path.length === 0) {
		return {
			minX: 0,
			maxX: 1,
			minY: 0,
			maxY: 1,
		};
	}

	const xs = path.map(point => point.x);
	const ys = path.map(point => point.y);

	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);

	return {
		minX,
		maxX: maxX === minX ? minX + 1 : maxX,
		minY,
		maxY: maxY === minY ? minY + 1 : maxY,
	};
}

function getAngleBetween(a: Point, b: Point, c: Point) {
	const ab = {
		x: b.x - a.x,
		y: b.y - a.y,
	};

	const bc = {
		x: c.x - b.x,
		y: c.y - b.y,
	};

	const abLength = Math.hypot(ab.x, ab.y);
	const bcLength = Math.hypot(bc.x, bc.y);

	if (abLength === 0 || bcLength === 0) return 0;

	const dot = ab.x * bc.x + ab.y * bc.y;
	const normalizedDot = clamp(dot / (abLength * bcLength), -1, 1);

	return Math.acos(normalizedDot);
}

function samplePathAtProgress(
	path: Point[],
	progress: number,
): SampledPathPoint {
	if (path.length === 0) {
		const fallback = { x: 0, y: 0 };

		return {
			point: fallback,
			previous: fallback,
			next: fallback,
			normalizedX: 0.5,
			normalizedY: 0.5,
			curvature: 0,
		};
	}

	if (path.length === 1) {
		const point = path[0];

		return {
			point,
			previous: point,
			next: point,
			normalizedX: 0.5,
			normalizedY: 0.5,
			curvature: 0,
		};
	}

	const bounds = getPathBounds(path);
	const clampedProgress = clamp(progress, 0, 0.999999);
	const exactIndex = clampedProgress * (path.length - 1);
	const lowerIndex = Math.floor(exactIndex);
	const upperIndex = Math.min(path.length - 1, lowerIndex + 1);
	const t = exactIndex - lowerIndex;

	const point = lerpPoint(path[lowerIndex], path[upperIndex], t);
	const previous = path[Math.max(0, lowerIndex - 2)];
	const next = path[Math.min(path.length - 1, upperIndex + 2)];

	const normalizedX = clamp(
		(point.x - bounds.minX) / (bounds.maxX - bounds.minX),
		0,
		1,
	);

	const normalizedY = clamp(
		(point.y - bounds.minY) / (bounds.maxY - bounds.minY),
		0,
		1,
	);

	const angle = getAngleBetween(previous, point, next);
	const curvature = clamp(angle / Math.PI, 0, 1);

	return {
		point,
		previous,
		next,
		normalizedX,
		normalizedY,
		curvature,
	};
}

export class DrawingSoundEngine {
	private context: AudioContext | null = null;
	private inputGain: GainNode | null = null;
	private masterGain: GainNode | null = null;

	private startedAtMs: number | null = null;
	private lastTriggerAtMs = 0;
	private noteIndex = 0;
	private activeStrokeId: string | null = null;
	private isRunning = false;

	async enable() {
		const context = this.ensureContext();

		if (context.state === "suspended") {
			await context.resume();
		}
	}

	async start() {
		const context = this.ensureContext();

		if (context.state === "suspended") {
			await context.resume();
		}

		if (this.startedAtMs === null) {
			this.startedAtMs = performance.now();
		}

		this.isRunning = true;

		if (this.masterGain) {
			const now = context.currentTime;

			this.masterGain.gain.cancelScheduledValues(now);
			this.masterGain.gain.setTargetAtTime(MASTER_GAIN, now, 0.16);
		}
	}

	stop() {
		this.isRunning = false;

		if (!this.context || !this.masterGain) return;

		const now = this.context.currentTime;

		this.masterGain.gain.cancelScheduledValues(now);
		this.masterGain.gain.setTargetAtTime(0.0001, now, 0.16);
	}

	resetClock() {
		this.startedAtMs = null;
		this.lastTriggerAtMs = 0;
		this.noteIndex = 0;
		this.activeStrokeId = null;
	}

	tick(strokes: SonicStroke[]) {
		if (!this.isRunning || !this.context || !this.inputGain) return;
		if (strokes.length === 0) return;

		const nowMs = performance.now();

		if (this.startedAtMs === null) {
			this.startedAtMs = nowMs;
		}

		if (nowMs - this.lastTriggerAtMs < SOUND_STEP_MS) return;

		const animationDuration = strokes.length * STROKE_DURATION_MS;
		const elapsed = nowMs - this.startedAtMs;
		const loopElapsed = elapsed % animationDuration;

		const strokeIndex = Math.min(
			strokes.length - 1,
			Math.floor(loopElapsed / STROKE_DURATION_MS),
		);

		const strokeElapsed = loopElapsed - strokeIndex * STROKE_DURATION_MS;
		const progress = strokeElapsed / STROKE_DURATION_MS;
		const stroke = strokes[strokeIndex];

		if (!stroke) return;

		if (stroke.id !== this.activeStrokeId) {
			this.activeStrokeId = stroke.id;
			this.noteIndex = 0;
		}

		const audibleTerms = stroke.terms
			.filter(term => term.frequency !== 0 && term.amplitude > 0)
			.slice(0, MAX_SOUND_TERMS);

		if (audibleTerms.length === 0) return;

		const maxAmplitude = Math.max(
			...audibleTerms.map(term => term.amplitude),
			1,
		);

		const maxFrequency = Math.max(
			...audibleTerms.map(term => Math.abs(term.frequency)),
			1,
		);

		const sampled = samplePathAtProgress(stroke.path, progress);

		const progressOffset = Math.floor(progress * audibleTerms.length);
		const termIndex =
			(progressOffset + this.noteIndex * 3) % audibleTerms.length;

		const term = audibleTerms[termIndex];

		this.triggerGlassNote({
			term,
			termIndex,
			maxAmplitude,
			maxFrequency,
			strokeWidth: stroke.width,
			sampled,
		});

		this.noteIndex += 1;
		this.lastTriggerAtMs = nowMs;
	}

	private ensureContext() {
		if (this.context) return this.context;

		const AudioContextConstructor = getAudioContextConstructor();

		if (!AudioContextConstructor) {
			throw new Error("Web Audio is not supported in this browser.");
		}

		const context = new AudioContextConstructor();

		const inputGain = context.createGain();
		const dryGain = context.createGain();
		const delay = context.createDelay(2);
		const delayFeedback = context.createGain();
		const delayReturn = context.createGain();
		const lowpass = context.createBiquadFilter();
		const highpass = context.createBiquadFilter();
		const compressor = context.createDynamicsCompressor();
		const masterGain = context.createGain();

		inputGain.gain.value = 1;

		dryGain.gain.value = 0.88;

		delay.delayTime.value = 0.56;
		delayFeedback.gain.value = 0.22;
		delayReturn.gain.value = 0.15;

		highpass.type = "highpass";
		highpass.frequency.value = 95;
		highpass.Q.value = 0.5;

		lowpass.type = "lowpass";
		lowpass.frequency.value = 2450;
		lowpass.Q.value = 0.45;

		compressor.threshold.value = -26;
		compressor.knee.value = 26;
		compressor.ratio.value = 3;
		compressor.attack.value = 0.018;
		compressor.release.value = 0.32;

		masterGain.gain.value = 0.0001;

		inputGain.connect(dryGain);
		dryGain.connect(highpass);

		inputGain.connect(delay);
		delay.connect(delayFeedback);
		delayFeedback.connect(delay);
		delay.connect(delayReturn);
		delayReturn.connect(highpass);

		highpass.connect(lowpass);
		lowpass.connect(compressor);
		compressor.connect(masterGain);
		masterGain.connect(context.destination);

		this.context = context;
		this.inputGain = inputGain;
		this.masterGain = masterGain;

		return context;
	}

	private triggerGlassNote({
		term,
		termIndex,
		maxAmplitude,
		maxFrequency,
		strokeWidth,
		sampled,
	}: {
		term: FourierTerm;
		termIndex: number;
		maxAmplitude: number;
		maxFrequency: number;
		strokeWidth: number;
		sampled: SampledPathPoint;
	}) {
		if (!this.context || !this.inputGain) return;

		const context = this.context;
		const now = context.currentTime;

		const normalizedFrequency =
			Math.log2(1 + Math.abs(term.frequency)) /
			Math.log2(1 + maxFrequency);

		const amplitudeRatio = clamp(term.amplitude / maxAmplitude, 0, 1);

		// The drawn waveform/path is now a first-class musical driver:
		// vertical contour chooses the main register,
		// Fourier frequency gently offsets scale position,
		// curvature adds occasional sparkle.
		const contourStep = Math.round(
			(1 - sampled.normalizedY) * (SCALE.length * OCTAVE_COUNT - 1),
		);

		const spectralStep = Math.round(normalizedFrequency * 3);
		const curvatureLift = sampled.curvature > 0.42 ? 1 : 0;

		const totalScaleSteps = SCALE.length * OCTAVE_COUNT;
		const scaleStep = clamp(
			contourStep + spectralStep + curvatureLift,
			0,
			totalScaleSteps - 1,
		);

		const octave = Math.floor(scaleStep / SCALE.length);
		const degree = SCALE[scaleStep % SCALE.length];

		const midi = ROOT_MIDI + octave * 12 + degree;
		const baseFrequency = midiToHz(midi);

		const loudness = 0.007 + 0.034 * amplitudeRatio ** 0.75;
		const attack = 0.045 + Math.min(0.045, strokeWidth * 0.004);
		const decay = 2.35 + amplitudeRatio * 2.65 + sampled.curvature * 0.7;

		const orientationPan = term.frequency < 0 ? -0.08 : 0.08;
		const contourPan = (sampled.normalizedX - 0.5) * 0.34;
		const pan = clamp(contourPan + orientationPan, -0.34, 0.34);

		const panner = context.createStereoPanner();
		const voiceGain = context.createGain();

		panner.pan.setValueAtTime(pan, now);

		voiceGain.gain.setValueAtTime(0.0001, now);
		voiceGain.gain.exponentialRampToValueAtTime(
			Math.max(0.0002, loudness),
			now + attack,
		);
		voiceGain.gain.exponentialRampToValueAtTime(
			0.0001,
			now + attack + decay,
		);

		panner.connect(voiceGain);
		voiceGain.connect(this.inputGain);

		// Mostly pure harmonic partials. No chromatic phase nudging,
		// no hard inharmonic clangs. This is intentionally glassy and soft.
		const partials = [
			{ ratio: 1, gain: 1 },
			{ ratio: 2, gain: 0.22 },
			{ ratio: 4, gain: 0.08 },
		];

		for (const [partialIndex, partial] of partials.entries()) {
			const oscillator = context.createOscillator();
			const partialGain = context.createGain();

			const gentleDrift =
				partialIndex === 0
					? 0
					: Math.sin(termIndex + partialIndex) * 1.4;

			oscillator.type = "sine";
			oscillator.frequency.setValueAtTime(
				baseFrequency * partial.ratio,
				now,
			);
			oscillator.frequency.exponentialRampToValueAtTime(
				baseFrequency * partial.ratio * 0.997,
				now + Math.min(decay, 2.2),
			);
			oscillator.detune.setValueAtTime(gentleDrift, now);

			partialGain.gain.setValueAtTime(partial.gain, now);

			oscillator.connect(partialGain);
			partialGain.connect(panner);

			oscillator.start(now);
			oscillator.stop(now + attack + decay + 0.25);

			oscillator.addEventListener("ended", () => {
				oscillator.disconnect();
				partialGain.disconnect();
			});
		}

		if (sampled.curvature > 0.34 || this.noteIndex % 5 === 0) {
			this.triggerSoftRainPing({
				frequency: baseFrequency * 2,
				pan,
				gain: loudness * 0.32,
				when: now + 0.018,
			});
		}

		window.setTimeout(
			() => {
				panner.disconnect();
				voiceGain.disconnect();
			},
			(attack + decay + 0.4) * 1000,
		);
	}

	private triggerSoftRainPing({
		frequency,
		pan,
		gain,
		when,
	}: {
		frequency: number;
		pan: number;
		gain: number;
		when: number;
	}) {
		if (!this.context || !this.inputGain) return;

		const context = this.context;

		const oscillator = context.createOscillator();
		const filter = context.createBiquadFilter();
		const panner = context.createStereoPanner();
		const pingGain = context.createGain();

		oscillator.type = "sine";
		oscillator.frequency.setValueAtTime(frequency, when);
		oscillator.frequency.exponentialRampToValueAtTime(
			frequency * 0.72,
			when + 0.24,
		);

		filter.type = "bandpass";
		filter.frequency.value = frequency;
		filter.Q.value = 5;

		panner.pan.setValueAtTime(clamp(pan * 1.25, -0.45, 0.45), when);

		pingGain.gain.setValueAtTime(0.0001, when);
		pingGain.gain.exponentialRampToValueAtTime(
			Math.max(0.0002, gain),
			when + 0.012,
		);
		pingGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.42);

		oscillator.connect(filter);
		filter.connect(panner);
		panner.connect(pingGain);
		pingGain.connect(this.inputGain);

		oscillator.start(when);
		oscillator.stop(when + 0.52);

		oscillator.addEventListener("ended", () => {
			oscillator.disconnect();
			filter.disconnect();
			panner.disconnect();
			pingGain.disconnect();
		});
	}
}
