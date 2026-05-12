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

type SuperpositionTermTarget = {
	key: string;
	k: number;
	magnitude: number;
	phase: number;
	harmonic: number;
};

type SuperpositionTermState = SuperpositionTermTarget & {
	currentPhase: number;
};

type StrokeTarget = {
	id: string;
	view: BivectorView;
	activity: number;
	panBias: number;
	noteOffset: number;
	detail: number;
	terms: SuperpositionTermTarget[];
};

type StrokeState = {
	id: string;
	view: BivectorView;
	activity: number;
	currentActivity: number;
	panBias: number;
	currentPanBias: number;
	noteOffset: number;
	detail: number;
	currentDetail: number;
	terms: SuperpositionTermState[];
	lastSeenFrame: number;

	previousX: number;
	previousY: number;
	hasPreviousPoint: boolean;
	motionAccumulator: number;
	cooldownSamples: number;

	voicePhase: number;
	targetFrequencyHz: number;
	currentFrequencyHz: number;
	targetLeft: number;
	targetRight: number;
	currentLeft: number;
	currentRight: number;
};

type ResonatorState = {
	y1: number;
	y2: number;
	coefficient: number;
	decaySquared: number;
	gain: number;
};

const LOOP_SECONDS = 8;
const MASTER_GAIN = 0.34;
const PROCESSOR_BUFFER_SIZE = 4096;
const TWO_PI = Math.PI * 2;

const MIDI_A0 = 21;
const MIDI_C8 = 108;

/*
	One stroke/drawing = one instrument voice.

	All visible rotors in that stroke are superposed first:

		z(t) = Σ cₖ Rₖ(t)

	Then that superposition drives a keyed instrument:

		superposition position  -> note choice
		superposition motion    -> strike timing / velocity
		coefficient phases      -> shape of z(t)
		visible rotor count     -> which rotors participate
		bivector view           -> instrument body/timbre

	Individual rotors do not each play separate notes. They combine first.
	The combined field plays the instrument.
*/
const FUNDAMENTAL_BY_VIEW: Record<BivectorView, number> = {
	blade: 65.4064, // C2
	disk: 55, // A1
	companion: 48.9994, // G1
};

const ROOT_MIDI_BY_VIEW: Record<BivectorView, number> = {
	blade: 60, // C4
	disk: 57, // A3
	companion: 55, // G3
};

const SCALE_BY_VIEW: Record<BivectorView, number[]> = {
	blade: [0, 2, 4, 7, 9], // bright pentatonic
	disk: [0, 3, 5, 7, 10], // minor pentatonic / rain drum
	companion: [0, 2, 5, 7, 9], // suspended shimmer
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
	const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

	return t * t * (3 - 2 * t);
}

function wrapPhase(phase: number) {
	if (phase >= TWO_PI || phase <= -TWO_PI) {
		return phase % TWO_PI;
	}

	return phase;
}

