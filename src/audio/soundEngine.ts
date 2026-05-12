import type { Point } from "../types/geometry";

export type BivectorSoundView = "blade" | "disk" | "companion";

export type SonicStroke = {
	id: string;
	color: string;
	width: number;
	path: Point[];
	terms: unknown[];
};

export type RotorSoundComponent = {
	center: Point;
	tip: Point;
	radius: number;
	frequency: number;
};

export type RotorSoundStrokeFrame = {
	id: string;
	color: string;
	width: number;
	path: Point[];
	progress: number;
	activity: number;
	rotors: RotorSoundComponent[];
};

export type RotorSoundFrame = {
	view: BivectorSoundView;
	canvasWidth: number;
	canvasHeight: number;
	strokes: RotorSoundStrokeFrame[];
};

type ActiveNote = {
	source: OscillatorNode;
	filter: BiquadFilterNode;
	gain: GainNode;
	panNode: StereoPannerNode | null;
	stopTime: number;
};

type StrokeSoundState = {
	id: string;
	degree: number;
	midi: number;
	sizeBucket: number;
	heldDegree: number;
	heldMidi: number;
	heldSizeBucket: number;
	view: BivectorSoundView;
	activity: number;
	pan: number;
	detail: number;
	activeNotes: ActiveNote[];
	lastSeenFrame: number;
	needsInitialNote: boolean;
	lastTriggerTime: number;
};

type WebAudioWindow = Window &
	typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	};

const MASTER_GAIN = 0.28;
const TWO_PI = Math.PI * 2;
const MIDI_A0 = 21;
const MIDI_C8 = 108;
const SIZE_BUCKET_COUNT = 11;
const MAX_ACTIVE_NOTES_PER_STROKE = 8;
const MIN_NOTE_INTERVAL_SECONDS = 0.045;
const SOLFEGE_INTERVALS = [0, 2, 4, 5, 7, 9, 11, 12];

function clamp(value: number, min: number, max: number) {
	if (!Number.isFinite(value)) return min;

	return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle: number) {
	const wrapped = angle % TWO_PI;

	return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function midiToHz(midi: number) {
	return 440 * 2 ** ((midi - 69) / 12);
}

function getAudioContextConstructor() {
	return (
		window.AudioContext ??
		(window as WebAudioWindow).webkitAudioContext ??
		null
	);
}

function getPathLength(path: Point[]) {
	let total = 0;

	for (let index = 1; index < path.length; index += 1) {
		const previous = path[index - 1];
		const current = path[index];

		total += Math.hypot(current.x - previous.x, current.y - previous.y);
	}

	return total;
}

function getPathBounds(path: Point[]) {
	if (path.length === 0) {
		return {
			width: 0,
			height: 0,
			area: 0,
		};
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const point of path) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}

	const width = Math.max(0, maxX - minX);
	const height = Math.max(0, maxY - minY);

	return {
		width,
		height,
		area: width * height,
	};
}

function getSizeRatio(stroke: RotorSoundStrokeFrame, frame: RotorSoundFrame) {
	const bounds = getPathBounds(stroke.path);
	const canvasArea = Math.max(1, frame.canvasWidth * frame.canvasHeight);
	const canvasDiagonal = Math.max(
		1,
		Math.hypot(frame.canvasWidth, frame.canvasHeight),
	);
	const areaRatio = clamp(bounds.area / canvasArea, 0, 1);
	const lengthRatio = clamp(
		getPathLength(stroke.path) / canvasDiagonal,
		0,
		1,
	);
	const lengthAreaProxy = lengthRatio * lengthRatio;

	return clamp(Math.max(areaRatio, lengthAreaProxy), 0, 1);
}

function getSizeBucket(stroke: RotorSoundStrokeFrame, frame: RotorSoundFrame) {
	return clamp(
		Math.floor(getSizeRatio(stroke, frame) * SIZE_BUCKET_COUNT),
		0,
		SIZE_BUCKET_COUNT - 1,
	);
}

function getDegreeFromAngle(angle: number) {
	const sectorSize = TWO_PI / SOLFEGE_INTERVALS.length;

	return (
		Math.floor(normalizeAngle(angle) / sectorSize) %
		SOLFEGE_INTERVALS.length
	);
}

