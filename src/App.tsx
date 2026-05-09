import { useState } from "react";
import { DrawingCanvas } from "./components/DrawingCanvas";
import type { Stroke } from "./types/geometry";
import { resamplePath } from "./math/path";

function App() {
	const [clearSignal, setClearSignal] = useState(0);
	const [strokes, setStrokes] = useState<Stroke[]>([]);

	const pointCount = strokes.reduce(
		(total, stroke) => total + stroke.points.length,
		0,
	);

	const latestStroke = strokes.at(-1);
	const resampledPointCount = 256;

	const resampledPath = latestStroke
		? resamplePath(latestStroke.points, resampledPointCount)
		: [];

	return (
		<main className="flex h-dvh w-screen overflow-hidden bg-zinc-950 text-zinc-50">
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

				<section className="min-h-0 flex-1 bg-zinc-900">
					<DrawingCanvas
						clearSignal={clearSignal}
						onStrokesChange={setStrokes}
					/>
				</section>

				<aside className="border-t border-zinc-800 bg-zinc-950 p-3">
					<div className="flex items-center gap-3 overflow-x-auto">
						<button className="shrink-0 rounded-xl bg-zinc-50 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-zinc-200">
							Start drawing
						</button>

						<button
							className="shrink-0 rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-zinc-200 transition hover:bg-zinc-800"
							onClick={() => {
								setClearSignal(value => value + 1);
								setStrokes([]);
							}}
						>
							Clear canvas
						</button>

						<div className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
							{strokes.length === 0
								? "Canvas ready"
								: `${strokes.length} stroke${strokes.length === 1 ? "" : "s"} · ${pointCount} points`}
						</div>

						<div className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
							{resampledPath.length === 0
								? "No Fourier path yet"
								: `${resampledPath.length} resampled points`}
						</div>

						<div className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
							Draw one continuous path
						</div>
					</div>
				</aside>
			</section>
		</main>
	);
}

export default App;
