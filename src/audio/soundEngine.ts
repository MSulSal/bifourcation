import type { Point } from "../types/geometry";

export type SonicFourierTerm = {
	frequency?: number;
	freq?: number;
	k?: number;
	n?: number;
	harmonic?: number;
	index?: number;
	amplitude?: number;
	magnitude?: number;
	radius?: number;
	phase?: number;
	angle?: number;
	real?: number;
	imaginary?: number;
	re?: number;
	im?: number;
	x?: number;
	y?: number;
	coefficient?: unknown;
	value?: unknown;
	vector?: unknown;
};

export type SonicStroke = {
	id: string;
	color: string;
	width: number;
	path: readonly Point[];
	terms: readonly SonicFourierTerm[];
};

type BivectorView = "blade" | "disk" | "companion";
type AnimationTraceMode = "sequential" | "simultaneous";

type Voice = {
	key: string;
	view: BivectorView;
	gain: GainNode;
	pan: StereoPannerNode;
	filter: BiquadFilterNode;
	oscillators: OscillatorNode[];
	stopping: boolean;
};

type RotorTarget = {
	key: string;
	view: BivectorView;
	frequencyHz: number;
	gain: number;
	pan: number;
	filterHz: number;
	detuneCents: number;
};

const MAX_ACTIVE_VOICES = 18;
const LOOP_SECONDS = 8;
const MASTER_GAIN = 0.42;

const PENTATONIC_STEPS = [0, 2, 4, 7, 9];
const BASE_NOTE_HZ = 130.8128;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
	const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

	return t * t * (3 - 2 * t);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getNumber(record: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		const value = record[key];

		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}

	return null;
}

function getPointLike(value: unknown): { x: number; y: number } | null {
	if (Array.isArray(value)) {
		const x = value[0];
		const y = value[1];

		if (
			typeof x === "number" &&
			Number.isFinite(x) &&
			typeof y === "number" &&
			Number.isFinite(y)
		) {
			return { x, y };
		}

		return null;
	}

	if (!isRecord(value)) return null;

	const x = getNumber(value, ["x", "real", "re"]);
	const y = getNumber(value, ["y", "imaginary", "im"]);

	if (x !== null && y !== null) {
		return { x, y };
	}

	const amplitude = getNumber(value, ["amplitude", "magnitude", "radius"]);
	const phase = getNumber(value, ["phase", "angle"]);

	if (amplitude !== null && phase !== null) {
		return {
			x: amplitude * Math.cos(phase),
			y: amplitude * Math.sin(phase),
		};
	}

	return null;
}

function getCoefficient(term: SonicFourierTerm) {
	const record = term as Record<string, unknown>;

	const nested =
		getPointLike(record.coefficient) ??
		getPointLike(record.value) ??
		getPointLike(record.vector);

	if (nested) return nested;

	const direct = getPointLike(record);
	if (direct) return direct;

	const amplitude = getNumber(record, ["amplitude", "magnitude", "radius"]);
	const phase = getNumber(record, ["phase", "angle"]) ?? 0;

	if (amplitude !== null) {
		return {
			x: amplitude * Math.cos(phase),
			y: amplitude * Math.sin(phase),
		};
	}

	return {
		x: 0,
		y: 0,
	};
}

function getAmplitude(term: SonicFourierTerm) {
	const record = term as Record<string, unknown>;
	const directAmplitude = getNumber(record, [
		"amplitude",
		"magnitude",
		"radius",
	]);

	if (directAmplitude !== null) {
		return Math.abs(directAmplitude);
	}

	const coefficient = getCoefficient(term);

	return Math.hypot(coefficient.x, coefficient.y);
}

function getPhase(term: SonicFourierTerm) {
	const record = term as Record<string, unknown>;
	const directPhase = getNumber(record, ["phase", "angle"]);

	if (directPhase !== null) return directPhase;

	const coefficient = getCoefficient(term);

	return Math.atan2(coefficient.y, coefficient.x);
}

function fallbackDftFrequency(index: number) {
	if (index === 0) return 0;

	return index % 2 === 1 ? (index + 1) / 2 : -index / 2;
}

function getRotorFrequency(term: SonicFourierTerm, index: number) {
	const record = term as Record<string, unknown>;
	const directFrequency = getNumber(record, [
		"frequency",
		"freq",
		"k",
		"n",
		"harmonic",
		"index",
	]);

	return directFrequency ?? fallbackDftFrequency(index);
}

