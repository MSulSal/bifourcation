import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type SetStateAction,
} from "react";
import {
	ChevronUp,
	Pause,
	Pencil,
	Play,
	Redo2,
	Trash2,
	Undo2,
	Upload,
	Volume2,
	VolumeX,
} from "lucide-react";
import { DrawingSoundEngine, type RotorSoundFrame } from "./audio/soundEngine";
import { BucketFillCanvas } from "./components/BucketFillCanvas";
import { DrawingCanvas } from "./components/DrawingCanvas";
import { ObjectTransformCanvas } from "./components/ObjectTransformCanvas";
import {
	RotorCanvas,
	type AnimationTraceMode,
	type BivectorView,
} from "./components/RotorCanvas";
import { ShapePlacementCanvas } from "./components/ShapePlacementCanvas";
import { traceImageFileToStrokes } from "./image/edgeTracing";
import { computeFourierTerms } from "./math/fourier";
import { resamplePath } from "./math/path";
import {
	createId,
	drawingObjectToStroke,
	flipShapeHorizontal,
	flipShapeVertical,
	getShapeLabel,
	SHAPE_TOOLS,
} from "./math/shapes";
import type {
	BucketFillObject,
	DrawingObject,
	ShapeKind,
	ShapeObject,
	Stroke,
} from "./types/geometry";

const MS_PAINT_COLORS = [
	"#000000",
	"#7F7F7F",
	"#880015",
	"#ED1C24",
	"#FF7F27",
	"#FFF200",
	"#22B14C",
	"#00A2E8",
	"#3F48CC",
	"#A349A4",
	"#FFFFFF",
	"#C3C3C3",
	"#B97A57",
	"#FFAEC9",
	"#FFC90E",
	"#EFE4B0",
	"#B5E61D",
	"#99D9EA",
	"#7092BE",
	"#C8BFE7",
	"#1C1C1C",
	"#4D4D4D",
	"#5F2B17",
	"#C00000",
	"#C55A11",
	"#BFB000",
	"#157A2C",
	"#0070C0",
	"#273A96",
	"#7030A0",
	"#F2F2F2",
	"#A6A6A6",
	"#D7A17A",
	"#FF6B6B",
	"#F4B183",
	"#FFF7A8",
	"#92D050",
	"#B7E1CD",
	"#8EA9DB",
	"#D9B3E6",
];

const MAX_FOURIER_TERMS = 256;
const DEFAULT_PEN_COLOR = "#E84D3D";
const DEFAULT_PEN_WIDTH = 4;
const DEFAULT_BIVECTOR_VIEW: BivectorView = "disk";
const DEFAULT_ANIMATION_TRACE_MODE: AnimationTraceMode = "sequential";
const DEFAULT_VISIBLE_TERM_COUNT = MAX_FOURIER_TERMS;
const DEFAULT_SOUND_VOLUME = 0.35;
const PASTE_OFFSET = 24;

const STORAGE_KEYS = {
	penColor: "bifourcation.penColor",
	penWidth: "bifourcation.penWidth",
	toolMode: "bifourcation.toolMode",
	selectedShape: "bifourcation.selectedShape",
	bivectorView: "bifourcation.bivectorView",
	soundEnabled: "bifourcation.soundEnabled",
	soundVolume: "bifourcation.soundVolume",
	animationTraceMode: "bifourcation.animationTraceMode",
	visibleTermCount: "bifourcation.visibleTermCount",
} as const;

const ACTIVE_BUTTON_CLASS =
	"flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-50 font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400";

const INACTIVE_BUTTON_CLASS =
	"flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-700 font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent";

type AppMode = "draw" | "animate";
type ToolMode = "draw" | "edit" | "fill";

type DrawingHistory = {
	past: DrawingObject[][];
	present: DrawingObject[];
	future: DrawingObject[][];
};

type ContextMenuState = {
	x: number;
	y: number;
	objectId: string | null;
};

type RgbColor = {
	r: number;
	g: number;
	b: number;
};

function clampNumber(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string) {
	const trimmed = value.trim();

	if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
		return trimmed.toUpperCase();
	}

	if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
		return `#${trimmed.toUpperCase()}`;
	}

	if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
		const [, r, g, b] = trimmed;

		return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}

	if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
		const [r, g, b] = trimmed;

		return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}

	return null;
}

function hexToRgb(hex: string): RgbColor {
	const normalized = normalizeHexColor(hex) ?? DEFAULT_PEN_COLOR;

	return {
		r: Number.parseInt(normalized.slice(1, 3), 16),
		g: Number.parseInt(normalized.slice(3, 5), 16),
		b: Number.parseInt(normalized.slice(5, 7), 16),
	};
}

function rgbToHex({ r, g, b }: RgbColor) {
	const toHex = (value: number) =>
		Math.round(clampNumber(value, 0, 255))
			.toString(16)
			.padStart(2, "0")
			.toUpperCase();

	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isBivectorView(value: string | null): value is BivectorView {
	return value === "blade" || value === "disk" || value === "companion";
}

function isAnimationTraceMode(
	value: string | null,
): value is AnimationTraceMode {
	return value === "sequential" || value === "simultaneous";
}

function isToolMode(value: string | null): value is ToolMode {
	return value === "draw" || value === "edit" || value === "fill";
}

function readStoredValue(key: string) {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function removeStoredValue(key: string) {
	try {
		window.localStorage.removeItem(key);
	} catch {
		// Ignore storage errors, for example private browsing restrictions.
	}
}

function writeStoredValue(key: string, value: string) {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Ignore storage errors, for example private browsing restrictions.
	}
}

function readStoredPenColor() {
	const storedColor = readStoredValue(STORAGE_KEYS.penColor);
	const normalized = storedColor ? normalizeHexColor(storedColor) : null;

	return normalized ?? DEFAULT_PEN_COLOR;
}

function readStoredPenWidth() {
	const storedWidth = Number(readStoredValue(STORAGE_KEYS.penWidth));

	if (!Number.isFinite(storedWidth)) return DEFAULT_PEN_WIDTH;

	return clampNumber(Math.round(storedWidth), 2, 16);
}

function readStoredToolMode(): ToolMode {
	const storedToolMode = readStoredValue(STORAGE_KEYS.toolMode);

	return isToolMode(storedToolMode) ? storedToolMode : "draw";
}

function readStoredSelectedShape(): ShapeKind | null {
	const storedShape = readStoredValue(STORAGE_KEYS.selectedShape);

	if (!storedShape) return null;

	return SHAPE_TOOLS.includes(storedShape as ShapeKind)
		? (storedShape as ShapeKind)
		: null;
}

function readStoredVisibleTermCount() {
	const storedTermCount = Number(
		readStoredValue(STORAGE_KEYS.visibleTermCount),
	);

	if (!Number.isFinite(storedTermCount)) return DEFAULT_VISIBLE_TERM_COUNT;

	return clampNumber(Math.round(storedTermCount), 0, MAX_FOURIER_TERMS);
}

function readStoredBivectorView(): BivectorView {
	const storedView = readStoredValue(STORAGE_KEYS.bivectorView);

	return isBivectorView(storedView) ? storedView : DEFAULT_BIVECTOR_VIEW;
}

function readStoredAnimationTraceMode(): AnimationTraceMode {
	const storedMode = readStoredValue(STORAGE_KEYS.animationTraceMode);

	return isAnimationTraceMode(storedMode)
		? storedMode
		: DEFAULT_ANIMATION_TRACE_MODE;
}

function readStoredSoundVolume() {
	const storedVolume = Number(readStoredValue(STORAGE_KEYS.soundVolume));

	if (!Number.isFinite(storedVolume)) return DEFAULT_SOUND_VOLUME;

	return clampNumber(storedVolume, 0, 1);
}

function ShapeIcon({ kind }: { kind: ShapeKind }) {
	if (kind === "line") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<path
					d="M6 24L26 8"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinecap="round"
				/>
			</svg>
		);
	}

	if (kind === "ellipse") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<ellipse
					cx="16"
					cy="16"
					rx="10"
					ry="7"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
				/>
			</svg>
		);
	}

	if (kind === "rectangle") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<rect
					x="7"
					y="9"
					width="18"
					height="14"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}

	if (kind === "parallelogram") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<path
					d="M10 9H27L22 23H5L10 9Z"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}

	if (kind === "triangle-equilateral") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<path
					d="M16 6L26 24H6L16 6Z"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}

	if (kind === "triangle-isosceles") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<path
					d="M16 5L25 25H7L16 5Z"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}

	if (kind === "triangle-scalene") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<path
					d="M8 25H26L12 6L8 25Z"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}

	if (kind === "star") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<path
					d="M16 5L19 12L26.5 12.5L20.8 17.5L22.6 25L16 21L9.4 25L11.2 17.5L5.5 12.5L13 12L16 5Z"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.1"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}

	if (kind === "spiral") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<path
					d="M17 16C17 18 14 18 14 15.5C14 12.5 18.5 11.8 20.8 14.2C24 17.5 21.8 23.5 16.2 24.2C9.6 25 5.2 18.4 8.5 12.4C11.6 6.9 19.6 5.8 24.8 10"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
				/>
			</svg>
		);
	}

	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
			<path
				d="M4 16C7 8 11 8 16 16C21 24 25 24 28 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function SelectionIcon() {
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
			<rect
				x="7"
				y="7"
				width="18"
				height="18"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeDasharray="4 3"
				strokeLinejoin="round"
			/>
			<path
				d="M19 19L27 27M22 27H27V22"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function BucketIcon() {
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
			<path
				d="M8 17L17 8L26 17L17 26L8 17Z"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinejoin="round"
			/>
			<path
				d="M12 17H22"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinecap="round"
			/>
			<path
				d="M24 25C24 25 27 21.8 27 19.8C27 18.5 25.9 17.8 24 17.8C22.1 17.8 21 18.5 21 19.8C21 21.8 24 25 24 25Z"
				fill="currentColor"
			/>
		</svg>
	);
}