function normalizePositivePhase(phase: number) {
	const wrapped = phase % TWO_PI;

	return wrapped < 0 ? wrapped + TWO_PI : wrapped;
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

function midiToFrequency(midi: number) {
	return 440 * 2 ** ((midi - 69) / 12);
}

function quantizeMidiToScale(rawMidi: number, view: BivectorView) {
	const root = ROOT_MIDI_BY_VIEW[view];
	const scale = SCALE_BY_VIEW[view];

	let bestMidi = root;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (let midi = MIDI_A0; midi <= MIDI_C8; midi += 1) {
		const interval = (((midi - root) % 12) + 12) % 12;

		if (!scale.includes(interval)) continue;

		const distance = Math.abs(midi - rawMidi);

		if (distance < bestDistance) {
			bestDistance = distance;
			bestMidi = midi;
		}
	}

	return bestMidi;
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

function hashString(value: string) {
	let hash = 2166136261;

	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

function softClip(value: number) {
	return Math.tanh(value);
}

function createResonators(
	sampleRate: number,
	view: BivectorView,
	side: "left" | "right",
) {
	const stereoOffset = side === "left" ? 0.997 : 1.003;

	const frequencies =
		view === "blade"
			? [261.6256, 329.6276, 392.0, 523.2511, 659.2551]
			: view === "disk"
				? [174.6141, 220.0, 261.6256, 329.6276, 391.9954]
				: [146.8324, 196.0, 293.6648, 391.9954, 587.3295];

	const decay = view === "blade" ? 0.9925 : view === "disk" ? 0.994 : 0.9945;
	const gain = view === "blade" ? 0.0036 : view === "disk" ? 0.0048 : 0.0044;

	return frequencies.map(frequency => {
		const angle = TWO_PI * ((frequency * stereoOffset) / sampleRate);

		return {
			y1: 0,
			y2: 0,
			coefficient: 2 * decay * Math.cos(angle),
			decaySquared: decay * decay,
			gain,
		};
	});
}

function processResonator(input: number, resonator: ResonatorState) {
	const next =
		input * resonator.gain +
		resonator.coefficient * resonator.y1 -
		resonator.decaySquared * resonator.y2;

	resonator.y2 = resonator.y1;
	resonator.y1 = next;

	return next;
}

function createDelayBuffer(sampleRate: number, seconds: number) {
	return new Float32Array(Math.max(1, Math.round(sampleRate * seconds)));
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

function buildStrokeTargets({
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
}): StrokeTarget[] {
	const termLimit = clamp(Math.round(visibleTermCount), 0, 256);

	if (termLimit === 0) return [];

	return strokes.flatMap((stroke, strokeIndex) => {
		const activity = getStrokeWeight({
			strokeIndex,
			strokeCount: strokes.length,
			traceMode,
			elapsedSeconds,
		});

		if (activity <= 0.0001) return [];

		const visibleTerms = stroke.terms.slice(0, termLimit);

		if (visibleTerms.length === 0) return [];

		const usableTerms = visibleTerms
			.map((term, termIndex) => {
				const k = Math.round(getRotorFrequency(term, termIndex));
				const amplitude = getAmplitude(term);
				const harmonic = Math.abs(k);

				return {
					key: `${termIndex}:${k}`,
					k,
					amplitude,
					phase: normalizePositivePhase(getPhase(term)),
					harmonic,
				};
			})
			.filter(term => term.amplitude > 0.000001);

		if (usableTerms.length === 0) return [];

		const amplitudeSum = usableTerms.reduce(
			(total, term) => total + term.amplitude,
			0,
		);

		if (amplitudeSum <= 0.000001) return [];

		const weightedDetail =
			usableTerms.reduce(
				(total, term) => total + term.amplitude * term.harmonic,
				0,
			) / amplitudeSum;

		const hash = hashString(`${stroke.id}:${stroke.color}`);
		const panBias = ((hash % 2000) / 1000 - 1) * 0.24;
		const noteOffset = Math.floor((hash / 2000) % 7) - 3;

		return [
			{
				id: stroke.id,
				view,
				activity,
				panBias,
				noteOffset,
				detail: clamp(weightedDetail / 64, 0, 1),
				terms: usableTerms.map(term => ({
					key: term.key,
					k: term.k,
					magnitude: term.amplitude / amplitudeSum,
					phase: term.phase,
					harmonic: term.harmonic,
				})),
			},
		];
	});
}

function mergeTerms(
	existingTerms: SuperpositionTermState[],
	nextTerms: SuperpositionTermTarget[],
) {
	const existingByKey = new Map(
		existingTerms.map(term => [term.key, term] as const),
	);

	return nextTerms.map(term => {
		const existing = existingByKey.get(term.key);

		return {
			...term,
			currentPhase: existing?.currentPhase ?? term.phase,
		};
	});
}

function advanceSuperposition(
	state: StrokeState,
	sampleRate: number,
): { x: number; y: number } {
	let x = 0;
	let y = 0;

	for (const term of state.terms) {
		term.currentPhase = wrapPhase(
			term.currentPhase + (TWO_PI * term.k) / LOOP_SECONDS / sampleRate,
		);

		x += term.magnitude * Math.cos(term.currentPhase);
		y += term.magnitude * Math.sin(term.currentPhase);
	}

	return { x, y };
}

function superpositionToMidi({
	x,
	y,
	speed,
	state,
}: {
	x: number;
	y: number;
	speed: number;
	state: StrokeState;
}) {
	const angle = normalizePositivePhase(Math.atan2(y, x));
	const angle01 = angle / TWO_PI;
	const radius = clamp(Math.hypot(x, y), 0, 1);
	const speedLift = clamp(Math.sqrt(speed) * 2.6, 0, 10);

	const root = ROOT_MIDI_BY_VIEW[state.view];
	const span = state.view === "blade" ? 26 : state.view === "disk" ? 22 : 25;

	const rawMidi =
		root +
		(angle01 - 0.5) * span +
		radius * 13 +
		speedLift +
		state.noteOffset;

	return quantizeMidiToScale(clamp(rawMidi, MIDI_A0, MIDI_C8), state.view);
}

export class DrawingSoundEngine {
	private context: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private compressor: DynamicsCompressorNode | null = null;
	private processor: ScriptProcessorNode | null = null;

	private strokeStates = new Map<string, StrokeState>();

	private clockStartSeconds: number | null = null;
	private isRunning = false;
	private frameCounter = 0;
	private currentView: BivectorView = "disk";

	private bodyLeft = 0;
	private bodyRight = 0;

	private delayLeft: Float32Array | null = null;
	private delayRight: Float32Array | null = null;
	private delayIndex = 0;

	private resonatorsLeft: ResonatorState[] = [];
	private resonatorsRight: ResonatorState[] = [];

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

		this.isRunning = true;

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

		this.isRunning = false;

		if (this.masterGain) {
			this.masterGain.gain.cancelScheduledValues(context.currentTime);
			this.masterGain.gain.setTargetAtTime(0, context.currentTime, 0.05);
		}

		for (const state of this.strokeStates.values()) {
			state.activity = 0;
			state.targetLeft = 0;
			state.targetRight = 0;
		}
	}

	resetClock() {
		this.clockStartSeconds = this.context?.currentTime ?? null;

		for (const state of this.strokeStates.values()) {
			for (const term of state.terms) {
				term.currentPhase = term.phase;
			}

			state.hasPreviousPoint = false;
			state.motionAccumulator = 0;
			state.cooldownSamples = 0;
		}
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

		if (this.currentView !== bivectorView) {
			this.currentView = bivectorView;
			this.rebuildResonators(context.sampleRate, bivectorView);
			this.bodyLeft = 0;
			this.bodyRight = 0;
			this.strokeStates.clear();
		}

		this.frameCounter += 1;

		const elapsedSeconds = context.currentTime - this.clockStartSeconds;

		const targets = buildStrokeTargets({
			strokes,
			view: bivectorView,
			traceMode: animationTraceMode,
			visibleTermCount,
			elapsedSeconds,
		});

		for (const target of targets) {
			const existing = this.strokeStates.get(target.id);

			if (existing) {
				existing.view = target.view;
				existing.activity = target.activity;
				existing.panBias = target.panBias;
				existing.noteOffset = target.noteOffset;
				existing.detail = target.detail;
				existing.terms = mergeTerms(existing.terms, target.terms);
				existing.lastSeenFrame = this.frameCounter;
				continue;
			}

			this.strokeStates.set(target.id, {
				id: target.id,
				view: target.view,
				activity: target.activity,
				currentActivity: 0,
				panBias: target.panBias,
				currentPanBias: target.panBias,
				noteOffset: target.noteOffset,
				detail: target.detail,
				currentDetail: target.detail,
				terms: target.terms.map(term => ({
					...term,
					currentPhase: term.phase,
				})),
				lastSeenFrame: this.frameCounter,

				previousX: 0,
				previousY: 0,
				hasPreviousPoint: false,
				motionAccumulator: 0,
				cooldownSamples: 0,

				voicePhase: target.terms[0]?.phase ?? 0,
				targetFrequencyHz: midiToFrequency(
					ROOT_MIDI_BY_VIEW[target.view],
				),
				currentFrequencyHz: midiToFrequency(
					ROOT_MIDI_BY_VIEW[target.view],
				),
				targetLeft: 0,
				targetRight: 0,
				currentLeft: 0,
				currentRight: 0,
			});
		}

		for (const state of this.strokeStates.values()) {
			if (state.lastSeenFrame !== this.frameCounter) {
				state.activity = 0;
			}
		}
	}

	private ensureContext() {
		if (this.context) return this.context;

		const context = createAudioContext();
		const masterGain = context.createGain();
		const compressor = context.createDynamicsCompressor();
		const processor = context.createScriptProcessor(
			PROCESSOR_BUFFER_SIZE,
			0,
			2,
		);

		masterGain.gain.value = 0;

		compressor.threshold.value = -28;
		compressor.knee.value = 30;
		compressor.ratio.value = 2.8;
		compressor.attack.value = 0.026;
		compressor.release.value = 0.34;

		processor.onaudioprocess = event => this.processAudio(event);

		processor.connect(masterGain);
		masterGain.connect(compressor);
		compressor.connect(context.destination);

		this.context = context;
		this.masterGain = masterGain;
		this.compressor = compressor;
		this.processor = processor;

		this.delayLeft = createDelayBuffer(context.sampleRate, 0.44);
		this.delayRight = createDelayBuffer(context.sampleRate, 0.49);
		this.rebuildResonators(context.sampleRate, this.currentView);

		return context;
	}

	private rebuildResonators(sampleRate: number, view: BivectorView) {
		this.resonatorsLeft = createResonators(sampleRate, view, "left");
		this.resonatorsRight = createResonators(sampleRate, view, "right");
	}

	private strikeStroke(
		state: StrokeState,
		midi: number,
		velocity: number,
		x: number,
		y: number,
	) {
		const frequencyHz = midiToFrequency(midi);
		const coefficientAngle = Math.atan2(y, x);

		const pan = clamp(
			state.currentPanBias + Math.sin(coefficientAngle) * 0.28,
			-0.82,
			0.82,
		);

		const leftGain = Math.sqrt((1 - pan) / 2);
		const rightGain = Math.sqrt((1 + pan) / 2);
		const viewGain =
			state.view === "blade" ? 0.9 : state.view === "disk" ? 1 : 0.94;

		state.targetFrequencyHz = frequencyHz;
		state.voicePhase = coefficientAngle;

		state.targetLeft = clamp(
			state.targetLeft + velocity * leftGain * viewGain,
			0,
			1.1,
		);
		state.targetRight = clamp(
			state.targetRight + velocity * rightGain * viewGain,
			0,
			1.1,
		);
	}

	private processAudio(event: AudioProcessingEvent) {
		const outputLeft = event.outputBuffer.getChannelData(0);
		const outputRight = event.outputBuffer.getChannelData(1);
		const sampleRate = event.outputBuffer.sampleRate;

		if (!this.isRunning || this.strokeStates.size === 0) {
			outputLeft.fill(0);
			outputRight.fill(0);
			return;
		}

		const view = this.currentView;

		const attackSeconds =
			view === "blade" ? 0.006 : view === "disk" ? 0.014 : 0.01;
		const decaySeconds =
			view === "blade" ? 0.68 : view === "disk" ? 1.28 : 1.06;
		const attackAlpha = 1 - Math.exp(-1 / (sampleRate * attackSeconds));
		const targetDecay = Math.exp(-1 / (sampleRate * decaySeconds));

		const lowpassCutoff =
			view === "blade" ? 3600 : view === "disk" ? 2300 : 2800;
		const lowpassAlpha =
			1 - Math.exp((-TWO_PI * lowpassCutoff) / sampleRate);

		const delayLeft = this.delayLeft;
		const delayRight = this.delayRight;
		const hasDelay = delayLeft !== null && delayRight !== null;
		const delayWet =
			view === "blade" ? 0.055 : view === "disk" ? 0.09 : 0.11;
		const delayFeedback =
			view === "blade" ? 0.09 : view === "disk" ? 0.15 : 0.17;

		const dryMix = view === "blade" ? 0.36 : view === "disk" ? 0.22 : 0.27;
		const resonatorWet =
			view === "blade" ? 0.58 : view === "disk" ? 0.86 : 0.74;

		const strikeDistance =
			view === "blade" ? 0.085 : view === "disk" ? 0.13 : 0.105;
		const minStrikeGapSamples =
			view === "blade"
				? Math.round(sampleRate * 0.07)
				: view === "disk"
					? Math.round(sampleRate * 0.12)
					: Math.round(sampleRate * 0.09);

		for (
			let sampleIndex = 0;
			sampleIndex < outputLeft.length;
			sampleIndex += 1
		) {
			let keysLeft = 0;
			let keysRight = 0;

			for (const [id, state] of this.strokeStates.entries()) {
				state.currentActivity +=
					(state.activity - state.currentActivity) * 0.0016;
				state.currentPanBias +=
					(state.panBias - state.currentPanBias) * 0.0015;
				state.currentDetail +=
					(state.detail - state.currentDetail) * 0.0015;

				if (
					state.currentActivity <= 0.00001 &&
					state.activity === 0 &&
					state.currentLeft < 0.000003 &&
					state.currentRight < 0.000003
				) {
					this.strokeStates.delete(id);
					continue;
				}

				const point = advanceSuperposition(state, sampleRate);
				let speed = 0;

				if (state.hasPreviousPoint) {
					speed =
						Math.hypot(
							point.x - state.previousX,
							point.y - state.previousY,
						) * sampleRate;
				} else {
					state.hasPreviousPoint = true;
				}

				state.previousX = point.x;
				state.previousY = point.y;

				const activeSpeed = speed * state.currentActivity;
				state.motionAccumulator += activeSpeed / sampleRate;

				if (state.cooldownSamples > 0) {
					state.cooldownSamples -= 1;
				}

				if (
					state.motionAccumulator >= strikeDistance &&
					state.cooldownSamples <= 0 &&
					state.currentActivity > 0.01
				) {
					state.motionAccumulator %= strikeDistance;

					const midi = superpositionToMidi({
						x: point.x,
						y: point.y,
						speed: activeSpeed,
						state,
					});

					const velocity = clamp(
						0.035 +
							Math.sqrt(activeSpeed) * 0.065 +
							state.currentDetail * 0.035,
						0.025,
						0.38,
					);

					this.strikeStroke(state, midi, velocity, point.x, point.y);
					state.cooldownSamples = minStrikeGapSamples;
				}

				state.targetLeft *= targetDecay;
				state.targetRight *= targetDecay;

				state.currentLeft +=
					(state.targetLeft - state.currentLeft) * attackAlpha;
				state.currentRight +=
					(state.targetRight - state.currentRight) * attackAlpha;

				state.currentFrequencyHz +=
					(state.targetFrequencyHz - state.currentFrequencyHz) *
					0.002;

				state.voicePhase = wrapPhase(
					state.voicePhase +
						(TWO_PI * state.currentFrequencyHz) / sampleRate,
				);

				const phase = state.voicePhase;
				const brightness = clamp(state.currentDetail, 0, 1);

				let toneLeft = 0;
				let toneRight = 0;

				if (state.view === "blade") {
					const glassPartial =
						Math.sin(phase * 2.01 + 0.2) * 0.085 * brightness;

					toneLeft = Math.sin(phase) * 0.92 + glassPartial;
					toneRight =
						Math.sin(phase + 0.012) * 0.92 + glassPartial * 0.94;
				} else if (state.view === "disk") {
					const bodyPartial =
						Math.sin(phase * 2 + 0.12) * 0.04 * brightness;
					const lowBody = Math.sin(phase * 0.5) * 0.055;

					toneLeft = Math.sin(phase) * 0.88 + bodyPartial + lowBody;
					toneRight =
						Math.sin(phase + 0.008) * 0.88 +
						bodyPartial * 0.94 +
						lowBody;
				} else {
					const shimmer =
						Math.sin(phase * 2.003 + 0.35) * 0.052 * brightness;

					toneLeft =
						Math.sin(phase - 0.018) * 0.84 +
						Math.sin(phase * 1.5) * 0.032 +
						shimmer;
					toneRight =
						Math.sin(phase + 0.018) * 0.84 +
						Math.sin(phase * 1.5 + 0.08) * 0.032 +
						shimmer * 0.9;
				}

				keysLeft += state.currentLeft * toneLeft;
				keysRight += state.currentRight * toneRight;
			}

			keysLeft = softClip(keysLeft * 1.08);
			keysRight = softClip(keysRight * 1.08);

			this.bodyLeft += (keysLeft - this.bodyLeft) * lowpassAlpha;
			this.bodyRight += (keysRight - this.bodyRight) * lowpassAlpha;

			let resonantLeft = 0;
			let resonantRight = 0;

			for (const resonator of this.resonatorsLeft) {
				resonantLeft += processResonator(this.bodyLeft, resonator);
			}

			for (const resonator of this.resonatorsRight) {
				resonantRight += processResonator(this.bodyRight, resonator);
			}

			let delayedLeft = 0;
			let delayedRight = 0;

			if (hasDelay && delayLeft && delayRight) {
				delayedLeft = delayLeft[this.delayIndex] ?? 0;
				delayedRight = delayRight[this.delayIndex] ?? 0;

				delayLeft[this.delayIndex] =
					(this.bodyLeft + resonantLeft * 0.8) * 0.18 +
					delayedRight * delayFeedback;
				delayRight[this.delayIndex] =
					(this.bodyRight + resonantRight * 0.8) * 0.18 +
					delayedLeft * delayFeedback;

				this.delayIndex = (this.delayIndex + 1) % delayLeft.length;
			}

			const wetLeft =
				keysLeft * dryMix +
				resonantLeft * resonatorWet +
				delayedLeft * delayWet;

			const wetRight =
				keysRight * dryMix +
				resonantRight * resonatorWet +
				delayedRight * delayWet;

			outputLeft[sampleIndex] = softClip(wetLeft);
			outputRight[sampleIndex] = softClip(wetRight);
		}
	}
}
