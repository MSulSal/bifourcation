import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type SetStateAction,
} from "react";
import { Settings } from "lucide-react";
import { DrawingSoundEngine, type SonicStroke } from "./audio/soundEngine";
import { DrawingCanvas } from "./components/DrawingCanvas";
import {
	RotorCanvas,
	type AnimationTraceMode,
	type BivectorView,
} from "./components/RotorCanvas";
import { ShapePlacementCanvas } from "./components/ShapePlacementCanvas";
import { traceImageFileToStrokes } from "./image/edgeTracing";
import { computeFourierTerms } from "./math/fourier";
import { resamplePath } from "./math/path";
import type { ShapeKind } from "./math/shapes";
import type { Stroke } from "./types/geometry";

const PEN_COLORS = [
	"#e84d3d",
	"#2f80ed",
	"#27ae60",
	"#f2c94c",
	"#9b51e0",
	"#f2994a",
	"#56ccf2",
	"#eb5757",
];

const SHAPE_TOOLS: ShapeKind[] = [
	"line",
	"circle",
	"rectangle",
	"triangle",
	"star",
	"spiral",
	"sine",
];

const DEFAULT_PEN_COLOR = PEN_COLORS[0];
const DEFAULT_PEN_WIDTH = 4;
const DEFAULT_BIVECTOR_VIEW: BivectorView = "disk";
const DEFAULT_ANIMATION_TRACE_MODE: AnimationTraceMode = "sequential";

const STORAGE_KEYS = {
	penColor: "bifourcation.penColor",
	penWidth: "bifourcation.penWidth",
	bivectorView: "bifourcation.bivectorView",
	soundEnabled: "bifourcation.soundEnabled",
	animationTraceMode: "bifourcation.animationTraceMode",
} as const;

const ACTIVE_BUTTON_CLASS =
	"shrink-0 rounded-xl bg-zinc-50 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400";

const INACTIVE_BUTTON_CLASS =
	"shrink-0 rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent";

type AppMode = "draw" | "animate";

type DrawingHistory = {
	past: Stroke[][];
	present: Stroke[];
	future: Stroke[][];
};