function RotorCountIcon() {
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
			<ellipse
				cx="16"
				cy="16"
				rx="9.5"
				ry="6.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				transform="rotate(-18 16 16)"
			/>
			<path
				d="M8.2 12.8C10.5 8.8 15.7 6.9 20.1 8.6"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<path
				d="M19.4 5.8L23.3 10.1L17.5 10.9"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M23.8 19.2C21.5 23.2 16.3 25.1 11.9 23.4"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<path
				d="M12.6 26.2L8.7 21.9L14.5 21.1"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M16 9.5V22.5M9.5 16H22.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				opacity="0.72"
			/>
		</svg>
	);
}

function ShapeDrawerIcon() {
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
			<rect
				x="7"
				y="9"
				width="18"
				height="14"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.4"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function StrokeWidthIcon() {
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
			<path
				d="M7 10H25"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
			/>
			<path
				d="M7 16H25"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.8"
				strokeLinecap="round"
			/>
			<path
				d="M7 22H25"
				fill="none"
				stroke="currentColor"
				strokeWidth="4.2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function cloneDrawingObject(object: DrawingObject): DrawingObject | null {
	if (object.type === "shape") {
		const id = createId("shape");

		return {
			type: "shape",
			id,
			shape: {
				...object.shape,
				id,
				bounds: {
					...object.shape.bounds,
					x: object.shape.bounds.x + PASTE_OFFSET,
					y: object.shape.bounds.y + PASTE_OFFSET,
				},
			},
		};
	}

	if (object.type === "freehand") {
		return {
			type: "freehand",
			id: createId("freehand"),
			stroke: {
				...object.stroke,
				points: object.stroke.points.map(point => ({
					x: point.x + PASTE_OFFSET,
					y: point.y + PASTE_OFFSET,
				})),
			},
		};
	}

	return null;
}