function rotorFrequencyToHz(rotorFrequency: number, phase: number) {
	const absoluteFrequency = Math.abs(Math.round(rotorFrequency));

	if (absoluteFrequency === 0) return 0;

	const degree = absoluteFrequency % PENTATONIC_STEPS.length;
	const octave = clamp(
		Math.floor(absoluteFrequency / PENTATONIC_STEPS.length),
		0,
		3,
	);
	const phaseOctave = phase > Math.PI / 2 || phase < -Math.PI / 2 ? 1 : 0;
	const semitones = PENTATONIC_STEPS[degree] + 12 * (octave + phaseOctave);

	return BASE_NOTE_HZ * 2 ** (semitones / 12);
}

function getStrokeWeight({
	strokeIndex,
	strokeCount,
	traceMode,
	elapsedSeconds,
}: {
	strokeIndex: number;
	strokeCount: number;
	traceMode: AnimationTraceMode;
	elapsedSeconds: number;
}) {
	if (strokeCount <= 0) return 0;
	if (traceMode === "simultaneous") return 1;

	const phase =
		((elapsedSeconds % LOOP_SECONDS) + LOOP_SECONDS) / LOOP_SECONDS;
	const position = phase * strokeCount;
	const wrappedDistance = Math.min(
		Math.abs(position - strokeIndex),
		Math.abs(position - strokeIndex - strokeCount),
		Math.abs(position - strokeIndex + strokeCount),
	);

	return 1 - smoothstep(0.2, 1, wrappedDistance);
}

function createTargetKey({
	strokeId,
	termIndex,
	rotorFrequency,
	view,
}: {
	strokeId: string;
	termIndex: number;
	rotorFrequency: number;
	view: BivectorView;
}) {
	return `${view}:${strokeId}:${termIndex}:${rotorFrequency}`;
}

function buildRotorTargets({
	strokes,
	view,
	traceMode,
	visibleTermCount,
	elapsedSeconds,
}: {
	strokes: readonly SonicStroke[];
	view: BivectorView;
	traceMode: AnimationTraceMode;
	visibleTermCount: number;
	elapsedSeconds: number;
}): RotorTarget[] {
	const termLimit = clamp(Math.round(visibleTermCount), 0, 256);

	if (termLimit === 0) return [];

	const rawTargets: Array<
		RotorTarget & {
			amplitude: number;
			strokeWeight: number;
		}
	> = [];

	for (const [strokeIndex, stroke] of strokes.entries()) {
		const strokeWeight = getStrokeWeight({
			strokeIndex,
			strokeCount: strokes.length,
			traceMode,
			elapsedSeconds,
		});

		if (strokeWeight <= 0.001) continue;

		const visibleTerms = stroke.terms.slice(0, termLimit);
		const maxAmplitude = Math.max(
			...visibleTerms.map(term => getAmplitude(term)),
			0.000001,
		);

		for (const [termIndex, term] of visibleTerms.entries()) {
			const rotorFrequency = getRotorFrequency(term, termIndex);

			if (rotorFrequency === 0) continue;

			const amplitude = getAmplitude(term);
			if (amplitude <= 0.000001) continue;

			const phase = getPhase(term);
			const frequencyHz = rotorFrequencyToHz(rotorFrequency, phase);
			if (frequencyHz <= 0) continue;

			const normalizedAmplitude = clamp(amplitude / maxAmplitude, 0, 1);
			const coefficient = getCoefficient(term);
			const pan =
				Math.sin(phase) * 0.46 +
				Math.sign(rotorFrequency) * 0.16 +
				clamp(coefficient.x, -1, 1) * 0.08;

			const brightness = 800 + normalizedAmplitude * 2300;
			const directionDetune = rotorFrequency < 0 ? -5 : 5;

			rawTargets.push({
				key: createTargetKey({
					strokeId: stroke.id,
					termIndex,
					rotorFrequency,
					view,
				}),
				view,
				frequencyHz,
				gain:
					(0.018 + normalizedAmplitude * 0.044) *
					strokeWeight *
					Math.sqrt(normalizedAmplitude),
				pan: clamp(pan, -0.88, 0.88),
				filterHz: brightness,
				detuneCents: directionDetune + Math.sin(phase) * 5,
				amplitude,
				strokeWeight,
			});
		}
	}

	rawTargets.sort(
		(a, b) => b.amplitude * b.strokeWeight - a.amplitude * a.strokeWeight,
	);

	const dominantTargets = rawTargets.slice(0, MAX_ACTIVE_VOICES);
	const totalGain = dominantTargets.reduce(
		(total, target) => total + target.gain,
		0,
	);
	const gainScale = totalGain > 0.5 ? 0.5 / totalGain : 1;

	return dominantTargets.map(target => ({
		key: target.key,
		view: target.view,
		frequencyHz: target.frequencyHz,
		gain: target.gain * gainScale,
		pan: target.pan,
		filterHz: target.filterHz,
		detuneCents: target.detuneCents,
	}));
}

