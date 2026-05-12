import type { FourierTerm } from "../math/fourier";
import type { Point } from "../types/geometry";

export type BivectorSoundView = "blade" | "disk" | "companion";
export type SoundTraceMode = "sequential" | "simultaneous";

export type SonicStroke = {
	id: string;
	color: string;
	width: number;
	path: Point[];
	terms: FourierTerm[];
};

const DRAW_SPEED_PX_PER_MS = 0.16;
const MIN_STROKE_DURATION_MS = 900;
const MAX_STROKE_DURATION_MS = 28000;

const MAX_SOUND_TERMS = 14;
const MAX_SIMULTANEOUS_SOUND_STROKES = 3;

const ROOT_MIDI = 50; // D3
const SCALE = [0, 2, 4, 7, 9]; // D major pentatonic
const OCTAVE_COUNT = 4;

const MASTER_GAIN = 0.11;

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
	tangentAngle: number;
};

type SinePartial = {
	ratio: number;
	gain: number;
	detune?: number;
};

type StrokeTimelineEntry = {
	stroke: SonicStroke;
	startMs: number;
	endMs: number;
	durationMs: number;
};

type ActiveSoundStroke = {
	stroke: SonicStroke;
	progress: number;
	durationMs: number;
	sampled: SampledPathPoint;
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

function getPathLength(points: Point[]) {
	let total = 0;

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];

		total += Math.hypot(current.x - previous.x, current.y - previous.y);
	}

	return total;
}

function getStrokeDurationMs(stroke: SonicStroke) {
	const length = getPathLength(stroke.path);

	if (length === 0) return MIN_STROKE_DURATION_MS;

	return Math.min(
		MAX_STROKE_DURATION_MS,
		Math.max(MIN_STROKE_DURATION_MS, length / DRAW_SPEED_PX_PER_MS),
	);
}

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

function getSequentialSoundFrame(strokes: SonicStroke[], loopElapsed: number) {
	const { timeline } = getSequentialTimeline(strokes);

	if (timeline.length === 0) {
		return null;
	}

	const timelineIndex = timeline.findIndex(
		entry => loopElapsed >= entry.startMs && loopElapsed < entry.endMs,
	);

	const strokeIndex =
		timelineIndex === -1 ? timeline.length - 1 : timelineIndex;
	const entry = timeline[strokeIndex];
	const strokeElapsed = loopElapsed - entry.startMs;

	return {
		stroke: entry.stroke,
		strokeIndex,
		progress: clamp(strokeElapsed / entry.durationMs, 0, 1),
		durationMs: entry.durationMs,
	};
}

function getSimultaneousCycleDuration(strokes: SonicStroke[]) {
	if (strokes.length === 0) return MIN_STROKE_DURATION_MS;

	return Math.max(...strokes.map(getStrokeDurationMs));
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
			tangentAngle: 0,
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
			tangentAngle: 0,
		};
	}

	const bounds = getPathBounds(path);
	const clampedProgress = clamp(progress, 0, 0.999999);
	const exactIndex = clampedProgress * (path.length - 1);
	const lowerIndex = Math.floor(exactIndex);
	const upperIndex = Math.min(path.length - 1, lowerIndex + 1);
	const t = exactIndex - lowerIndex;

	const point = lerpPoint(path[lowerIndex], path[upperIndex], t);
	const previous = path[Math.max(0, lowerIndex - 3)];
	const next = path[Math.min(path.length - 1, upperIndex + 3)];

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

	const tangentAngle = Math.atan2(next.y - previous.y, next.x - previous.x);

	return {
		point,
		previous,
		next,
		normalizedX,
		normalizedY,
		curvature,
		tangentAngle,
	};
}

function getSoundStepMs(view: BivectorSoundView, curvature: number) {
	if (view === "disk") return 330 - curvature * 40;
	if (view === "companion") return 290 - curvature * 35;

	return 210 - curvature * 45;
}

function getTogetherSoundStepMs(view: BivectorSoundView, curvature: number) {
	return Math.max(95, getSoundStepMs(view, curvature) * 0.62);
}

export class DrawingSoundEngine {
	private context: AudioContext | null = null;
	private inputGain: GainNode | null = null;
	private masterGain: GainNode | null = null;