function clampNumber(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function isBivectorView(value: string | null): value is BivectorView {
	return value === "blade" || value === "disk" || value === "companion";
}

function isAnimationTraceMode(
	value: string | null,
): value is AnimationTraceMode {
	return value === "sequential" || value === "simultaneous";
}

function readStoredValue(key: string) {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
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

	return storedColor && PEN_COLORS.includes(storedColor)
		? storedColor
		: DEFAULT_PEN_COLOR;
}

function readStoredPenWidth() {
	const storedWidth = Number(readStoredValue(STORAGE_KEYS.penWidth));

	if (!Number.isFinite(storedWidth)) return DEFAULT_PEN_WIDTH;

	return clampNumber(Math.round(storedWidth), 2, 16);
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

function readStoredSoundEnabled() {
	return readStoredValue(STORAGE_KEYS.soundEnabled) === "true";
}

function ShapeIcon({ kind }: { kind: ShapeKind }) {
	if (kind === "line") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<path
					d="M6 23L26 9"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinecap="round"
				/>
			</svg>
		);
	}

	if (kind === "circle") {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
				<circle
					cx="16"
					cy="16"
					r="9"
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

	if (kind === "triangle") {
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

function getShapeLabel(kind: ShapeKind) {
	if (kind === "line") return "Line";
	if (kind === "circle") return "Circle";
	if (kind === "rectangle") return "Rectangle";
	if (kind === "triangle") return "Triangle";
	if (kind === "star") return "Star";
	if (kind === "spiral") return "Spiral";

	return "Sine wave";
}

function App() {
	const canvasStageRef = useRef<HTMLElement | null>(null);
	const soundEngineRef = useRef<DrawingSoundEngine | null>(null);
	const soundFrameRef = useRef<number | null>(null);
	const imageInputRef = useRef<HTMLInputElement | null>(null);

	const [clearSignal, setClearSignal] = useState(0);
	const [drawingHistory, setDrawingHistory] = useState<DrawingHistory>({
		past: [],
		present: [],
		future: [],
	});
	const [mode, setMode] = useState<AppMode>("draw");
	const [isAnimationPlaying, setIsAnimationPlaying] = useState(false);
	const [isDrawerOpen, setIsDrawerOpen] = useState(false);
	const [isSnapshotMenuOpen, setIsSnapshotMenuOpen] = useState(false);
	const [bivectorView, setBivectorView] = useState<BivectorView>(
		readStoredBivectorView,
	);
	const [animationTraceMode, setAnimationTraceMode] =
		useState<AnimationTraceMode>(readStoredAnimationTraceMode);
	const [isSoundEnabled, setIsSoundEnabled] = useState(
		readStoredSoundEnabled,
	);
	const [isTracingImage, setIsTracingImage] = useState(false);
	const [imageTraceError, setImageTraceError] = useState<string | null>(null);
	const [selectedShape, setSelectedShape] = useState<ShapeKind | null>(null);

	const [penColor, setPenColor] = useState(readStoredPenColor);
	const [penWidth, setPenWidth] = useState(readStoredPenWidth);

	const strokes = drawingHistory.present;
	const resampledPointCount = 256;
	const visibleTermCount = resampledPointCount;

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
		[strokes],
	);

	const sonicStrokes: SonicStroke[] = useMemo(
		() =>
			animatedStrokes.map(stroke => ({
				id: stroke.id,
				color: stroke.color,
				width: stroke.width,
				path: stroke.path,
				terms: stroke.terms,
			})),
		[animatedStrokes],
	);

	const hasAnimationData = animatedStrokes.some(
		stroke => stroke.terms.length > 0,
	);

	const totalFourierTerms = animatedStrokes.reduce(
		(total, stroke) => total + stroke.terms.length,
		0,
	);

	const totalResampledPoints = animatedStrokes.reduce(
		(total, stroke) => total + stroke.path.length,
		0,
	);

	const isAnimationMode = mode === "animate";
	const isCanvasInteractive = mode === "draw" && selectedShape === null;
	const canUndo = drawingHistory.past.length > 0;
	const canRedo = drawingHistory.future.length > 0;

	function getSoundEngine() {
		if (!soundEngineRef.current) {
			soundEngineRef.current = new DrawingSoundEngine();
		}

		return soundEngineRef.current;
	}

	function stopSoundFrame() {
		if (soundFrameRef.current !== null) {
			cancelAnimationFrame(soundFrameRef.current);
			soundFrameRef.current = null;
		}
	}

	function resetAnimationSideEffects() {
		setIsAnimationPlaying(false);
		setMode("draw");
		setIsSnapshotMenuOpen(false);

		stopSoundFrame();
		soundEngineRef.current?.stop();
		soundEngineRef.current?.resetClock();
	}

	function pauseAnimationClock() {
		setIsAnimationPlaying(false);
		stopSoundFrame();
		soundEngineRef.current?.stop();
		soundEngineRef.current?.resetClock();
	}

	function commitStrokes(update: SetStateAction<Stroke[]>) {
		resetAnimationSideEffects();
		setImageTraceError(null);

		setDrawingHistory(currentHistory => {
			const nextStrokes =
				typeof update === "function"
					? update(currentHistory.present)
					: update;

			if (nextStrokes === currentHistory.present) return currentHistory;

			return {
				past: [...currentHistory.past, currentHistory.present],
				present: nextStrokes,
				future: [],
			};
		});
	}

	function undo() {
		if (!canUndo) return;

		resetAnimationSideEffects();
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
		setSelectedShape(null);
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
		setSelectedShape(null);
		resetAnimationSideEffects();
	}

	async function toggleAnimation() {
		if (!hasAnimationData) return;

		const isStartingAnimation = mode !== "animate" || !isAnimationPlaying;

		if (mode !== "animate") {
			soundEngineRef.current?.resetClock();
		}

		if (isStartingAnimation && isSoundEnabled) {
			try {
				const engine = getSoundEngine();
				await engine.enable();
			} catch (error) {
				console.error("Unable to start audio engine.", error);
				setIsSoundEnabled(false);
			}
		}

		setSelectedShape(null);
		setMode("animate");
		setIsAnimationPlaying(value => !value);
	}

	async function toggleSound() {
		if (isSoundEnabled) {
			setIsSoundEnabled(false);
			stopSoundFrame();
			soundEngineRef.current?.stop();
			return;
		}

		try {
			const engine = getSoundEngine();
			await engine.enable();
			setIsSoundEnabled(true);
		} catch (error) {
			console.error("Unable to start audio engine.", error);
			setIsSoundEnabled(false);
		}
	}

	function changeAnimationTraceMode(nextMode: AnimationTraceMode) {
		setAnimationTraceMode(nextMode);
		pauseAnimationClock();

		if (mode === "animate") {
			setMode("animate");
		}
	}

	function commitShape(stroke: Stroke) {
		commitStrokes(currentStrokes => [...currentStrokes, stroke]);
	}

	async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";

		if (!file) return;

		const stage = canvasStageRef.current;
		if (!stage) return;

		setIsTracingImage(true);
		setImageTraceError(null);
		setSelectedShape(null);
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

			commitStrokes(currentStrokes => [
				...currentStrokes,
				...tracedStrokes,
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

		for (const [index, canvas] of canvases.entries()) {
			const canvasRect = canvas.getBoundingClientRect();

			ctx.globalAlpha = index === 0 && isAnimationMode ? 0.2 : 1;
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

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.penColor, penColor);
	}, [penColor]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.penWidth, String(penWidth));
	}, [penWidth]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.bivectorView, bivectorView);
	}, [bivectorView]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.animationTraceMode, animationTraceMode);
	}, [animationTraceMode]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.soundEnabled, String(isSoundEnabled));
	}, [isSoundEnabled]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			const isTyping =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;

			if (isTyping) return;

			const key = event.key.toLowerCase();
			const isUndo =
				(event.metaKey || event.ctrlKey) &&
				!event.shiftKey &&
				key === "z";
			const isRedo =
				(event.metaKey || event.ctrlKey) &&
				((event.shiftKey && key === "z") || key === "y");
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

			if (isEscape && selectedShape) {
				event.preventDefault();
				setSelectedShape(null);
			}
		}

		window.addEventListener("keydown", handleKeyDown);

		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [canUndo, canRedo, selectedShape]);

	useEffect(() => {
		stopSoundFrame();

		const engine = soundEngineRef.current;

		if (
			!engine ||
			!isSoundEnabled ||
			!isAnimationPlaying ||
			!isAnimationMode ||
			sonicStrokes.length === 0
		) {
			engine?.stop();
			return;
		}

		const activeEngine = engine;

		void activeEngine.start();

		function tickSound() {
			activeEngine.tick(sonicStrokes, bivectorView);
			soundFrameRef.current = requestAnimationFrame(tickSound);
		}

		soundFrameRef.current = requestAnimationFrame(tickSound);

		return () => {
			stopSoundFrame();
			activeEngine.stop();
		};
	}, [
		isSoundEnabled,
		isAnimationPlaying,
		isAnimationMode,
		sonicStrokes,
		bivectorView,
	]);

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
							isAnimationMode ? "opacity-20" : "opacity-100",
							isCanvasInteractive
								? "pointer-events-auto"
								: "pointer-events-none",
						].join(" ")}
					>
						<DrawingCanvas
							strokes={strokes}
							clearSignal={clearSignal}
							penColor={penColor}
							penWidth={penWidth}
							onStrokesChange={commitStrokes}
						/>
					</div>

					<ShapePlacementCanvas
						selectedShape={
							mode === "draw" && selectedShape
								? selectedShape
								: null
						}
						color={penColor}
						width={penWidth}
						onCommitShape={commitShape}
					/>

					<RotorCanvas
						strokes={animatedStrokes}
						isActive={isAnimationMode}
						isPlaying={isAnimationPlaying}
						termLimit={visibleTermCount}
						bivectorView={bivectorView}
						animationTraceMode={animationTraceMode}
					/>

					<div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-2 text-[11px] font-medium text-zinc-100/45 sm:text-xs">
						<span>{strokes.length} strokes</span>
						<span>·</span>
						<span>{pointCount} raw</span>
						<span>·</span>
						<span>{totalResampledPoints} sampled</span>
						<span>·</span>
						<span>{totalFourierTerms} terms</span>
						{selectedShape && mode === "draw" && (
							<>
								<span>·</span>
								<span className="text-zinc-100/70">
									{getShapeLabel(selectedShape)} tool
								</span>
							</>
						)}
						{isAnimationMode && (
							<>
								<span className="hidden sm:inline">·</span>
								<span className="hidden font-mono sm:inline">
									{animationTraceMode === "sequential"
										? "sequential strokes"
										: "together mode"}
								</span>
							</>
						)}
					</div>

					{selectedShape && mode === "draw" && (
						<div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-2xl border border-zinc-700/70 bg-zinc-950/70 px-4 py-2 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur">
							Press to anchor. Drag to scale and rotate. Release
							to commit.
						</div>
					)}

					{isAnimationMode && !isAnimationPlaying && (
						<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
							<div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-zinc-700/70 bg-zinc-950/60 shadow-lg backdrop-blur">
								<div className="flex gap-2">
									<div className="h-10 w-3 rounded-full bg-zinc-100/90" />
									<div className="h-10 w-3 rounded-full bg-zinc-100/90" />
								</div>
							</div>
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
						className="absolute right-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90"
						onClick={() => setIsDrawerOpen(value => !value)}
						aria-label={
							isDrawerOpen
								? "Close settings drawer"
								: "Open settings drawer"
						}
					>
						<Settings
							size={19}
							className={[
								"transition-transform duration-200",
								isDrawerOpen ? "rotate-90" : "rotate-0",
							].join(" ")}
						/>
					</button>

					<div
						className={[
							"absolute right-3 top-16 z-30 max-h-[calc(100%-5rem)] w-[calc(100vw-1.5rem)] max-w-72 overflow-y-auto transition-all duration-200 sm:w-72",
							isDrawerOpen
								? "translate-x-0 opacity-100"
								: "pointer-events-none translate-x-[calc(100%+1rem)] opacity-0",
						].join(" ")}
					>
						<div className="flex flex-col gap-3">
							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 shadow-lg backdrop-blur">
								<p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									History
								</p>

								<div className="grid grid-cols-2 gap-2">
									<button
										className="rounded-xl border border-zinc-700 px-3 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
										onClick={undo}
										disabled={!canUndo}
									>
										Undo
									</button>

									<button
										className="rounded-xl border border-zinc-700 px-3 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
										onClick={redo}
										disabled={!canRedo}
									>
										Redo
									</button>
								</div>

								<p className="mt-3 text-xs leading-5 text-zinc-500">
									Shortcuts: Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
								</p>
							</section>

							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 shadow-lg backdrop-blur">
								<p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Animation
								</p>

								<div className="grid grid-cols-2 gap-2">
									{(
										["sequential", "simultaneous"] as const
									).map(traceMode => (
										<button
											key={traceMode}
											className={[
												"rounded-xl border px-3 py-3 text-sm font-semibold transition",
												animationTraceMode === traceMode
													? "border-zinc-50 bg-zinc-50 text-zinc-950"
													: "border-zinc-700 text-zinc-100 hover:bg-zinc-800",
											].join(" ")}
											onClick={() =>
												changeAnimationTraceMode(
													traceMode,
												)
											}
										>
											{traceMode === "sequential"
												? "Sequential"
												: "Together"}
										</button>
									))}
								</div>

								<p className="mt-3 text-xs leading-5 text-zinc-500">
									Sequential traces strokes in drawing order.
									Together starts every stroke at the same
									time.
								</p>
							</section>

							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 shadow-lg backdrop-blur">
								<div className="mb-3 flex items-center justify-between gap-3">
									<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
										Shapes
									</p>

									{selectedShape && (
										<button
											className="text-xs font-semibold text-zinc-300 transition hover:text-zinc-50"
											onClick={() =>
												setSelectedShape(null)
											}
										>
											Freehand
										</button>
									)}
								</div>

								<div className="grid grid-cols-4 gap-2">
									{SHAPE_TOOLS.map(kind => (
										<button
											key={kind}
											className={[
												"flex aspect-square items-center justify-center rounded-xl border transition",
												selectedShape === kind
													? "border-zinc-50 bg-zinc-50 text-zinc-950"
													: "border-zinc-700 text-zinc-100 hover:bg-zinc-800",
											].join(" ")}
											onClick={() => {
												setMode("draw");
												setIsAnimationPlaying(false);
												setSelectedShape(current =>
													current === kind
														? null
														: kind,
												);
											}}
											aria-label={`Select ${getShapeLabel(kind)} tool`}
											title={getShapeLabel(kind)}
										>
											<ShapeIcon kind={kind} />
										</button>
									))}
								</div>

								<p className="mt-3 text-xs leading-5 text-zinc-500">
									Select a shape, then press and drag on the
									canvas to scale and rotate it. Release to
									finalize it as a normal stroke.
								</p>
							</section>

							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 shadow-lg backdrop-blur">
								<p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Color
								</p>

								<div className="grid grid-cols-4 gap-2">
									{PEN_COLORS.map(color => (
										<button
											key={color}
											className="aspect-square rounded-xl border-2 transition hover:scale-105"
											style={{
												backgroundColor: color,
												borderColor:
													color === penColor
														? "#f4f4f5"
														: "transparent",
											}}
											onClick={() => setPenColor(color)}
											aria-label={`Select pen color ${color}`}
										/>
									))}
								</div>
							</section>

							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 shadow-lg backdrop-blur">
								<div className="mb-3 flex items-center justify-between">
									<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
										Width
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

								<div className="mt-4 flex h-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/80">
									<div
										className="rounded-full"
										style={{
											width: penWidth,
											height: penWidth,
											backgroundColor: penColor,
										}}
									/>
								</div>
							</section>

							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 shadow-lg backdrop-blur">
								<p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Image
								</p>

								<input
									ref={imageInputRef}
									className="hidden"
									type="file"
									accept="image/*"
									onChange={handleImageUpload}
								/>

								<button
									className="w-full rounded-xl border border-zinc-700 px-3 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() =>
										imageInputRef.current?.click()
									}
									disabled={isTracingImage}
								>
									{isTracingImage
										? "Tracing edges..."
										: "Import image"}
								</button>

								<p className="mt-3 text-xs leading-5 text-zinc-500">
									Uses classic threshold and Sobel-style edge
									tracing. Best with icons, sketches, logos,
									and high-contrast images.
								</p>

								{imageTraceError && (
									<p className="mt-3 text-xs leading-5 text-red-300">
										{imageTraceError}
									</p>
								)}
							</section>

							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 text-sm text-zinc-300 shadow-lg backdrop-blur">
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

									<p className="text-zinc-500">
										Disk shows rotor symmetry. Blade shows
										oriented area. Companion shows e₁e₂
										acting as a 90° rotation.
									</p>
								</div>
							</section>
						</div>
					</div>

					<button
						className={[
							"absolute bottom-3 right-16 z-30 flex h-11 w-11 items-center justify-center rounded-2xl border shadow-lg backdrop-blur transition disabled:cursor-not-allowed disabled:opacity-40",
							isSoundEnabled
								? "border-zinc-100 bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
								: "border-zinc-700/70 bg-zinc-950/70 text-zinc-100 hover:bg-zinc-900/90",
						].join(" ")}
						onClick={toggleSound}
						disabled={!hasAnimationData}
						aria-label={
							isSoundEnabled ? "Turn sound off" : "Turn sound on"
						}
						title={isSoundEnabled ? "Sound on" : "Sound off"}
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
							<path d="M4 9v6h4l5 4V5L8 9H4Z" />
							{isSoundEnabled ? (
								<>
									<path d="M16 9.5a4 4 0 0 1 0 5" />
									<path d="M18.5 7a7.5 7.5 0 0 1 0 10" />
								</>
							) : (
								<path d="m17 9 4 4m0-4-4 4" />
							)}
						</svg>
					</button>

					<button
						className="absolute bottom-3 right-3 z-30 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/70 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900/90 disabled:cursor-not-allowed disabled:opacity-40"
						onClick={() => setIsSnapshotMenuOpen(value => !value)}
						disabled={strokes.length === 0}
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

					{isSnapshotMenuOpen && strokes.length > 0 && (
						<div className="absolute bottom-16 right-3 z-30 w-44 overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-950/80 shadow-lg backdrop-blur">
							<button
								className="block w-full px-4 py-3 text-left text-sm font-medium text-zinc-100 transition hover:bg-zinc-800/80"
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
				</section>

				<aside className="border-t border-zinc-800 bg-zinc-950 p-3">
					<div className="flex items-center justify-center gap-3 overflow-x-auto">
						<button
							className={
								mode === "draw" && selectedShape === null
									? ACTIVE_BUTTON_CLASS
									: INACTIVE_BUTTON_CLASS
							}
							onClick={enterDrawMode}
						>
							Draw
						</button>

						<button
							className={
								isAnimationMode
									? ACTIVE_BUTTON_CLASS
									: INACTIVE_BUTTON_CLASS
							}
							disabled={!hasAnimationData}
							onClick={toggleAnimation}
						>
							{isAnimationPlaying ? "Pause" : "Animate"}
						</button>

						<button
							className={INACTIVE_BUTTON_CLASS}
							onClick={clearEverything}
						>
							Clear canvas
						</button>
					</div>
				</aside>
			</section>
		</main>
	);
}

export default App;
