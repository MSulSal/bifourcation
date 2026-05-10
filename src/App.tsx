import { useMemo, useRef, useState } from "react";
import { DrawingCanvas } from "./components/DrawingCanvas";
import { EpicycleCanvas, type BivectorView } from "./components/EpicycleCanvas";
import { computeFourierTerms } from "./math/fourier";
import { resamplePath } from "./math/path";
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

const ACTIVE_BUTTON_CLASS =
	"shrink-0 rounded-xl bg-zinc-50 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400";

const INACTIVE_BUTTON_CLASS =
	"shrink-0 rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent";

type AppMode = "draw" | "animate";

function App() {
	const canvasStageRef = useRef<HTMLElement | null>(null);

	const [clearSignal, setClearSignal] = useState(0);
	const [strokes, setStrokes] = useState<Stroke[]>([]);
	const [mode, setMode] = useState<AppMode>("draw");
	const [isAnimationPlaying, setIsAnimationPlaying] = useState(false);
	const [isDrawerOpen, setIsDrawerOpen] = useState(false);
	const [isSnapshotMenuOpen, setIsSnapshotMenuOpen] = useState(false);
	const [bivectorView, setBivectorView] = useState<BivectorView>("blade");

	const [penColor, setPenColor] = useState(PEN_COLORS[0]);
	const [penWidth, setPenWidth] = useState(4);

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
	const isCanvasInteractive = mode === "draw";

	function clearEverything() {
		setIsAnimationPlaying(false);
		setMode("draw");
		setIsSnapshotMenuOpen(false);
		setClearSignal(value => value + 1);
		setStrokes([]);
	}

	function enterDrawMode() {
		setIsAnimationPlaying(false);
		setMode("draw");
	}

	function toggleAnimation() {
		if (!hasAnimationData) return;

		setMode("animate");
		setIsAnimationPlaying(value => !value);
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
					text: "Fourier through oriented planes.",
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

	return (
		<main className="flex h-[100dvh] w-screen overflow-hidden bg-zinc-950 text-zinc-50">
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
								Draw a shape. Watch it split into rotating
								geometry.
							</p>
						</div>
					</div>

					<div className="w-fit rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300">
						Fourier × Oriented Planes
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
							clearSignal={clearSignal}
							penColor={penColor}
							penWidth={penWidth}
							onStrokesChange={setStrokes}
						/>
					</div>

					<EpicycleCanvas
						strokes={animatedStrokes}
						isActive={isAnimationMode}
						isPlaying={isAnimationPlaying}
						termLimit={visibleTermCount}
						bivectorView={bivectorView}
					/>

					<div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-2 text-[11px] font-medium text-zinc-100/45 sm:text-xs">
						<span>{strokes.length} strokes</span>
						<span>·</span>
						<span>{pointCount} raw</span>
						<span>·</span>
						<span>{totalResampledPoints} sampled</span>
						<span>·</span>
						<span>{totalFourierTerms} terms</span>
					</div>

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
						<span
							className={[
								"text-lg transition-transform duration-200",
								isDrawerOpen ? "rotate-180" : "rotate-0",
							].join(" ")}
						>
							◀
						</span>
					</button>

					<div
						className={[
							"absolute right-3 top-16 z-20 max-h-[calc(100%-5rem)] w-[calc(100vw-1.5rem)] max-w-72 overflow-y-auto transition-all duration-200 sm:w-72",
							isDrawerOpen
								? "translate-x-0 opacity-100"
								: "pointer-events-none translate-x-[calc(100%+1rem)] opacity-0",
						].join(" ")}
					>
						<div className="flex flex-col gap-3">
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

							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 text-sm text-zinc-300 shadow-lg backdrop-blur">
								<p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Plane
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
										is oriented area in the drawing plane.
									</p>

									<p className="text-zinc-500">
										Blade and disk modes show oriented area.
										Companion mode shows the e₁e₂-rotated
										vector.
									</p>
								</div>
							</section>
						</div>
					</div>

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
								mode === "draw"
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