function getRotorVectorAngle(stroke: RotorSoundStrokeFrame) {
	const audibleRotors = stroke.rotors.filter(
		rotor => rotor.frequency !== 0 && rotor.radius > 0.000001,
	);

	if (audibleRotors.length === 0) return null;

	if (audibleRotors.length === 1) {
		const rotor = audibleRotors[0];

		return Math.atan2(
			rotor.tip.y - rotor.center.y,
			rotor.tip.x - rotor.center.x,
		);
	}

	const largest = audibleRotors.reduce((best, rotor) =>
		rotor.radius > best.radius ? rotor : best,
	);
	const smallest = audibleRotors.reduce((best, rotor) =>
		rotor.radius < best.radius ? rotor : best,
	);

	const dx = smallest.center.x - largest.center.x;
	const dy = smallest.center.y - largest.center.y;

	if (Math.hypot(dx, dy) > 0.000001) {
		return Math.atan2(dy, dx);
	}

	return Math.atan2(
		smallest.tip.y - smallest.center.y,
		smallest.tip.x - smallest.center.x,
	);
}

function getMidiForDegreeAndSize({
	degree,
	sizeBucket,
}: {
	degree: number;
	sizeBucket: number;
}) {
	const usableLowRoot = 24; // C1
	const usableHighRoot = 96; // C7
	const octave01 = 1 - sizeBucket / Math.max(1, SIZE_BUCKET_COUNT - 1);
	const rootMidi =
		Math.round(
			(usableLowRoot + octave01 * (usableHighRoot - usableLowRoot)) / 12,
		) * 12;
	const interval = SOLFEGE_INTERVALS[degree % SOLFEGE_INTERVALS.length] ?? 0;

	return clamp(rootMidi + interval, MIDI_A0, MIDI_C8);
}

