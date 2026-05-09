function App() {
	return (
		<main className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-50">
			<section className="flex h-full w-full flex-col">
				<header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-6 py-4">
					<div>
						<h1 className="text-xl font-semibold tracking-tight">
							Bifourcation
						</h1>
						<p className="text-sm text-zinc-400">
							Draw a shape. Watch it split into rotating geometry.
						</p>
					</div>

					<div className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300">
						Fourier × Bivectors
					</div>
				</header>

				<div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] gap-4 bg-zinc-950 p-4">
					<aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
						<h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
							Controls
						</h2>

						<div className="mt-6 space-y-4">
							<button className="w-full rounded-xl bg-zinc-50 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-zinc-200">
								Start drawing
							</button>

							<button className="w-full rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-zinc-200 transition hover:bg-zinc-800">
								Clear canvas
							</button>

							<div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
								<p className="text-sm font-medium text-zinc-200">
									Next up
								</p>
								<p className="mt-2 text-sm leading-6 text-zinc-400">
									We’ll add the drawing canvas first, then
									sample strokes into points for the Fourier
									decomposition.
								</p>
							</div>
						</div>
					</aside>

					<section className="relative min-h-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
						<div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:32px_32px]" />

						<div className="relative flex h-full items-center justify-center">
							<div className="max-w-lg text-center">
								<p className="text-5xl font-semibold tracking-tight text-zinc-50">
									Canvas coming next.
								</p>
								<p className="mt-4 text-base leading-7 text-zinc-400">
									This panel will become the drawing surface,
									then the epicycle animation stage.
								</p>
							</div>
						</div>
					</section>
				</div>
			</section>
		</main>
	);
}

export default App;