function App() {
	const canvasStageRef = useRef<HTMLElement | null>(null);
	const soundEngineRef = useRef<DrawingSoundEngine | null>(null);
	const imageInputRef = useRef<HTMLInputElement | null>(null);
	const editSnapshotRef = useRef<DrawingObject[] | null>(null);

	const [clearSignal, setClearSignal] = useState(0);
	const [drawingHistory, setDrawingHistory] = useState<DrawingHistory>({
		past: [],
		present: [],
		future: [],
	});
	const [mode, setMode] = useState<AppMode>("draw");
	const [toolMode, setToolMode] = useState<ToolMode>(readStoredToolMode);
	const [isAnimationPlaying, setIsAnimationPlaying] = useState(false);
	const [isColorDrawerOpen, setIsColorDrawerOpen] = useState(false);
	const [isStrokeDrawerOpen, setIsStrokeDrawerOpen] = useState(false);
	const [isRotorDrawerOpen, setIsRotorDrawerOpen] = useState(false);
	const [isShapeDrawerOpen, setIsShapeDrawerOpen] = useState(false);
	const [isVolumeDrawerOpen, setIsVolumeDrawerOpen] = useState(false);
	const [isSnapshotMenuOpen, setIsSnapshotMenuOpen] = useState(false);
	const [isAnimationStyleMenuOpen, setIsAnimationStyleMenuOpen] =
		useState(false);
	const [bivectorView, setBivectorView] = useState<BivectorView>(
		readStoredBivectorView,
	);
	const [animationTraceMode, setAnimationTraceMode] =
		useState<AnimationTraceMode>(readStoredAnimationTraceMode);
	const [visibleTermCount, setVisibleTermCount] = useState(
		readStoredVisibleTermCount,
	);
	const [soundVolume, setSoundVolume] = useState(readStoredSoundVolume);
	const [isSoundEnabled, setIsSoundEnabled] = useState(() => {
		return readStoredSoundVolume() > 0;
	});
	const [isTracingImage, setIsTracingImage] = useState(false);
	const [imageTraceError, setImageTraceError] = useState<string | null>(null);
	const [selectedShape, setSelectedShape] = useState<ShapeKind | null>(
		readStoredSelectedShape,
	);
	const [selectedObjectId, setSelectedObjectId] = useState<string | null>(
		null,
	);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
		null,
	);
	const [clipboardObject, setClipboardObject] =
		useState<DrawingObject | null>(null);

	const [penColor, setPenColor] = useState(readStoredPenColor);
	const [penWidth, setPenWidth] = useState(readStoredPenWidth);
	const [colorHexDraft, setColorHexDraft] = useState(readStoredPenColor);

	const [animationResetSignal, setAnimationResetSignal] = useState(0);

	const drawingObjects = drawingHistory.present;
	const currentRgb = useMemo(() => hexToRgb(penColor), [penColor]);

	const resampledPointCount = MAX_FOURIER_TERMS;
	const effectiveVisibleTermCount = clampNumber(
		Math.round(visibleTermCount),
		0,
		resampledPointCount,
	);

	const strokes = useMemo(
		() =>
			drawingObjects.flatMap(object => {
				const stroke = drawingObjectToStroke(object);

				return stroke ? [stroke] : [];
			}),
		[drawingObjects],
	);

	const selectedObject = drawingObjects.find(
		object => object.id === selectedObjectId,
	);

	const selectedShapeObject =
		selectedObject?.type === "shape" ? selectedObject.shape : null;

	const pointCount = strokes.reduce(
		(total, stroke) => total + stroke.points.length,
		0,
	);

	const animatedStrokes = useMemo(
		() =>
			strokes.map((stroke, index) => {
				const path = resamplePath(stroke.points, resampledPointCount);
				const terms = path.length > 0 ? computeFourierTerms(path) : [];

				return {
					id: `${index}-${stroke.color}-${stroke.width}-${stroke.points.length}`,
					color: stroke.color,
					width: stroke.width,
					path,
					terms,
				};
			}),
		[strokes, resampledPointCount],
	);

	const hasAnimationData = animatedStrokes.some(
		stroke => stroke.terms.length > 0,
	);

	const totalFourierTerms = animatedStrokes.reduce(
		(total, stroke) => total + stroke.terms.length,
		0,
	);

	const visibleFourierTerms = animatedStrokes.reduce(
		(total, stroke) =>
			total + Math.min(effectiveVisibleTermCount, stroke.terms.length),
		0,
	);

	const totalResampledPoints = animatedStrokes.reduce(
		(total, stroke) => total + stroke.path.length,
		0,
	);

	const isAnimationMode = mode === "animate";
	const isEditMode = mode === "draw" && toolMode === "edit";
	const isFillMode = mode === "draw" && toolMode === "fill";
	const isCanvasInteractive =
		mode === "draw" && toolMode === "draw" && selectedShape === null;
	const canUndo = drawingHistory.past.length > 0;
	const canRedo = drawingHistory.future.length > 0;
	const hasAudibleVolume = soundVolume > 0;
	const hasOpenFloatingDrawer =
		isColorDrawerOpen ||
		isStrokeDrawerOpen ||
		isRotorDrawerOpen ||
		isShapeDrawerOpen ||
		isVolumeDrawerOpen ||
		isSnapshotMenuOpen ||
		isAnimationStyleMenuOpen;
	const canDuplicateSelectedObject =
		selectedObject?.type === "shape" || selectedObject?.type === "freehand";
	const isSelectedObjectShape = selectedObject?.type === "shape";

	function changePenColor(nextColor: string) {
		const normalized = normalizeHexColor(nextColor);

		if (!normalized) return;

		setPenColor(normalized);
		setColorHexDraft(normalized);
	}

	function changeRgbComponent(component: keyof RgbColor, value: number) {
		const nextRgb = {
			...currentRgb,
			[component]: clampNumber(Math.round(value), 0, 255),
		};

		changePenColor(rgbToHex(nextRgb));
	}

	function getSoundEngine() {
		if (!soundEngineRef.current) {
			soundEngineRef.current = new DrawingSoundEngine();
			soundEngineRef.current.setVolume(soundVolume);
		}

		return soundEngineRef.current;
	}

	function changeSoundVolume(nextVolume: number) {
		const normalizedVolume = clampNumber(nextVolume, 0, 1);

		setSoundVolume(normalizedVolume);
		soundEngineRef.current?.setVolume(normalizedVolume);

		if (normalizedVolume <= 0) {
			setIsSoundEnabled(false);
			soundEngineRef.current?.stop();
			soundEngineRef.current?.resetClock();
			return;
		}

		setIsSoundEnabled(true);
	}

	function handleRotorSoundFrame(frame: RotorSoundFrame) {
		if (
			!isSoundEnabled ||
			!hasAudibleVolume ||
			!isAnimationPlaying ||
			!isAnimationMode ||
			frame.strokes.length === 0
		) {
			return;
		}

		getSoundEngine().updateFromRotorFrame(frame);
	}

	function resetAnimationSideEffects() {
		setIsAnimationPlaying(false);
		setMode("draw");
		setIsSnapshotMenuOpen(false);

		soundEngineRef.current?.stop();
		soundEngineRef.current?.resetClock();
	}

	function pauseAnimationClock() {
		setIsAnimationPlaying(false);
		soundEngineRef.current?.stop();
		soundEngineRef.current?.resetClock();
	}

	function commitObjects(update: SetStateAction<DrawingObject[]>) {
		resetAnimationSideEffects();
		setImageTraceError(null);

		setDrawingHistory(currentHistory => {
			const nextObjects =
				typeof update === "function"
					? update(currentHistory.present)
					: update;

			if (nextObjects === currentHistory.present) return currentHistory;

			return {
				past: [...currentHistory.past, currentHistory.present],
				present: nextObjects,
				future: [],
			};
		});
	}

	function replacePresentObjects(update: SetStateAction<DrawingObject[]>) {
		resetAnimationSideEffects();
		setImageTraceError(null);

		setDrawingHistory(currentHistory => {
			const nextObjects =
				typeof update === "function"
					? update(currentHistory.present)
					: update;

			return {
				...currentHistory,
				present: nextObjects,
			};
		});
	}

	function undo() {
		if (!canUndo) return;

		resetAnimationSideEffects();
		setSelectedObjectId(null);
		setContextMenu(null);
		setImageTraceError(null);

		setDrawingHistory(currentHistory => {
			const previous = currentHistory.past.at(-1);

			if (!previous) return currentHistory;

			return {
				past: currentHistory.past.slice(0, -1),
				present: previous,
				future: [currentHistory.present, ...currentHistory.future],
			};
		});
	}

	function redo() {
		if (!canRedo) return;

		resetAnimationSideEffects();
		setSelectedObjectId(null);
		setContextMenu(null);
		setImageTraceError(null);

		setDrawingHistory(currentHistory => {
			const next = currentHistory.future[0];

			if (!next) return currentHistory;

			return {
				past: [...currentHistory.past, currentHistory.present],
				present: next,
				future: currentHistory.future.slice(1),
			};
		});
	}

	function clearEverything() {
		resetAnimationSideEffects();
		setImageTraceError(null);
		setSelectedObjectId(null);
		setContextMenu(null);
		setClearSignal(value => value + 1);

		setDrawingHistory(currentHistory => {
			if (currentHistory.present.length === 0) return currentHistory;

			return {
				past: [...currentHistory.past, currentHistory.present],
				present: [],
				future: [],
			};
		});
	}

	function enterDrawMode() {
		setToolMode("draw");
		setSelectedObjectId(null);
		setContextMenu(null);
		resetAnimationSideEffects();
	}

	function enterEditMode() {
		setMode("draw");
		setToolMode("edit");
		setContextMenu(null);
		pauseAnimationClock();
	}

	function enterFillMode() {
		setMode("draw");
		setToolMode("fill");
		setSelectedObjectId(null);
		setContextMenu(null);
		pauseAnimationClock();
	}

	function selectShapeTool(kind: ShapeKind) {
		setMode("draw");
		setToolMode("draw");
		setSelectedObjectId(null);
		setContextMenu(null);
		pauseAnimationClock();
		setSelectedShape(current => (current === kind ? null : kind));
	}

	async function toggleAnimation() {
		if (!hasAnimationData) return;

		const isStartingAnimation = mode !== "animate" || !isAnimationPlaying;

		if (mode !== "animate") {
			soundEngineRef.current?.resetClock();
		}

		if (isStartingAnimation && hasAudibleVolume) {
			try {
				const engine = getSoundEngine();
				engine.setVolume(soundVolume);
				await engine.enable();
				setIsSoundEnabled(true);
			} catch (error) {
				console.error("Unable to start audio engine.", error);
				setIsSoundEnabled(false);
			}
		}

		setSelectedObjectId(null);
		setContextMenu(null);
		setIsAnimationStyleMenuOpen(false);
		setMode("animate");
		setIsAnimationPlaying(value => !value);
	}

	function changeAnimationTraceMode(nextMode: AnimationTraceMode) {
		setAnimationTraceMode(nextMode);
		setIsAnimationStyleMenuOpen(false);
		pauseAnimationClock();

		if (mode === "animate") {
			setMode("animate");
		}
	}

	function changeVisibleTermCount(nextCount: number) {
		setVisibleTermCount(
			clampNumber(Math.round(nextCount), 0, resampledPointCount),
		);
		pauseAnimationClock();
	}

	function commitStroke(stroke: Stroke) {
		commitObjects(currentObjects => [
			...currentObjects,
			{
				type: "freehand",
				id: createId("freehand"),
				stroke,
			},
		]);
	}

	function commitShape(shape: ShapeObject) {
		commitObjects(currentObjects => [
			...currentObjects,
			{
				type: "shape",
				id: shape.id,
				shape,
			},
		]);

		setSelectedObjectId(shape.id);
		setMode("draw");
		setToolMode("edit");
	}

	function commitBucketFill(fill: BucketFillObject) {
		commitObjects(currentObjects => [
			...currentObjects,
			{
				type: "bucket-fill",
				id: fill.id,
				fill,
			},
		]);
	}

	function beginObjectEdit() {
		if (!editSnapshotRef.current) {
			editSnapshotRef.current = drawingHistory.present;
		}

		pauseAnimationClock();
	}

	function changeShapeObject(
		id: string,
		updater: (shape: ShapeObject) => ShapeObject,
	) {
		replacePresentObjects(currentObjects =>
			currentObjects.map(object => {
				if (object.id !== id || object.type !== "shape") return object;

				return {
					...object,
					shape: updater(object.shape),
				};
			}),
		);
	}

	function endObjectEdit() {
		const snapshot = editSnapshotRef.current;

		if (!snapshot) return;

		setDrawingHistory(currentHistory => ({
			past: [...currentHistory.past, snapshot],
			present: currentHistory.present,
			future: [],
		}));

		editSnapshotRef.current = null;
	}

	function commitSelectedShapeUpdate(
		updater: (shape: ShapeObject) => ShapeObject,
	) {
		if (!selectedObjectId) return;

		commitObjects(currentObjects =>
			currentObjects.map(object => {
				if (object.id !== selectedObjectId || object.type !== "shape") {
					return object;
				}

				return {
					...object,
					shape: updater(object.shape),
				};
			}),
		);
	}

	function deleteSelectedObject() {
		if (!selectedObjectId) return;

		commitObjects(currentObjects =>
			currentObjects.filter(object => object.id !== selectedObjectId),
		);

		setSelectedObjectId(null);
		setContextMenu(null);
	}

	function copySelectedObject() {
		if (!selectedObject) return;

		setClipboardObject(selectedObject);
		setContextMenu(null);
	}

	function duplicateSelectedObject() {
		if (!selectedObject) return;

		const nextObject = cloneDrawingObject(selectedObject);
		if (!nextObject) return;

		commitObjects(currentObjects => [...currentObjects, nextObject]);

		if (nextObject.type === "shape") {
			setSelectedObjectId(nextObject.id);
			setMode("draw");
			setToolMode("edit");
		}

		setContextMenu(null);
	}

	function pasteCopiedObject() {
		if (!clipboardObject) return;

		const nextObject = cloneDrawingObject(clipboardObject);
		if (!nextObject) return;

		commitObjects(currentObjects => [...currentObjects, nextObject]);

		if (nextObject.type === "shape") {
			setSelectedObjectId(nextObject.id);
			setMode("draw");
			setToolMode("edit");
		}

		setContextMenu(null);
	}

	async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";

		if (!file) return;

		const stage = canvasStageRef.current;
		if (!stage) return;

		setIsTracingImage(true);
		setImageTraceError(null);
		setSelectedObjectId(null);
		setContextMenu(null);
		resetAnimationSideEffects();

		try {
			const rect = stage.getBoundingClientRect();

			const tracedStrokes = await traceImageFileToStrokes(file, {
				targetWidth: rect.width,
				targetHeight: rect.height,
				color: penColor,
				width: Math.max(1.5, Math.min(penWidth, 5)),
				maxContours: 96,
				minPoints: 16,
				maxProcessingSize: 720,
			});

			if (tracedStrokes.length === 0) {
				setImageTraceError(
					"No usable edges found. Try a higher-contrast image.",
				);
				return;
			}

			commitObjects(currentObjects => [
				...currentObjects,
				...tracedStrokes.map(stroke => ({
					type: "freehand" as const,
					id: createId("trace"),
					stroke,
				})),
			]);
		} catch (error) {
			console.error("Image tracing failed.", error);
			setImageTraceError("Could not trace that image.");
		} finally {
			setIsTracingImage(false);
		}
	}

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");

		link.href = url;
		link.download = filename;
		link.click();

		URL.revokeObjectURL(url);
	}

	async function createSnapshotBlob(): Promise<Blob | null> {
		const stage = canvasStageRef.current;
		if (!stage) return null;

		const canvases = Array.from(stage.querySelectorAll("canvas"));
		if (canvases.length === 0) return null;

		const rect = stage.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;

		const snapshot = document.createElement("canvas");
		snapshot.width = Math.round(rect.width * dpr);
		snapshot.height = Math.round(rect.height * dpr);

		const ctx = snapshot.getContext("2d");
		if (!ctx) return null;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = "#18181b";
		ctx.fillRect(0, 0, rect.width, rect.height);

		for (const canvas of canvases) {
			const canvasRect = canvas.getBoundingClientRect();

			ctx.globalAlpha = 1;
			ctx.drawImage(
				canvas,
				canvasRect.left - rect.left,
				canvasRect.top - rect.top,
				canvasRect.width,
				canvasRect.height,
			);
		}

		ctx.globalAlpha = 1;

		return new Promise(resolve => {
			snapshot.toBlob(blob => resolve(blob), "image/png");
		});
	}

	async function captureSnapshotAndPause(): Promise<Blob | null> {
		const shouldPauseAfterSnapshot =
			mode === "animate" || isAnimationPlaying;

		const blob = await createSnapshotBlob();
		if (!blob) return null;

		if (shouldPauseAfterSnapshot) {
			setMode("animate");
			setIsAnimationPlaying(false);
		}

		setIsSnapshotMenuOpen(false);

		return blob;
	}

	async function shareSnapshot() {
		const blob = await captureSnapshotAndPause();
		if (!blob) return;

		const filename = "bifourcation-snapshot.png";
		const file = new File([blob], filename, { type: "image/png" });

		const canShareFiles =
			typeof navigator.canShare === "function" &&
			navigator.canShare({ files: [file] }) &&
			typeof navigator.share === "function";

		if (canShareFiles) {
			try {
				await navigator.share({
					title: "Bifourcation",
					text: "Fourier through e₁e₂ rotors.",
					files: [file],
				});

				return;
			} catch {
				// Fall back to download if the share sheet fails or is dismissed.
			}
		}

		downloadBlob(blob, filename);
	}

	async function downloadSnapshot() {
		const blob = await captureSnapshotAndPause();
		if (!blob) return;

		downloadBlob(blob, "bifourcation-snapshot.png");
	}

	function openVideoExportPanel() {
		setIsSnapshotMenuOpen(false);
		setIsVolumeDrawerOpen(false);
		setIsAnimationStyleMenuOpen(false);
		window.dispatchEvent(new CustomEvent("bifourcation:open-video-export"));
	}

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.penColor, penColor);
	}, [penColor]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.penWidth, String(penWidth));
	}, [penWidth]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.toolMode, toolMode);
	}, [toolMode]);

	useEffect(() => {
		if (!selectedShape) {
			removeStoredValue(STORAGE_KEYS.selectedShape);
			return;
		}

		writeStoredValue(STORAGE_KEYS.selectedShape, selectedShape);
	}, [selectedShape]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.bivectorView, bivectorView);
	}, [bivectorView]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.animationTraceMode, animationTraceMode);
	}, [animationTraceMode]);

	useEffect(() => {
		writeStoredValue(
			STORAGE_KEYS.visibleTermCount,
			String(effectiveVisibleTermCount),
		);
	}, [effectiveVisibleTermCount]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.soundVolume, String(soundVolume));
		writeStoredValue(STORAGE_KEYS.soundEnabled, String(soundVolume > 0));
		soundEngineRef.current?.setVolume(soundVolume);
	}, [soundVolume]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			const isTyping =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;

			if (isTyping) return;

			const key = event.key.toLowerCase();
			const usesModifier = event.metaKey || event.ctrlKey;
			const isUndo = usesModifier && !event.shiftKey && key === "z";
			const isRedo =
				usesModifier &&
				((event.shiftKey && key === "z") || key === "y");
			const isCopy = usesModifier && key === "c";
			const isPaste = usesModifier && key === "v";
			const isEscape = key === "escape";

			if (isUndo) {
				event.preventDefault();
				undo();
				return;
			}

			if (isRedo) {
				event.preventDefault();
				redo();
				return;
			}

			if (isCopy && selectedObject) {
				event.preventDefault();
				copySelectedObject();
				return;
			}

			if (isPaste && clipboardObject) {
				event.preventDefault();
				pasteCopiedObject();
				return;
			}

			if (isEscape) {
				event.preventDefault();
				setSelectedShape(null);
				setSelectedObjectId(null);
				setToolMode("draw");
				setContextMenu(null);
				setIsColorDrawerOpen(false);
				setIsStrokeDrawerOpen(false);
				setIsRotorDrawerOpen(false);
				setIsShapeDrawerOpen(false);
				setIsVolumeDrawerOpen(false);
				setIsSnapshotMenuOpen(false);
				setIsAnimationStyleMenuOpen(false);
			}
		}

		window.addEventListener("keydown", handleKeyDown);

		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [canUndo, canRedo, selectedObject, clipboardObject]);

	useEffect(() => {
		function closeContextMenu() {
			setContextMenu(null);
		}

		window.addEventListener("click", closeContextMenu);

		return () => window.removeEventListener("click", closeContextMenu);
	}, []);

	useEffect(() => {
		if (!hasOpenFloatingDrawer) return;

		function handlePointerDown(event: PointerEvent) {
			const target = event.target;

			if (!(target instanceof Element)) return;
			if (target.closest("[data-floating-ui='true']")) return;

			setIsColorDrawerOpen(false);
			setIsStrokeDrawerOpen(false);
			setIsRotorDrawerOpen(false);
			setIsShapeDrawerOpen(false);
			setIsVolumeDrawerOpen(false);
			setIsSnapshotMenuOpen(false);
			setIsAnimationStyleMenuOpen(false);
		}

		window.addEventListener("pointerdown", handlePointerDown);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [hasOpenFloatingDrawer]);

	useEffect(() => {
		const engine = soundEngineRef.current;
		const shouldRunSound =
			isSoundEnabled &&
			hasAudibleVolume &&
			isAnimationPlaying &&
			isAnimationMode &&
			hasAnimationData;

		if (!shouldRunSound) {
			engine?.stop();
			return;
		}

		let isCancelled = false;
		const activeEngine = getSoundEngine();
		activeEngine.setVolume(soundVolume);

		void activeEngine.start().catch(error => {
			if (isCancelled) return;

			console.error("Unable to start audio engine.", error);
			setIsSoundEnabled(false);
		});

		return () => {
			isCancelled = true;
			activeEngine.stop();
		};
	}, [
		isSoundEnabled,
		isAnimationPlaying,
		isAnimationMode,
		hasAnimationData,
		hasAudibleVolume,
		soundVolume,
	]);

	useEffect(() => {
		function handleExportAudioTrackRequest(event: Event) {
			const detail = (
				event as CustomEvent<{
					resolve?: (track: MediaStreamTrack | null) => void;
				}>
			).detail;
			const resolve = detail?.resolve;

			if (typeof resolve !== "function") return;

			if (!hasAudibleVolume) {
				resolve(null);
				return;
			}

			try {
				const engine = getSoundEngine();
				engine.setVolume(soundVolume);
				void engine.enable().catch(error => {
					console.error("Unable to enable audio context for export.", error);
				});
				resolve(engine.getCaptureAudioTrack());
			} catch (error) {
				console.error("Unable to provide audio track for export.", error);
				resolve(null);
			}
		}

		window.addEventListener(
			"bifourcation:export-request-audio-track",
			handleExportAudioTrackRequest,
		);

		return () => {
			window.removeEventListener(
				"bifourcation:export-request-audio-track",
				handleExportAudioTrackRequest,
			);
		};
	}, [hasAudibleVolume, soundVolume]);

	useEffect(() => {
		function handleExportAnimationControl(event: Event) {
			const detail = (event as CustomEvent<{ action?: string }>).detail;

			if (!detail?.action) return;

			if (detail.action === "reset") {
				setMode("animate");
				setToolMode("draw");
				setSelectedObjectId(null);
				setContextMenu(null);
				setIsSnapshotMenuOpen(false);
				setIsAnimationPlaying(false);

				soundEngineRef.current?.stop();
				soundEngineRef.current?.resetClock();

				setAnimationResetSignal(value => value + 1);
				return;
			}

			if (detail.action === "play") {
				if (!hasAnimationData) return;

				setMode("animate");
				setIsAnimationPlaying(true);

				if (hasAudibleVolume && isSoundEnabled) {
					void getSoundEngine().start();
				}

				return;
			}

			if (detail.action === "pause") {
				setIsAnimationPlaying(false);
				soundEngineRef.current?.stop();
				soundEngineRef.current?.resetClock();
			}
		}

		window.addEventListener(
			"bifourcation:export-animation-control",
			handleExportAnimationControl,
		);

		return () => {
			window.removeEventListener(
				"bifourcation:export-animation-control",
				handleExportAnimationControl,
			);
		};
	}, [hasAnimationData, hasAudibleVolume, isSoundEnabled]);

	return (
		<main className="flex h-dvh w-screen overflow-hidden bg-zinc-950 text-zinc-50">
			<section className="flex h-full w-full flex-col">
				<header className="flex flex-col gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
					<div className="flex items-center gap-3">
						<img
							src="/bifourcation_logo.png"
							alt=""
							aria-hidden="true"
							className="h-11 w-11 shrink-0 rounded-xl object-contain"
						/>

						<div>
							<h1 className="text-xl font-semibold tracking-tight">
								Bifourcation
							</h1>
							<p className="text-sm text-zinc-400">
								Draw a shape. Watch rotor-driven Fourier terms
								rebuild it.
							</p>
						</div>
					</div>

					<div className="w-fit rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300">
						Fourier via e₁e₂ Rotors
					</div>
				</header>

				<section
					ref={canvasStageRef}
					className="relative min-h-0 flex-1 overflow-hidden bg-zinc-900"
				>
					<div
						className={[
							"h-full w-full transition-opacity duration-200",
							isCanvasInteractive
								? "pointer-events-auto"
								: "pointer-events-none",
						].join(" ")}
					>
						<DrawingCanvas
							objects={drawingObjects}
							clearSignal={clearSignal}
							penColor={penColor}
							penWidth={penWidth}
							nonFillOpacity={isAnimationMode ? 0.2 : 1}
							isInteractive={isCanvasInteractive}
							onCommitStroke={commitStroke}
						/>
					</div>

					<ShapePlacementCanvas
						selectedShape={
							mode === "draw" &&
							toolMode === "draw" &&
							selectedShape
								? selectedShape
								: null
						}
						color={penColor}
						width={penWidth}
						fill={null}
						onCommitShape={commitShape}
					/>

					<BucketFillCanvas
						enabled={isFillMode}
						objects={drawingObjects}
						color={penColor}
						onCommitFill={commitBucketFill}
					/>

					<ObjectTransformCanvas
						objects={drawingObjects}
						selectedObjectId={selectedObjectId}
						enabled={isEditMode}
						onSelectObject={setSelectedObjectId}
						onRequestExitEdit={enterDrawMode}
						onBeginEdit={beginObjectEdit}
						onChangeShape={changeShapeObject}
						onEndEdit={endObjectEdit}
						onContextMenuRequest={(x, y, objectId) => {
							if (objectId) setSelectedObjectId(objectId);
							setContextMenu({ x, y, objectId });
						}}
					/>

					<RotorCanvas
						strokes={animatedStrokes}
						isActive={isAnimationMode}
						isPlaying={isAnimationPlaying}
						termLimit={effectiveVisibleTermCount}
						bivectorView={bivectorView}
						animationTraceMode={animationTraceMode}
						resetSignal={animationResetSignal}
						onSoundFrame={handleRotorSoundFrame}
					/>

					<input
						ref={imageInputRef}
						className="hidden"
						type="file"
						accept="image/*"
						onChange={handleImageUpload}
					/>

					<div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-2 text-[11px] font-medium text-zinc-100/45 sm:text-xs">
						<span>{drawingObjects.length} objects</span>
						<span>·</span>
						<span>{strokes.length} strokes</span>
						<span>·</span>
						<span>{pointCount} raw</span>
						<span>·</span>
						<span>{totalResampledPoints} sampled</span>
						<span>·</span>
						<span>
							{visibleFourierTerms}/{totalFourierTerms} rotors
						</span>

						{selectedShape &&
							mode === "draw" &&
							toolMode === "draw" && (
								<>
									<span>·</span>
									<span className="text-zinc-100/70">
										{getShapeLabel(selectedShape)} tool
									</span>
								</>
							)}

						{isEditMode && (
							<>
								<span>·</span>
								<span className="text-zinc-100/70">
									edit tool
								</span>
							</>
						)}

						{isFillMode && (
							<>
								<span>·</span>
								<span className="text-zinc-100/70">
									bucket fill
								</span>
							</>
						)}
					</div>

					{selectedShape &&
						mode === "draw" &&
						toolMode === "draw" && (
							<div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-2xl border border-zinc-700/70 bg-zinc-950/70 px-4 py-2 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur">
								Press for start corner. Drag to the opposite
								corner. Release to commit.
							</div>
						)}

					{isEditMode && (
						<div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-2xl border border-zinc-700/70 bg-zinc-950/70 px-4 py-2 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur">
							Select a shape. Drag to move. Use handles to scale
							or rotate.
						</div>
					)}

					{isFillMode && (
						<div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-2xl border border-zinc-700/70 bg-zinc-950/70 px-4 py-2 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur">
							Click anywhere to flood fill until a drawn boundary
							or canvas edge.
						</div>
					)}

					{mode === "draw" && toolMode === "edit" && selectedObject && (
						<div className="absolute bottom-20 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 gap-2 overflow-x-auto rounded-2xl border border-zinc-700/70 bg-zinc-950/80 p-2 shadow-lg backdrop-blur">
							<button
								className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
								onClick={duplicateSelectedObject}
								disabled={!canDuplicateSelectedObject}
							>
								Duplicate
							</button>

							<button
								className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
								onClick={copySelectedObject}
								disabled={!selectedObject}
							>
								Copy
							</button>

							<button
								className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
								onClick={pasteCopiedObject}
								disabled={!clipboardObject}
							>
								Paste
							</button>

							<button
								className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
								onClick={() =>
									commitSelectedShapeUpdate(
										flipShapeHorizontal,
									)
								}
								disabled={!isSelectedObjectShape}
							>
								Flip H
							</button>

							<button
								className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
								onClick={() =>
									commitSelectedShapeUpdate(flipShapeVertical)
								}
								disabled={!isSelectedObjectShape}
							>
								Flip V
							</button>

							<button
								className="shrink-0 rounded-xl border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-40"
								onClick={deleteSelectedObject}
								disabled={!selectedObject}
							>
								Delete
							</button>
						</div>
					)}

					{isAnimationMode && (
						<div className="absolute bottom-3 left-3 z-30 flex overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-1 text-xs font-semibold shadow-lg backdrop-blur">
							{(["blade", "disk", "companion"] as const).map(
								view => (
									<button
										key={view}
										className={[
											"rounded-xl px-3 py-2 capitalize transition",
											bivectorView === view
												? "bg-zinc-50 text-zinc-950"
												: "text-zinc-300 hover:bg-zinc-800/80",
										].join(" ")}
										onClick={() => setBivectorView(view)}
									>
										{view}
									</button>
								),
							)}
						</div>
					)}

					<button
						data-floating-ui="true"
						className="absolute right-3 top-[7.25rem] z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 shadow-lg backdrop-blur transition hover:bg-zinc-900/90"
						onClick={() => {
							setIsColorDrawerOpen(value => !value);
							setIsStrokeDrawerOpen(false);
							setIsRotorDrawerOpen(false);
							setIsShapeDrawerOpen(false);
							setIsVolumeDrawerOpen(false);
							setIsAnimationStyleMenuOpen(false);
						}}
						aria-label={
							isColorDrawerOpen
								? "Close color drawer"
								: "Open color drawer"
						}
						title="Color"
					>
						<span
							className="h-6 w-6 rounded-full border-2 border-zinc-100 shadow-inner"
							style={{ backgroundColor: penColor }}
						/>
					</button>

					<button
						data-floating-ui="true"
						className="absolute right-3 top-[10.5rem] z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90"
						onClick={() => {
							setIsStrokeDrawerOpen(value => !value);
							setIsColorDrawerOpen(false);
							setIsRotorDrawerOpen(false);
							setIsShapeDrawerOpen(false);
							setIsVolumeDrawerOpen(false);
							setIsAnimationStyleMenuOpen(false);
						}}
						aria-label={
							isStrokeDrawerOpen
								? "Close stroke width drawer"
								: "Open stroke width drawer"
						}
						title="Stroke width"
					>
						<StrokeWidthIcon />
					</button>

					<button
						data-floating-ui="true"
						className="absolute right-3 top-3 z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90"
						onClick={() => {
							setIsRotorDrawerOpen(value => !value);
							setIsColorDrawerOpen(false);
							setIsStrokeDrawerOpen(false);
							setIsShapeDrawerOpen(false);
							setIsVolumeDrawerOpen(false);
							setIsAnimationStyleMenuOpen(false);
						}}
						aria-label={
							isRotorDrawerOpen
								? "Close rotor drawer"
								: "Open rotor drawer"
						}
						title="Fourier rotors"
					>
						<RotorCountIcon />
					</button>

					<button
						data-floating-ui="true"
						className="absolute right-3 top-16 z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90"
						onClick={() => {
							setIsShapeDrawerOpen(value => !value);
							setIsColorDrawerOpen(false);
							setIsStrokeDrawerOpen(false);
							setIsRotorDrawerOpen(false);
							setIsVolumeDrawerOpen(false);
							setIsAnimationStyleMenuOpen(false);
						}}
						aria-label={
							isShapeDrawerOpen
								? "Close shape drawer"
								: "Open shape drawer"
						}
						title="Shapes"
					>
						<ShapeDrawerIcon />
					</button>

					{contextMenu && (
						<div
							className="fixed z-50 w-40 overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-950/95 text-sm font-medium text-zinc-100 shadow-2xl backdrop-blur"
							style={{
								left: contextMenu.x,
								top: contextMenu.y,
							}}
							onClick={event => event.stopPropagation()}
						>
							<button
								className="block w-full px-4 py-3 text-left transition hover:bg-zinc-800"
								onClick={copySelectedObject}
								disabled={!selectedObject}
							>
								Copy
							</button>

							<button
								className="block w-full border-t border-zinc-800 px-4 py-3 text-left transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
								onClick={pasteCopiedObject}
								disabled={!clipboardObject}
							>
								Paste
							</button>

							<button
								className="block w-full border-t border-zinc-800 px-4 py-3 text-left text-red-200 transition hover:bg-red-950/50 disabled:cursor-not-allowed disabled:text-zinc-600"
								onClick={deleteSelectedObject}
								disabled={!selectedObject}
							>
								Delete
							</button>
						</div>
					)}

					<div
						data-floating-ui="true"
						className={[
							"absolute right-[4.5rem] top-[10.25rem] z-40 max-h-[calc(100%-11rem)] w-[calc(100vw-6rem)] max-w-72 overflow-y-auto transition-all duration-200",
							isStrokeDrawerOpen
								? "translate-x-0 opacity-100"
								: "pointer-events-none translate-x-[calc(100%+1rem)] opacity-0",
						].join(" ")}
					>
						<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/80 p-3 shadow-lg backdrop-blur">
							<div className="mb-3 flex items-center justify-between">
								<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Stroke width
								</p>

								<span className="text-sm font-medium text-zinc-200">
									{penWidth}px
								</span>
							</div>

							<input
								className="w-full accent-zinc-50"
								type="range"
								min={2}
								max={16}
								step={1}
								value={penWidth}
								onChange={event =>
									setPenWidth(Number(event.target.value))
								}
							/>

							<p className="mt-3 text-xs leading-5 text-zinc-500">
								Applies to freehand strokes, shape outlines,
								and imported image traces.
							</p>
						</section>
					</div>

					<div
						data-floating-ui="true"
						className={[
							"absolute right-[4.5rem] top-[10.25rem] z-40 max-h-[calc(100%-11rem)] w-[calc(100vw-6rem)] max-w-80 overflow-y-auto transition-all duration-200",
							isColorDrawerOpen
								? "translate-x-0 opacity-100"
								: "pointer-events-none translate-x-[calc(100%+1rem)] opacity-0",
						].join(" ")}
					>
						<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/80 p-3 shadow-lg backdrop-blur">
							<div className="mb-3 flex items-center justify-between">
								<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Color
								</p>

								<span
									className="h-8 w-8 rounded-full border-2 border-zinc-100"
									style={{ backgroundColor: penColor }}
								/>
							</div>

							<div className="grid grid-cols-8 gap-1.5 min-[430px]:grid-cols-10">
								{MS_PAINT_COLORS.map(color => (
									<button
										key={color}
										className="aspect-square min-w-0 rounded-md border-2 transition hover:scale-105"
										style={{
											backgroundColor: color,
											borderColor:
												color === penColor
													? "#f4f4f5"
													: "rgba(63, 63, 70, 0.7)",
										}}
										onClick={() => changePenColor(color)}
										aria-label={`Select color ${color}`}
										title={color}
									/>
								))}
							</div>

							<div className="mt-4 space-y-3">
								<label className="block min-w-0">
									<span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
										Spectrum
									</span>

									<input
										className="block h-10 w-full min-w-0 max-w-full cursor-pointer rounded-xl border border-zinc-700 bg-zinc-900 p-1"
										type="color"
										value={penColor}
										onChange={event =>
											changePenColor(event.target.value)
										}
										aria-label="Choose color from spectrum"
									/>
								</label>

								<label className="block min-w-0">
									<span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
										Hex
									</span>

									<input
										className="block w-full min-w-0 max-w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none transition focus:border-zinc-300"
										value={colorHexDraft}
										onChange={event => {
											const nextValue =
												event.target.value;
											setColorHexDraft(nextValue);

											const normalized =
												normalizeHexColor(nextValue);
											if (normalized) {
												changePenColor(normalized);
											}
										}}
										onBlur={() =>
											setColorHexDraft(penColor)
										}
										placeholder="#E84D3D"
										spellCheck={false}
									/>
								</label>
							</div>

							<div className="mt-3 grid grid-cols-3 gap-2">
								<label className="block min-w-0">
									<span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
										R
									</span>
									<input
										className="block w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-300"
										type="number"
										min={0}
										max={255}
										value={currentRgb.r}
										onChange={event =>
											changeRgbComponent(
												"r",
												Number(event.target.value),
											)
										}
									/>
								</label>

								<label className="block min-w-0">
									<span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
										G
									</span>
									<input
										className="block w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-300"
										type="number"
										min={0}
										max={255}
										value={currentRgb.g}
										onChange={event =>
											changeRgbComponent(
												"g",
												Number(event.target.value),
											)
										}
									/>
								</label>

								<label className="block min-w-0">
									<span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
										B
									</span>
									<input
										className="block w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-300"
										type="number"
										min={0}
										max={255}
										value={currentRgb.b}
										onChange={event =>
											changeRgbComponent(
												"b",
												Number(event.target.value),
											)
										}
									/>
								</label>
							</div>
						</section>
					</div>

					<div
						data-floating-ui="true"
						className={[
							"absolute right-[4.5rem] top-[10.25rem] z-40 max-h-[calc(100%-11rem)] w-[calc(100vw-6rem)] max-w-80 overflow-y-auto transition-all duration-200",
							isShapeDrawerOpen
								? "translate-x-0 opacity-100"
								: "pointer-events-none translate-x-[calc(100%+1rem)] opacity-0",
						].join(" ")}
					>
						<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/80 p-3 shadow-lg backdrop-blur">
							<div className="mb-3 flex items-center justify-between gap-3">
								<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Shapes
								</p>

								{selectedShape && (
									<button
										className="text-xs font-semibold text-zinc-300 transition hover:text-zinc-50"
										onClick={() => setSelectedShape(null)}
									>
										Freehand
									</button>
								)}
							</div>

							<div className="grid grid-cols-5 gap-2">
								{SHAPE_TOOLS.map(kind => (
									<button
										key={kind}
										className={[
											"flex aspect-square items-center justify-center rounded-xl border transition",
											selectedShape === kind &&
											toolMode === "draw"
												? "border-zinc-50 bg-zinc-50 text-zinc-950"
												: "border-zinc-700 text-zinc-100 hover:bg-zinc-800",
										].join(" ")}
										onClick={() => selectShapeTool(kind)}
										aria-label={`Select ${getShapeLabel(kind)} tool`}
										title={getShapeLabel(kind)}
									>
										<ShapeIcon kind={kind} />
									</button>
								))}
							</div>

							{selectedShapeObject && (
								<section className="mt-3 rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3">
									<p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
										Selected shape
									</p>

									<p className="mb-3 text-sm font-semibold text-zinc-100">
										{getShapeLabel(selectedShapeObject.kind)}
									</p>

									<div className="grid grid-cols-2 gap-2">
										<button
											className="rounded-xl border border-zinc-700 px-3 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800"
											onClick={() =>
												commitSelectedShapeUpdate(
													flipShapeHorizontal,
												)
											}
										>
											Flip H
										</button>

										<button
											className="rounded-xl border border-zinc-700 px-3 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800"
											onClick={() =>
												commitSelectedShapeUpdate(
													flipShapeVertical,
												)
											}
										>
											Flip V
										</button>

										<button
											className="col-span-2 rounded-xl border border-red-900/70 px-3 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-950/50"
											onClick={deleteSelectedObject}
										>
											Delete
										</button>
									</div>
								</section>
							)}
						</section>
					</div>

					<div
						data-floating-ui="true"
						className={[
							"absolute right-[4.5rem] top-[10.25rem] z-40 max-h-[calc(100%-11rem)] w-[calc(100vw-6rem)] max-w-80 overflow-y-auto transition-all duration-200",
							isRotorDrawerOpen
								? "translate-x-0 opacity-100"
								: "pointer-events-none translate-x-[calc(100%+1rem)] opacity-0",
						].join(" ")}
					>
						<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/80 p-3 shadow-lg backdrop-blur">
							<div className="mb-3 flex items-center justify-between">
								<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Fourier rotors
								</p>

								<span className="text-sm font-medium text-zinc-200">
									{effectiveVisibleTermCount}
								</span>
							</div>

							<div className="mb-4 flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/70 py-5 text-zinc-100">
								<RotorCountIcon />
							</div>

							<input
								className="w-full accent-zinc-50"
								type="range"
								min={0}
								max={resampledPointCount}
								step={1}
								value={effectiveVisibleTermCount}
								onChange={event =>
									changeVisibleTermCount(
										Number(event.target.value),
									)
								}
							/>

							<div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
								<span>0</span>
								<span>128</span>
								<span>256</span>
							</div>

							<label className="mt-4 block min-w-0">
								<span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Exact count
								</span>

								<input
									className="block w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-300"
									type="number"
									min={0}
									max={resampledPointCount}
									step={1}
									value={effectiveVisibleTermCount}
									onChange={event =>
										changeVisibleTermCount(
											Number(event.target.value),
										)
									}
								/>
							</label>

							<p className="mt-3 text-xs leading-5 text-zinc-500">
								Each visible term is a coefficient carried by an
								e₁e₂ rotor. Zero hides the reconstruction; fewer
								rotors show the broad form; more rotors recover
								sharper detail. Sound uses the same visible
								rotors.
							</p>

							<section className="mt-4 rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 text-sm text-zinc-300">
								<p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Rotor plane
								</p>

								<div className="space-y-2 leading-5 text-zinc-400">
									<p>
										<span className="text-zinc-100">
											e₁
										</span>{" "}
										is horizontal.
										<br />
										<span className="text-zinc-100">
											e₂
										</span>{" "}
										is vertical.
									</p>

									<p>
										<span className="text-zinc-100">
											e₁e₂
										</span>{" "}
										is the oriented drawing plane.
									</p>

									<p className="font-mono text-[11px] leading-5 text-zinc-300">
										Rₖ(t) = cos(2πkt) + e₁e₂sin(2πkt)
									</p>

									<p className="font-mono text-[11px] leading-5 text-zinc-300">
										termₖ = cₖRₖ(t)
									</p>
								</div>
							</section>
						</section>
					</div>

					<div className="absolute bottom-16 left-3 z-30 flex gap-2">
						<button
							className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90 disabled:cursor-not-allowed disabled:opacity-40"
							onClick={undo}
							disabled={!canUndo}
							aria-label="Undo"
							title="Undo"
						>
							<Undo2 size={18} />
						</button>

						<button
							className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90 disabled:cursor-not-allowed disabled:opacity-40"
							onClick={redo}
							disabled={!canRedo}
							aria-label="Redo"
							title="Redo"
						>
							<Redo2 size={18} />
						</button>
					</div>

					<button
						data-floating-ui="true"
						className={[
							"absolute bottom-3 right-[7.25rem] z-30 flex h-11 w-11 items-center justify-center rounded-2xl border shadow-lg backdrop-blur transition",
							hasAudibleVolume
								? "border-zinc-100 bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
								: "border-zinc-700/70 bg-zinc-950/70 text-zinc-100 hover:bg-zinc-900/90",
						].join(" ")}
						onClick={() => {
							setIsVolumeDrawerOpen(value => !value);
							setIsColorDrawerOpen(false);
							setIsStrokeDrawerOpen(false);
							setIsRotorDrawerOpen(false);
							setIsShapeDrawerOpen(false);
							setIsSnapshotMenuOpen(false);
							setIsAnimationStyleMenuOpen(false);
						}}
						aria-label={
							isVolumeDrawerOpen
								? "Close volume drawer"
								: "Open volume drawer"
						}
						title="Volume"
					>
						{hasAudibleVolume ? (
							<Volume2 size={18} />
						) : (
							<VolumeX size={18} />
						)}
					</button>

					{isVolumeDrawerOpen && (
						<div
							data-floating-ui="true"
							className="absolute bottom-16 right-[6.6rem] z-30 rounded-2xl border border-zinc-700/70 bg-zinc-950/80 px-3 py-3 shadow-lg backdrop-blur"
						>
							<div className="mb-2 text-center text-xs font-semibold text-zinc-200">
								{Math.round(soundVolume * 100)}%
							</div>

							<div className="flex h-28 items-center justify-center">
								<input
									className="w-24 -rotate-90 accent-zinc-50"
									type="range"
									min={0}
									max={100}
									step={1}
									value={Math.round(soundVolume * 100)}
									onChange={event =>
										changeSoundVolume(
											Number(event.target.value) / 100,
										)
									}
								/>
							</div>
						</div>
					)}

					<button
						data-floating-ui="true"
						className="absolute bottom-3 right-16 z-30 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90 disabled:cursor-not-allowed disabled:opacity-40"
						onClick={() => imageInputRef.current?.click()}
						disabled={isTracingImage}
						aria-label="Import image"
						title="Import image"
					>
						<Upload size={18} />
					</button>

					<button
						data-floating-ui="true"
						className="absolute bottom-3 right-3 z-30 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90 disabled:cursor-not-allowed disabled:opacity-40"
						onClick={() => {
							setIsSnapshotMenuOpen(value => !value);
							setIsVolumeDrawerOpen(false);
							setIsAnimationStyleMenuOpen(false);
						}}
						disabled={drawingObjects.length === 0}
						aria-label="Open snapshot menu"
						title="Snapshot"
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							className="h-5 w-5"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M14.5 4.5 13 3h-2L9.5 4.5h-3A2.5 2.5 0 0 0 4 7v10.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5h-3Z" />
							<circle cx="12" cy="12.5" r="3.5" />
						</svg>
					</button>

					{isSnapshotMenuOpen && drawingObjects.length > 0 && (
						<div
							data-floating-ui="true"
							className="absolute bottom-16 right-3 z-30 w-44 overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-950/80 shadow-lg backdrop-blur"
						>
							<button
								className="block w-full px-4 py-3 text-left text-sm font-medium text-zinc-100 transition hover:bg-zinc-800/80"
								onClick={openVideoExportPanel}
							>
								Export MP4
							</button>

							<button
								className="block w-full border-t border-zinc-800 px-4 py-3 text-left text-sm font-medium text-zinc-100 transition hover:bg-zinc-800/80"
								onClick={shareSnapshot}
							>
								Share snapshot
							</button>

							<button
								className="block w-full border-t border-zinc-800 px-4 py-3 text-left text-sm font-medium text-zinc-100 transition hover:bg-zinc-800/80"
								onClick={downloadSnapshot}
							>
								Download PNG
							</button>
						</div>
					)}

					{imageTraceError && !isSnapshotMenuOpen && (
						<p className="absolute bottom-16 right-3 z-30 max-w-72 rounded-xl border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs leading-5 text-red-200 shadow-lg">
							{imageTraceError}
						</p>
					)}
				</section>

				<aside className="border-t border-zinc-800 bg-zinc-950 p-3">
					<div className="flex items-center justify-center gap-3 overflow-visible">
						<button
							className={
								mode === "draw" && toolMode === "draw"
									? ACTIVE_BUTTON_CLASS
									: INACTIVE_BUTTON_CLASS
							}
							onClick={() => {
								setIsAnimationStyleMenuOpen(false);
								enterDrawMode();
							}}
							aria-label="Draw"
							title="Draw"
						>
							<Pencil size={19} />
						</button>

						<button
							className={
								mode === "draw" && toolMode === "edit"
									? ACTIVE_BUTTON_CLASS
									: INACTIVE_BUTTON_CLASS
							}
							onClick={() => {
								setIsAnimationStyleMenuOpen(false);
								enterEditMode();
							}}
							aria-label="Edit"
							title="Edit"
						>
							<SelectionIcon />
						</button>

						<button
							className={
								mode === "draw" && toolMode === "fill"
									? ACTIVE_BUTTON_CLASS
									: INACTIVE_BUTTON_CLASS
							}
							onClick={() => {
								setIsAnimationStyleMenuOpen(false);
								enterFillMode();
							}}
							aria-label="Fill"
							title="Fill"
						>
							<BucketIcon />
						</button>

						<div className="relative shrink-0" data-floating-ui="true">
							<div
								className={[
									"flex h-12 w-12 overflow-hidden rounded-xl border transition",
									isAnimationMode
										? "border-zinc-50 bg-zinc-50 text-zinc-950"
										: "border-zinc-700 text-zinc-200",
									!hasAnimationData
										? "opacity-40"
										: "",
								].join(" ")}
							>
								<button
									className={[
										"flex flex-[4] items-center justify-center transition",
										isAnimationMode
											? "hover:bg-zinc-200"
											: "hover:bg-zinc-800",
										!hasAnimationData
											? "cursor-not-allowed"
											: "",
									].join(" ")}
									disabled={!hasAnimationData}
									onClick={toggleAnimation}
									aria-label={
										isAnimationPlaying ? "Pause" : "Animate"
									}
									title={isAnimationPlaying ? "Pause" : "Animate"}
								>
									{isAnimationPlaying ? (
										<Pause size={19} />
									) : (
										<Play size={19} />
									)}
								</button>

								<button
									className={[
										"flex min-w-[0.9rem] flex-[1] items-center justify-center border-l transition",
										isAnimationMode
											? "border-zinc-300 hover:bg-zinc-200"
											: "border-zinc-700 hover:bg-zinc-800",
										!hasAnimationData
											? "cursor-not-allowed"
											: "",
									].join(" ")}
									onClick={() =>
										setIsAnimationStyleMenuOpen(value => !value)
									}
									disabled={!hasAnimationData}
									aria-label={
										isAnimationStyleMenuOpen
											? "Close animation style options"
											: "Open animation style options"
									}
									title="Animation style"
								>
									<ChevronUp
										size={10}
										className={
											isAnimationStyleMenuOpen
												? "rotate-180 transition-transform"
												: "transition-transform"
										}
									/>
								</button>
							</div>

							{isAnimationStyleMenuOpen && (
								<div
									data-floating-ui="true"
									className="absolute bottom-full right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-950/95 shadow-lg backdrop-blur"
								>
									{(
										["sequential", "simultaneous"] as const
									).map(traceMode => (
										<button
											key={traceMode}
											className={[
												"block min-w-32 px-4 py-3 text-left text-sm font-semibold transition",
												animationTraceMode === traceMode
													? "bg-zinc-50 text-zinc-950"
													: "text-zinc-100 hover:bg-zinc-800/80",
											].join(" ")}
											onClick={() =>
												changeAnimationTraceMode(traceMode)
											}
										>
											{traceMode === "sequential"
												? "Sequential"
												: "Parallel"}
										</button>
									))}
								</div>
							)}
						</div>

						<button
							className={INACTIVE_BUTTON_CLASS}
							onClick={() => {
								setIsAnimationStyleMenuOpen(false);
								clearEverything();
							}}
							aria-label="Clear canvas"
							title="Clear canvas"
						>
							<Trash2 size={19} />
						</button>
					</div>
				</aside>
			</section>
		</main>
	);
}

export default App;