function createAudioContext() {
	const AudioContextCtor =
		window.AudioContext ??
		(
			window as typeof window & {
				webkitAudioContext?: typeof AudioContext;
			}
		).webkitAudioContext;

	if (!AudioContextCtor) {
		throw new Error("Web Audio is not supported in this browser.");
	}

	return new AudioContextCtor();
}

export class DrawingSoundEngine {
	private context: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private compressor: DynamicsCompressorNode | null = null;
	private voices = new Map<string, Voice>();
	private clockStartSeconds: number | null = null;

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

		if (this.clockStartSeconds === null) {
			this.clockStartSeconds = context.currentTime;
		}

		if (this.masterGain) {
			this.masterGain.gain.cancelScheduledValues(context.currentTime);
			this.masterGain.gain.setTargetAtTime(
				MASTER_GAIN,
				context.currentTime,
				0.08,
			);
		}
	}

	stop() {
		const context = this.context;
		if (!context) return;

		if (this.masterGain) {
			this.masterGain.gain.cancelScheduledValues(context.currentTime);
			this.masterGain.gain.setTargetAtTime(0, context.currentTime, 0.04);
		}

		for (const voice of this.voices.values()) {
			this.stopVoice(voice, context.currentTime);
		}

		this.voices.clear();
	}

	resetClock() {
		this.clockStartSeconds = this.context?.currentTime ?? null;
	}

	tick(
		strokes: readonly SonicStroke[],
		bivectorView: BivectorView,
		animationTraceMode: AnimationTraceMode,
		visibleTermCount = 256,
	) {
		const context = this.context;
		if (!context || !this.masterGain) return;

		if (this.clockStartSeconds === null) {
			this.clockStartSeconds = context.currentTime;
		}

		const elapsedSeconds = context.currentTime - this.clockStartSeconds;

		const targets = buildRotorTargets({
			strokes,
			view: bivectorView,
			traceMode: animationTraceMode,
			visibleTermCount,
			elapsedSeconds,
		});

		const activeKeys = new Set(targets.map(target => target.key));

		for (const target of targets) {
			const voice =
				this.voices.get(target.key) ??
				this.createVoice(target.key, target.view, context);

			this.voices.set(target.key, voice);
			this.updateVoice(voice, target, context.currentTime);
		}

		for (const [key, voice] of this.voices.entries()) {
			if (activeKeys.has(key)) continue;

			this.stopVoice(voice, context.currentTime);
			this.voices.delete(key);
		}
	}

	private ensureContext() {
		if (this.context) return this.context;

		const context = createAudioContext();
		const masterGain = context.createGain();
		const compressor = context.createDynamicsCompressor();

		masterGain.gain.value = 0;

		compressor.threshold.value = -22;
		compressor.knee.value = 24;
		compressor.ratio.value = 5;
		compressor.attack.value = 0.012;
		compressor.release.value = 0.18;

		masterGain.connect(compressor);
		compressor.connect(context.destination);

		this.context = context;
		this.masterGain = masterGain;
		this.compressor = compressor;

		return context;
	}

	private createVoice(
		key: string,
		view: BivectorView,
		context: AudioContext,
	) {
		if (!this.masterGain) {
			throw new Error("Audio graph was not initialized.");
		}

		const gain = context.createGain();
		const pan = context.createStereoPanner();
		const filter = context.createBiquadFilter();

		gain.gain.value = 0;
		filter.type = view === "blade" ? "bandpass" : "lowpass";
		filter.frequency.value = view === "companion" ? 1800 : 1400;
		filter.Q.value = view === "blade" ? 1.4 : 0.72;

		filter.connect(pan);
		pan.connect(gain);
		gain.connect(this.masterGain);

		const oscillators = this.createOscillatorsForView(
			view,
			context,
			filter,
		);

		for (const oscillator of oscillators) {
			oscillator.start();
		}

		return {
			key,
			view,
			gain,
			pan,
			filter,
			oscillators,
			stopping: false,
		};
	}

	private createOscillatorsForView(
		view: BivectorView,
		context: AudioContext,
		destination: AudioNode,
	) {
		if (view === "blade") {
			const main = context.createOscillator();
			const companion = context.createOscillator();
			const mainGain = context.createGain();
			const companionGain = context.createGain();

			main.type = "sine";
			companion.type = "triangle";
			mainGain.gain.value = 0.88;
			companionGain.gain.value = 0.12;

			main.connect(mainGain);
			companion.connect(companionGain);
			mainGain.connect(destination);
			companionGain.connect(destination);

			return [main, companion];
		}

		if (view === "disk") {
			const main = context.createOscillator();
			const body = context.createOscillator();
			const mainGain = context.createGain();
			const bodyGain = context.createGain();

			main.type = "triangle";
			body.type = "sine";
			mainGain.gain.value = 0.72;
			bodyGain.gain.value = 0.2;

			main.connect(mainGain);
			body.connect(bodyGain);
			mainGain.connect(destination);
			bodyGain.connect(destination);

			return [main, body];
		}

		const left = context.createOscillator();
		const right = context.createOscillator();
		const center = context.createOscillator();
		const leftGain = context.createGain();
		const rightGain = context.createGain();
		const centerGain = context.createGain();

		left.type = "sine";
		right.type = "sine";
		center.type = "triangle";

		leftGain.gain.value = 0.38;
		rightGain.gain.value = 0.38;
		centerGain.gain.value = 0.16;

		left.connect(leftGain);
		right.connect(rightGain);
		center.connect(centerGain);

		leftGain.connect(destination);
		rightGain.connect(destination);
		centerGain.connect(destination);

		return [left, right, center];
	}

	private updateVoice(voice: Voice, target: RotorTarget, now: number) {
		voice.stopping = false;

		voice.gain.gain.cancelScheduledValues(now);
		voice.gain.gain.setTargetAtTime(target.gain, now, 0.08);

		voice.pan.pan.cancelScheduledValues(now);
		voice.pan.pan.setTargetAtTime(target.pan, now, 0.12);

		voice.filter.frequency.cancelScheduledValues(now);
		voice.filter.frequency.setTargetAtTime(target.filterHz, now, 0.12);

		if (voice.view === "blade") {
			voice.oscillators[0]?.frequency.setTargetAtTime(
				target.frequencyHz,
				now,
				0.08,
			);
			voice.oscillators[1]?.frequency.setTargetAtTime(
				target.frequencyHz * 2,
				now,
				0.08,
			);

			voice.oscillators[0]?.detune.setTargetAtTime(
				target.detuneCents,
				now,
				0.1,
			);
			voice.oscillators[1]?.detune.setTargetAtTime(
				target.detuneCents * 0.4,
				now,
				0.1,
			);

			return;
		}

		if (voice.view === "disk") {
			voice.oscillators[0]?.frequency.setTargetAtTime(
				target.frequencyHz,
				now,
				0.1,
			);
			voice.oscillators[1]?.frequency.setTargetAtTime(
				target.frequencyHz / 2,
				now,
				0.1,
			);

			voice.oscillators[0]?.detune.setTargetAtTime(
				target.detuneCents * 0.5,
				now,
				0.1,
			);
			voice.oscillators[1]?.detune.setTargetAtTime(0, now, 0.1);

			return;
		}

		voice.oscillators[0]?.frequency.setTargetAtTime(
			target.frequencyHz,
			now,
			0.1,
		);
		voice.oscillators[1]?.frequency.setTargetAtTime(
			target.frequencyHz,
			now,
			0.1,
		);
		voice.oscillators[2]?.frequency.setTargetAtTime(
			target.frequencyHz * 1.5,
			now,
			0.1,
		);

		voice.oscillators[0]?.detune.setTargetAtTime(
			target.detuneCents - 7,
			now,
			0.1,
		);
		voice.oscillators[1]?.detune.setTargetAtTime(
			target.detuneCents + 7,
			now,
			0.1,
		);
		voice.oscillators[2]?.detune.setTargetAtTime(
			target.detuneCents * 0.25,
			now,
			0.1,
		);
	}

	private stopVoice(voice: Voice, now: number) {
		if (voice.stopping) return;

		voice.stopping = true;
		voice.gain.gain.cancelScheduledValues(now);
		voice.gain.gain.setTargetAtTime(0, now, 0.04);

		window.setTimeout(() => {
			for (const oscillator of voice.oscillators) {
				try {
					oscillator.stop();
				} catch {
					// Oscillator may already be stopped.
				}
			}

			try {
				voice.gain.disconnect();
				voice.pan.disconnect();
				voice.filter.disconnect();
			} catch {
				// Nodes may already be disconnected.
			}
		}, 220);
	}
}
