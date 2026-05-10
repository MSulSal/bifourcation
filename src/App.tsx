import { useState } from "react";
import { DrawingCanvas } from "./components/DrawingCanvas";
import { EpicycleCanvas } from "./components/EpicycleCanvas";
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

function App() {
	const [clearSignal, setClearSignal] = useState(0);
	const [strokes, setStrokes] = useState<Stroke[]>([]);
	const [isAnimating, setIsAnimating] = useState(false);
	const [isDrawingMode, setIsDrawingMode] = useState(true);
	const [isDrawerOpen, setIsDrawerOpen] = useState(false);

	const [penColor, setPenColor] = useState(PEN_COLORS[0]);
	const [penWidth, setPenWidth] = useState(4);

	const pointCount = strokes.reduce(
		(total, stroke) => total + stroke.points.length,
		0,
	);

	const latestStroke =
		strokes.length > 0 ? strokes[strokes.length - 1] : undefined;

	const resampledPointCount = 256;

	const resampledPath = latestStroke
		? resamplePath(latestStroke.points, resampledPointCount)
		: [];

	const fourierTerms =
		resampledPath.length > 0 ? computeFourierTerms(resampledPath) : [];

	const visibleTermCount = Math.min(80, fourierTerms.length);

	function clearEverything() {
		setIsAnimating(false);
		setIsDrawingMode(true);
		setClearSignal(value => value + 1);
		setStrokes([]);
	}

	function enterDrawMode() {
		setIsAnimating(false);
		setIsDrawingMode(true);
	}

	function toggleAnimation() {
		if (fourierTerms.length === 0) return;

		setIsDrawingMode(false);
		setIsAnimating(value => !value);
	}

	const isCanvasInteractive = isDrawingMode && !isAnimating;

	return (
		<main className="flex h-[100dvh] w-screen overflow-hidden bg-zinc-950 text-zinc-50">
			<section className="flex h-full w-full flex-col">
				<header className="flex flex-col gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
					<div>
						<h1 className="text-xl font-semibold tracking-tight">
							Bifourcation
						</h1>
						<p className="text-sm text-zinc-400">
							Draw a shape. Watch it split into rotating geometry.
						</p>
					</div>

					<div className="w-fit rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300">
						Fourier × Bivectors
					</div>
				</header>

				<section className="relative min-h-0 flex-1 overflow-hidden bg-zinc-900">
					<div
						className={[
							"h-full w-full transition-opacity duration-200",
							isAnimating ? "opacity-20" : "opacity-100",
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
						terms={fourierTerms}
						isPlaying={isAnimating}
						termLimit={visibleTermCount}
					/>

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
							"absolute right-3 top-16 z-20 w-72 transition-all duration-200",
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

							<section className="rounded-2xl border border-zinc-700/70 bg-zinc-950/70 p-3 text-sm text-zinc-400 shadow-lg backdrop-blur">
								<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Path
								</p>

								<div className="mt-3 space-y-1">
									<p>
										{strokes.length === 0
											? "No strokes yet"
											: `${strokes.length} stroke${
													strokes.length === 1
														? ""
														: "s"
												}`}
									</p>

									<p>{pointCount} raw points</p>

									<p>
										{resampledPath.length === 0
											? "No resampled path"
											: `${resampledPath.length} resampled points`}
									</p>

									<p>
										{fourierTerms.length === 0
											? "No Fourier terms"
											: `${fourierTerms.length} Fourier terms`}
									</p>
								</div>
							</section>
						</div>
					</div>
				</section>

				<aside className="border-t border-zinc-800 bg-zinc-950 p-3">
					<div className="flex items-center justify-center gap-3 overflow-x-auto">
						<button
							className={
								isDrawingMode && !isAnimating
									? ACTIVE_BUTTON_CLASS
									: INACTIVE_BUTTON_CLASS
							}
							onClick={enterDrawMode}
						>
							Draw
						</button>

						<button
							className={
								isAnimating
									? ACTIVE_BUTTON_CLASS
									: INACTIVE_BUTTON_CLASS
							}
							disabled={fourierTerms.length === 0}
							onClick={toggleAnimation}
						>
							{isAnimating ? "Pause" : "Animate"}
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