	private startedAtMs: number | null = null;
	private lastTriggerAtMs = 0;
	private noteIndex = 0;
	private activeStrokeId: string | null = null;
	private togetherCursor = 0;
	private lastTogetherLoopElapsed = 0;
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
			this.masterGain.gain.setTargetAtTime(MASTER_GAIN, now, 0.18);
		}
	}

	stop() {
		this.isRunning = false;

		if (!this.context || !this.masterGain) return;

		const now = this.context.currentTime;

		this.masterGain.gain.cancelScheduledValues(now);
		this.masterGain.gain.setTargetAtTime(0.0001, now, 0.18);
	}

	resetClock() {
		this.startedAtMs = null;
		this.lastTriggerAtMs = 0;
		this.noteIndex = 0;
		this.activeStrokeId = null;
		this.togetherCursor = 0;
		this.lastTogetherLoopElapsed = 0;
	}

	tick(
		strokes: SonicStroke[],
		view: BivectorSoundView,
		traceMode: SoundTraceMode = "sequential",
	) {
		if (!this.isRunning || !this.context || !this.inputGain) return;
		if (strokes.length === 0) return;

		if (traceMode === "simultaneous") {
			this.tickTogether(strokes, view);
			return;
		}

		this.tickSequential(strokes, view);
	}

	private tickSequential(strokes: SonicStroke[], view: BivectorSoundView) {
		const nowMs = performance.now();

		if (this.startedAtMs === null) {
			this.startedAtMs = nowMs;
		}

		const { totalDurationMs } = getSequentialTimeline(strokes);
		const elapsed = nowMs - this.startedAtMs;
		const loopElapsed = elapsed % totalDurationMs;
		const frame = getSequentialSoundFrame(strokes, loopElapsed);

		if (!frame) return;

		const sampled = samplePathAtProgress(frame.stroke.path, frame.progress);
		const stepMs = getSoundStepMs(view, sampled.curvature);

		if (nowMs - this.lastTriggerAtMs < stepMs) return;

		if (frame.stroke.id !== this.activeStrokeId) {
			this.activeStrokeId = frame.stroke.id;
			this.noteIndex = 0;
		}

		const didTrigger = this.triggerStrokeSound({
			stroke: frame.stroke,
			progress: frame.progress,
			sampled,
			view,
			noteOffset: 0,
		});

		if (!didTrigger) return;

		this.noteIndex += 1;
		this.lastTriggerAtMs = nowMs;
	}

	private tickTogether(strokes: SonicStroke[], view: BivectorSoundView) {
		const nowMs = performance.now();

		if (this.startedAtMs === null) {
			this.startedAtMs = nowMs;
		}

		const cycleDurationMs = getSimultaneousCycleDuration(strokes);
		const elapsed = nowMs - this.startedAtMs;
		const loopElapsed = elapsed % cycleDurationMs;

		if (loopElapsed < this.lastTogetherLoopElapsed) {
			this.noteIndex = 0;
			this.togetherCursor = 0;
			this.activeStrokeId = null;
		}

		this.lastTogetherLoopElapsed = loopElapsed;

		const activeStrokes: ActiveSoundStroke[] = strokes
			.map(stroke => {
				const durationMs = getStrokeDurationMs(stroke);
				const progress = clamp(loopElapsed / durationMs, 0, 1);
				const sampled = samplePathAtProgress(stroke.path, progress);

				return {
					stroke,
					progress,
					durationMs,
					sampled,
				};
			})
			.filter(({ stroke, durationMs }) => {
				if (loopElapsed > durationMs) return false;

				return stroke.terms.some(
					term => term.frequency !== 0 && term.amplitude > 0,
				);
			});

		if (activeStrokes.length === 0) return;

		const cursor = this.togetherCursor % activeStrokes.length;
		const representative = activeStrokes[cursor];
		const stepMs = getTogetherSoundStepMs(
			view,
			representative.sampled.curvature,
		);

		if (nowMs - this.lastTriggerAtMs < stepMs) return;

		const voices = Math.min(
			MAX_SIMULTANEOUS_SOUND_STROKES,
			activeStrokes.length,
		);
		let triggeredCount = 0;

		for (let voiceIndex = 0; voiceIndex < voices; voiceIndex += 1) {
			const activeStroke =
				activeStrokes[(cursor + voiceIndex) % activeStrokes.length];

			const didTrigger = this.triggerStrokeSound({
				stroke: activeStroke.stroke,
				progress: activeStroke.progress,
				sampled: activeStroke.sampled,
				view,
				noteOffset: voiceIndex,
			});

			if (didTrigger) {
				triggeredCount += 1;
			}
		}

		if (triggeredCount === 0) return;

		this.activeStrokeId = "together";
		this.noteIndex += 1;
		this.togetherCursor = (cursor + 1) % activeStrokes.length;
		this.lastTriggerAtMs = nowMs;
	}

	private triggerStrokeSound({
		stroke,
		progress,
		sampled,
		view,
		noteOffset,
	}: {
		stroke: SonicStroke;
		progress: number;
		sampled: SampledPathPoint;
		view: BivectorSoundView;
		noteOffset: number;
	}) {
		const audibleTerms = stroke.terms
			.filter(term => term.frequency !== 0 && term.amplitude > 0)
			.slice(0, MAX_SOUND_TERMS);

		if (audibleTerms.length === 0) return false;

		const maxAmplitude = Math.max(
			...audibleTerms.map(term => term.amplitude),
			1,
		);

		const maxFrequency = Math.max(
			...audibleTerms.map(term => Math.abs(term.frequency)),
			1,
		);

		const tangentOffset = Math.round(
			((sampled.tangentAngle + Math.PI) / (Math.PI * 2)) *
				audibleTerms.length,
		);

		const pathOffset = Math.floor(progress * audibleTerms.length);

		const termIndex =
			(pathOffset + tangentOffset + (this.noteIndex + noteOffset) * 2) %
			audibleTerms.length;

		const term = audibleTerms[termIndex];

		this.triggerPathNote({
			view,
			term,
			termIndex,
			maxAmplitude,
			maxFrequency,
			strokeWidth: stroke.width,
			sampled,
		});

		return true;
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
		const highpass = context.createBiquadFilter();
		const lowpass = context.createBiquadFilter();
		const compressor = context.createDynamicsCompressor();
		const masterGain = context.createGain();

		inputGain.gain.value = 1;
		dryGain.gain.value = 0.88;

		delay.delayTime.value = 0.58;
		delayFeedback.gain.value = 0.2;
		delayReturn.gain.value = 0.14;

		highpass.type = "highpass";
		highpass.frequency.value = 90;
		highpass.Q.value = 0.5;

		lowpass.type = "lowpass";
		lowpass.frequency.value = 2600;
		lowpass.Q.value = 0.42;

		compressor.threshold.value = -28;
		compressor.knee.value = 26;
		compressor.ratio.value = 2.8;
		compressor.attack.value = 0.018;
		compressor.release.value = 0.36;

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

	private getScaleStep({
		sampled,
		term,
		maxFrequency,
		view,
	}: {
		sampled: SampledPathPoint;
		term: FourierTerm;
		maxFrequency: number;
		view: BivectorSoundView;
	}) {
		const totalScaleSteps = SCALE.length * OCTAVE_COUNT;

		const normalizedFrequency =
			Math.log2(1 + Math.abs(term.frequency)) /
			Math.log2(1 + maxFrequency);

		const verticalContour = Math.round(
			(1 - sampled.normalizedY) * (totalScaleSteps - 1),
		);

		const tangentLift = Math.round(Math.sin(sampled.tangentAngle) * 1.5);
		const spectralLift = Math.round(normalizedFrequency * 2);
		const curvatureLift = sampled.curvature > 0.46 ? 1 : 0;

		const viewOffset = view === "disk" ? 2 : view === "companion" ? -1 : 0;

		return clamp(
			verticalContour +
				tangentLift +
				spectralLift +
				curvatureLift +
				viewOffset,
			0,
			totalScaleSteps - 1,
		);
	}

	private getMidiFromScaleStep(scaleStep: number) {
		const octave = Math.floor(scaleStep / SCALE.length);
		const degree = SCALE[scaleStep % SCALE.length];

		return ROOT_MIDI + octave * 12 + degree;
	}

	private triggerPathNote({
		view,
		term,
		termIndex,
		maxAmplitude,
		maxFrequency,
		strokeWidth,
		sampled,
	}: {
		view: BivectorSoundView;
		term: FourierTerm;
		termIndex: number;
		maxAmplitude: number;
		maxFrequency: number;
		strokeWidth: number;
		sampled: SampledPathPoint;
	}) {
		if (!this.context || !this.inputGain) return;

		const scaleStep = this.getScaleStep({
			sampled,
			term,
			maxFrequency,
			view,
		});

		const midi = this.getMidiFromScaleStep(scaleStep);
		const frequency = midiToHz(midi);

		const amplitudeRatio = clamp(term.amplitude / maxAmplitude, 0, 1);
		const orientationPan = term.frequency < 0 ? -0.07 : 0.07;
		const pathPan = (sampled.normalizedX - 0.5) * 0.42;
		const pan = clamp(pathPan + orientationPan, -0.42, 0.42);

		if (view === "disk") {
			this.triggerMusicalCup({
				frequency,
				pan,
				amplitudeRatio,
				curvature: sampled.curvature,
				strokeWidth,
			});

			return;
		}

		if (view === "companion") {
			this.triggerCompanionPair({
				scaleStep,
				pan,
				amplitudeRatio,
				curvature: sampled.curvature,
				strokeWidth,
				isNegativeFrequency: term.frequency < 0,
			});

			return;
		}

		this.triggerRainDrum({
			frequency,
			pan,
			amplitudeRatio,
			curvature: sampled.curvature,
			strokeWidth,
			termIndex,
		});
	}

	private triggerMusicalCup({
		frequency,
		pan,
		amplitudeRatio,
		curvature,
		strokeWidth,
	}: {
		frequency: number;
		pan: number;
		amplitudeRatio: number;
		curvature: number;
		strokeWidth: number;
	}) {
		const gain = 0.008 + 0.03 * amplitudeRatio ** 0.78;
		const attack = 0.085 + Math.min(0.045, strokeWidth * 0.003);
		const decay = 3.25 + amplitudeRatio * 2.4 + curvature * 0.8;

		this.triggerSineCluster({
			frequency,
			pan,
			gain,
			attack,
			decay,
			partials: [
				{ ratio: 1, gain: 1 },
				{ ratio: 2, gain: 0.16 },
				{ ratio: 3, gain: 0.045 },
			],
			drift: 0.996,
		});
	}

	private triggerRainDrum({
		frequency,
		pan,
		amplitudeRatio,
		curvature,
		strokeWidth,
		termIndex,
	}: {
		frequency: number;
		pan: number;
		amplitudeRatio: number;
		curvature: number;
		strokeWidth: number;
		termIndex: number;
	}) {
		const gain = 0.009 + 0.038 * amplitudeRatio ** 0.76;
		const attack = 0.018 + Math.min(0.025, strokeWidth * 0.002);
		const decay = 0.95 + amplitudeRatio * 1.2 + curvature * 0.45;

		this.triggerSineCluster({
			frequency,
			pan,
			gain,
			attack,
			decay,
			partials: [
				{ ratio: 1, gain: 1 },
				{ ratio: 2, gain: 0.12 },
			],
			drift: 0.992,
		});

		if (curvature > 0.32 || termIndex % 4 === 0) {
			this.triggerSoftDroplet({
				frequency: frequency * 2,
				pan: clamp(pan * 1.2, -0.5, 0.5),
				gain: gain * 0.32,
				delaySeconds: 0.035,
			});
		}
	}

	private triggerCompanionPair({
		scaleStep,
		pan,
		amplitudeRatio,
		curvature,
		strokeWidth,
		isNegativeFrequency,
	}: {
		scaleStep: number;
		pan: number;
		amplitudeRatio: number;
		curvature: number;
		strokeWidth: number;
		isNegativeFrequency: boolean;
	}) {
		const companionStep = clamp(
			scaleStep + (isNegativeFrequency ? -2 : 2),
			0,
			SCALE.length * OCTAVE_COUNT - 1,
		);

		const firstFrequency = midiToHz(this.getMidiFromScaleStep(scaleStep));
		const secondFrequency = midiToHz(
			this.getMidiFromScaleStep(companionStep),
		);

		const gain = 0.006 + 0.024 * amplitudeRatio ** 0.8;
		const attack = 0.055 + Math.min(0.035, strokeWidth * 0.0025);
		const decay = 2.1 + amplitudeRatio * 1.6 + curvature * 0.45;

		this.triggerSineCluster({
			frequency: firstFrequency,
			pan,
			gain,
			attack,
			decay,
			partials: [
				{ ratio: 1, gain: 1 },
				{ ratio: 2, gain: 0.12 },
			],
			drift: 0.997,
		});

		this.triggerSineCluster({
			frequency: secondFrequency,
			pan: clamp(-pan * 0.85, -0.42, 0.42),
			gain: gain * 0.72,
			attack: attack + 0.025,
			decay: decay * 0.92,
			partials: [
				{ ratio: 1, gain: 1 },
				{ ratio: 2, gain: 0.1 },
			],
			drift: 0.998,
			delaySeconds: 0.055,
		});
	}

	private triggerSineCluster({
		frequency,
		pan,
		gain,
		attack,
		decay,
		partials,
		drift,
		delaySeconds = 0,
	}: {
		frequency: number;
		pan: number;
		gain: number;
		attack: number;
		decay: number;
		partials: SinePartial[];
		drift: number;
		delaySeconds?: number;
	}) {
		if (!this.context || !this.inputGain) return;

		const context = this.context;
		const startAt = context.currentTime + delaySeconds;

		const panner = context.createStereoPanner();
		const voiceGain = context.createGain();

		panner.pan.setValueAtTime(pan, startAt);

		voiceGain.gain.setValueAtTime(0.0001, startAt);
		voiceGain.gain.exponentialRampToValueAtTime(
			Math.max(0.0002, gain),
			startAt + attack,
		);
		voiceGain.gain.exponentialRampToValueAtTime(
			0.0001,
			startAt + attack + decay,
		);

		panner.connect(voiceGain);
		voiceGain.connect(this.inputGain);

		for (const partial of partials) {
			const oscillator = context.createOscillator();
			const partialGain = context.createGain();

			oscillator.type = "sine";
			oscillator.frequency.setValueAtTime(
				frequency * partial.ratio,
				startAt,
			);
			oscillator.frequency.exponentialRampToValueAtTime(
				frequency * partial.ratio * drift,
				startAt + Math.min(decay, 2.8),
			);
			oscillator.detune.setValueAtTime(partial.detune ?? 0, startAt);

			partialGain.gain.setValueAtTime(partial.gain, startAt);

			oscillator.connect(partialGain);
			partialGain.connect(panner);

			oscillator.start(startAt);
			oscillator.stop(startAt + attack + decay + 0.28);

			oscillator.addEventListener("ended", () => {
				oscillator.disconnect();
				partialGain.disconnect();
			});
		}

		window.setTimeout(
			() => {
				panner.disconnect();
				voiceGain.disconnect();
			},
			(delaySeconds + attack + decay + 0.45) * 1000,
		);
	}

	private triggerSoftDroplet({
		frequency,
		pan,
		gain,
		delaySeconds,
	}: {
		frequency: number;
		pan: number;
		gain: number;
		delaySeconds: number;
	}) {
		if (!this.context || !this.inputGain) return;

		const context = this.context;
		const startAt = context.currentTime + delaySeconds;

		const oscillator = context.createOscillator();
		const filter = context.createBiquadFilter();
		const panner = context.createStereoPanner();
		const pingGain = context.createGain();

		oscillator.type = "sine";
		oscillator.frequency.setValueAtTime(frequency, startAt);
		oscillator.frequency.exponentialRampToValueAtTime(
			frequency * 0.74,
			startAt + 0.24,
		);

		filter.type = "bandpass";
		filter.frequency.value = frequency;
		filter.Q.value = 5.5;

		panner.pan.setValueAtTime(pan, startAt);

		pingGain.gain.setValueAtTime(0.0001, startAt);
		pingGain.gain.exponentialRampToValueAtTime(
			Math.max(0.0002, gain),
			startAt + 0.014,
		);
		pingGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.48);

		oscillator.connect(filter);
		filter.connect(panner);
		panner.connect(pingGain);
		pingGain.connect(this.inputGain);

		oscillator.start(startAt);
		oscillator.stop(startAt + 0.56);

		oscillator.addEventListener("ended", () => {
			oscillator.disconnect();
			filter.disconnect();
			panner.disconnect();
			pingGain.disconnect();
		});
	}
}