function getPan(id: string) {
	let hash = 2166136261;

	for (let index = 0; index < id.length; index += 1) {
		hash ^= id.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return (((hash >>> 0) % 2000) / 1000 - 1) * 0.28;
}

function getDetail(stroke: RotorSoundStrokeFrame) {
	const audibleRotors = stroke.rotors.filter(
		rotor => rotor.frequency !== 0 && rotor.radius > 0.000001,
	);
	const radiusSum = audibleRotors.reduce(
		(total, rotor) => total + rotor.radius,
		0,
	);

	if (radiusSum <= 0.000001) return 0;

	const weightedFrequency =
		audibleRotors.reduce(
			(total, rotor) => total + Math.abs(rotor.frequency) * rotor.radius,
			0,
		) / radiusSum;

	return clamp(weightedFrequency / 128, 0, 1);
}

function getInstrumentSettings(view: BivectorSoundView, detail: number) {
	/*
		These are intentionally gentle. The pitch logic is already discrete
		keyboard-note logic; the view only changes envelope/filter character.
		Lower velocity, softer attacks, shorter decays, and lower filter cutoffs
		keep sector crossings from stacking into brittle clipping.
	*/
	if (view === "blade") {
		return {
			oscillatorType: "triangle" as OscillatorType,
			attackSeconds: 0.018,
			decaySeconds: 0.95,
			filterFrequency: 3200 - detail * 650,
			filterQ: 0.55,
			velocity: 0.22,
		};
	}

	if (view === "companion") {
		return {
			oscillatorType: "triangle" as OscillatorType,
			attackSeconds: 0.014,
			decaySeconds: 1.05,
			filterFrequency: 2500 - detail * 520,
			filterQ: 0.72,
			velocity: 0.26,
		};
	}

	return {
		oscillatorType: "sine" as OscillatorType,
		attackSeconds: 0.034,
		decaySeconds: 1.85,
		filterFrequency: 1050 + detail * 320,
		filterQ: 0.82,
		velocity: 0.32,
	};
}

function createSoftLimiterCurve(samples = 2048) {
	const curve = new Float32Array(samples);

	for (let index = 0; index < samples; index += 1) {
		const x = (index / (samples - 1)) * 2 - 1;
		curve[index] = Math.tanh(x * 1.65) / Math.tanh(1.65);
	}

	return curve;
}

export class DrawingSoundEngine {
	private context: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private states = new Map<string, StrokeSoundState>();
	private frameCounter = 0;
	private isRunning = false;
	private volume = 1;

	async enable() {
		const context = this.ensureContext();

		if (context.state === "suspended") {
			await context.resume();
		}
	}

	setVolume(volume: number) {
		this.volume = clamp(volume, 0, 1);

		if (!this.context || !this.masterGain || !this.isRunning) return;

		const now = this.context.currentTime;

		this.masterGain.gain.cancelScheduledValues(now);
		this.masterGain.gain.setTargetAtTime(
			this.getMasterGainTarget(),
			now,
			0.04,
		);
	}

	private getMasterGainTarget() {
		return MASTER_GAIN * this.volume ** 1.6;
	}

	async start() {
		const context = this.ensureContext();

		if (context.state === "suspended") {
			await context.resume();
		}

		this.isRunning = true;

		for (const state of this.states.values()) {
			state.needsInitialNote = true;
		}

		if (this.masterGain) {
			const now = context.currentTime;

			this.masterGain.gain.cancelScheduledValues(now);
			this.masterGain.gain.setTargetAtTime(
				this.getMasterGainTarget(),
				now,
				0.06,
			);
		}
	}

	stop() {
		this.isRunning = false;

		if (!this.context || !this.masterGain) return;

		const now = this.context.currentTime;

		this.masterGain.gain.cancelScheduledValues(now);
		this.masterGain.gain.setTargetAtTime(0.0001, now, 0.04);

		for (const state of this.states.values()) {
			this.stopAllActiveNotes(state, now);
			state.needsInitialNote = true;
		}
	}

	resetClock() {
		for (const state of this.states.values()) {
			state.needsInitialNote = true;
		}
	}

	updateFromRotorFrame(frame: RotorSoundFrame) {
		if (!this.isRunning || !this.context || !this.masterGain) return;

		this.frameCounter += 1;

		for (const stroke of frame.strokes) {
			if (stroke.activity <= 0.0001) continue;

			const angle = getRotorVectorAngle(stroke);
			if (angle === null) continue;

			const degree = getDegreeFromAngle(angle);
			const sizeBucket = getSizeBucket(stroke, frame);
			const midi = getMidiForDegreeAndSize({ degree, sizeBucket });
			const existing = this.states.get(stroke.id);

			if (existing) {
				const degreeChanged = degree !== existing.degree;
				const sizeChanged = sizeBucket !== existing.sizeBucket;
				const becameActive =
					existing.activity <= 0.001 && stroke.activity > 0.001;
				const needsInitialNote = existing.needsInitialNote;

				existing.view = frame.view;
				existing.activity = stroke.activity;
				existing.pan = getPan(stroke.id);
				existing.detail = getDetail(stroke);
				existing.degree = degree;
				existing.sizeBucket = sizeBucket;
				existing.midi = midi;
				existing.lastSeenFrame = this.frameCounter;

				if (degreeChanged || sizeChanged) {
					existing.heldDegree = degree;
					existing.heldSizeBucket = sizeBucket;
					existing.heldMidi = midi;
				}

				if (
					degreeChanged ||
					sizeChanged ||
					becameActive ||
					needsInitialNote
				) {
					this.triggerKeyboardNote(
						existing,
						this.context.currentTime,
					);
					existing.needsInitialNote = false;
				}

				continue;
			}

			const nextState: StrokeSoundState = {
				id: stroke.id,
				degree,
				midi,
				sizeBucket,
				view: frame.view,
				activity: stroke.activity,
				pan: getPan(stroke.id),
				detail: getDetail(stroke),
				heldMidi: midi,
				heldDegree: degree,
				heldSizeBucket: sizeBucket,
				activeNotes: [],
				lastSeenFrame: this.frameCounter,
				needsInitialNote: false,
				lastTriggerTime: Number.NEGATIVE_INFINITY,
			};

			this.states.set(stroke.id, nextState);
			this.triggerKeyboardNote(nextState, this.context.currentTime);
		}

		for (const [id, state] of this.states.entries()) {
			this.cleanupFinishedNotes(state, this.context.currentTime);

			if (state.lastSeenFrame !== this.frameCounter) {
				state.activity = 0;
			}

			if (state.activity <= 0.0001 && state.activeNotes.length === 0) {
				this.states.delete(id);
			}
		}
	}

	private ensureContext() {
		if (this.context) return this.context;

		const AudioContextConstructor = getAudioContextConstructor();

		if (!AudioContextConstructor) {
			throw new Error("Web Audio is not supported in this browser.");
		}

		const context = new AudioContextConstructor();
		const masterGain = context.createGain();
		const masterFilter = context.createBiquadFilter();
		const compressor = context.createDynamicsCompressor();
		const limiter = context.createWaveShaper();

		masterGain.gain.value = 0.0001;

		masterFilter.type = "lowpass";
		masterFilter.frequency.value = 6800;
		masterFilter.Q.value = 0.45;

		compressor.threshold.value = -26;
		compressor.knee.value = 18;
		compressor.ratio.value = 5.0;
		compressor.attack.value = 0.006;
		compressor.release.value = 0.18;

		limiter.curve = createSoftLimiterCurve();
		limiter.oversample = "4x";

		masterGain.connect(masterFilter);
		masterFilter.connect(compressor);
		compressor.connect(limiter);
		limiter.connect(context.destination);

		this.context = context;
		this.masterGain = masterGain;

		return context;
	}

	private cleanupFinishedNotes(state: StrokeSoundState, time: number) {
		state.activeNotes = state.activeNotes.filter(
			note => note.stopTime > time,
		);
	}

	private stopNote(note: ActiveNote, time: number) {
		try {
			const gain = note.gain.gain;

			if (typeof gain.cancelAndHoldAtTime === "function") {
				gain.cancelAndHoldAtTime(time);
			} else {
				gain.cancelScheduledValues(time);
			}

			gain.setTargetAtTime(0.0001, time, 0.035);
			note.source.stop(time + 0.16);
		} catch {
			// The source may already have stopped.
		}
	}

	private stopAllActiveNotes(state: StrokeSoundState, time: number) {
		for (const note of state.activeNotes) {
			this.stopNote(note, time);
		}

		state.activeNotes = [];
	}

	private triggerKeyboardNote(state: StrokeSoundState, time: number) {
		const context = this.context;
		const masterGain = this.masterGain;
		if (!context || !masterGain) return;

		if (time - state.lastTriggerTime < MIN_NOTE_INTERVAL_SECONDS) return;
		state.lastTriggerTime = time;

		this.cleanupFinishedNotes(state, time);

		while (state.activeNotes.length >= MAX_ACTIVE_NOTES_PER_STROKE) {
			const oldest = state.activeNotes.shift();

			if (oldest) {
				this.stopNote(oldest, time);
			}
		}

		const settings = getInstrumentSettings(state.view, state.detail);
		const oscillator = context.createOscillator();
		const filter = context.createBiquadFilter();
		const noteGain = context.createGain();
		const panNode =
			typeof context.createStereoPanner === "function"
				? context.createStereoPanner()
				: null;

		const velocity = settings.velocity * clamp(state.activity, 0, 1);
		const attackEnd = time + settings.attackSeconds;
		const decayEnd = time + settings.decaySeconds;

		oscillator.type = settings.oscillatorType;
		oscillator.frequency.setValueAtTime(midiToHz(state.heldMidi), time);

		filter.type = "lowpass";
		filter.frequency.setValueAtTime(settings.filterFrequency, time);
		filter.Q.setValueAtTime(settings.filterQ, time);

		noteGain.gain.setValueAtTime(0.0001, time);
		noteGain.gain.linearRampToValueAtTime(
			Math.max(0.0001, velocity),
			attackEnd,
		);
		noteGain.gain.exponentialRampToValueAtTime(
			0.0001,
			Math.max(attackEnd + 0.05, decayEnd),
		);

		oscillator.connect(filter);
		filter.connect(noteGain);

		if (panNode) {
			panNode.pan.setValueAtTime(clamp(state.pan, -0.8, 0.8), time);
			noteGain.connect(panNode);
			panNode.connect(masterGain);
		} else {
			noteGain.connect(masterGain);
		}

		oscillator.start(time);
		oscillator.stop(decayEnd + 0.12);

		const activeNote: ActiveNote = {
			source: oscillator,
			filter,
			gain: noteGain,
			panNode,
			stopTime: decayEnd + 0.12,
		};

		state.activeNotes.push(activeNote);

		oscillator.onended = () => {
			oscillator.disconnect();
			filter.disconnect();
			noteGain.disconnect();

			if (panNode) {
				panNode.disconnect();
			}
		};
	}
}
