import { useMemo, useState } from "react";
import { Download, Share2, Video, X } from "lucide-react";
import {
	BufferTarget,
	CanvasSource,
	Mp4OutputFormat,
	Output,
} from "mediabunny";

type ExportAspect = "square" | "vertical" | "wide";
type ExportQuality = "standard" | "high" | "ultra";
type ExportDuration = 4 | 8 | 12;

type ExportConfig = {
	width: number;
	height: number;
	fps: number;
	videoBitrate: number;
};

type CapturedCanvas = {
	canvas: HTMLCanvasElement;
	rect: DOMRect;
	opacity: number;
	stackScore: number;
	documentOrder: number;
};

const ASPECT_LABELS: Record<ExportAspect, string> = {
	square: "Square",
	vertical: "Vertical",
	wide: "Wide",
};

const QUALITY_LABELS: Record<ExportQuality, string> = {
	standard: "Standard",
	high: "High",
	ultra: "Ultra",
};

const QUALITY_HELP: Record<ExportQuality, string> = {
	standard: "Smaller file, good for quick sharing.",
	high: "Best default for social posting.",
	ultra: "Sharper export, larger file.",
};

function getExportConfig(
	aspect: ExportAspect,
	quality: ExportQuality,
): ExportConfig {
	const base =
		aspect === "vertical"
			? { width: 1080, height: 1920 }
			: aspect === "wide"
				? { width: 1920, height: 1080 }
				: { width: 1080, height: 1080 };

	if (quality === "standard") {
		return {
			width: Math.round(base.width * (2 / 3)),
			height: Math.round(base.height * (2 / 3)),
			fps: 30,
			videoBitrate: 3_500_000,
		};
	}

	if (quality === "ultra") {
		return {
			width: Math.round(base.width * (4 / 3)),
			height: Math.round(base.height * (4 / 3)),
			fps: 60,
			videoBitrate: 14_000_000,
		};
	}

	return {
		width: base.width,
		height: base.height,
		fps: 30,
		videoBitrate: 8_000_000,
	};
}

function waitForAnimationFrame() {
	return new Promise<number>(resolve => {
		window.requestAnimationFrame(resolve);
	});
}

async function waitForFrames(frameCount: number) {
	for (let index = 0; index < frameCount; index += 1) {
		await waitForAnimationFrame();
	}
}

function waitUntil(targetTimeMs: number) {
	return new Promise<void>(resolve => {
		function check() {
			if (performance.now() >= targetTimeMs) {
				resolve();
				return;
			}

			window.requestAnimationFrame(check);
		}

		check();
	});
}

type ExportAnimationControlAction = "reset" | "play" | "pause";

function dispatchExportAnimationControl(action: ExportAnimationControlAction) {
	window.dispatchEvent(
		new CustomEvent("bifourcation:export-animation-control", {
			detail: { action },
		}),
	);
}

async function resetAnimationToBeginningForExport() {
	dispatchExportAnimationControl("reset");
	await waitForFrames(4);

	dispatchExportAnimationControl("play");
	await waitForFrames(4);
}

async function pauseAnimationAfterExport() {
	dispatchExportAnimationControl("pause");
	await waitForFrames(2);
}

function getNumericOpacity(value: string) {
	const opacity = Number(value);

	if (!Number.isFinite(opacity)) return 1;

	return Math.min(1, Math.max(0, opacity));
}

function getEffectiveOpacity(element: HTMLElement, root: HTMLElement) {
	let opacity = 1;
	let current: HTMLElement | null = element;

	while (current) {
		const style = window.getComputedStyle(current);

		if (
			style.display === "none" ||
			style.visibility === "hidden" ||
			style.contentVisibility === "hidden"
		) {
			return 0;
		}

		opacity *= getNumericOpacity(style.opacity);

		if (current === root) break;

		current = current.parentElement;
	}

	return opacity;
}

function getEffectiveStackScore(element: HTMLElement, root: HTMLElement) {
	let score = 0;
	let depthWeight = 1;
	let current: HTMLElement | null = element;

	while (current) {
		const style = window.getComputedStyle(current);
		const zIndex = Number.parseInt(style.zIndex, 10);

		if (Number.isFinite(zIndex)) {
			score += zIndex * depthWeight;
			depthWeight /= 1000;
		}

		if (current === root) break;

		current = current.parentElement;
	}

	return score;
}

function getVisibleCanvases(root: HTMLElement): CapturedCanvas[] {
	const canvases = Array.from(root.querySelectorAll("canvas"));

	return canvases
		.flatMap((canvas, documentOrder) => {
			const rect = canvas.getBoundingClientRect();
			const opacity = getEffectiveOpacity(canvas, root);

			if (rect.width <= 0 || rect.height <= 0 || opacity <= 0) {
				return [];
			}

			return [
				{
					canvas,
					rect,
					opacity,
					stackScore: getEffectiveStackScore(canvas, root),
					documentOrder,
				},
			];
		})
		.sort((a, b) => {
			if (a.stackScore !== b.stackScore) {
				return a.stackScore - b.stackScore;
			}

			return a.documentOrder - b.documentOrder;
		});
}

function getCanvasUnion(canvases: CapturedCanvas[]) {
	const minX = Math.min(...canvases.map(item => item.rect.left));
	const minY = Math.min(...canvases.map(item => item.rect.top));
	const maxX = Math.max(...canvases.map(item => item.rect.right));
	const maxY = Math.max(...canvases.map(item => item.rect.bottom));

	return new DOMRect(minX, minY, maxX - minX, maxY - minY);
}

function drawCanvasesToExportCanvas({
	sourceRoot,
	outputCanvas,
}: {
	sourceRoot: HTMLElement;
	outputCanvas: HTMLCanvasElement;
}) {
	const outputContext = outputCanvas.getContext("2d", {
		alpha: false,
	});

	if (!outputContext) {
		throw new Error("Could not create export canvas context.");
	}

	const canvases = getVisibleCanvases(sourceRoot);

	outputContext.save();
	outputContext.fillStyle = "#09090B";
	outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

	if (canvases.length === 0) {
		outputContext.restore();
		throw new Error("No visible canvas layers were found to export.");
	}

	const sourceRect = getCanvasUnion(canvases);
	const scale = Math.min(
		outputCanvas.width / sourceRect.width,
		outputCanvas.height / sourceRect.height,
	);
	const drawWidth = sourceRect.width * scale;
	const drawHeight = sourceRect.height * scale;
	const offsetX = (outputCanvas.width - drawWidth) / 2;
	const offsetY = (outputCanvas.height - drawHeight) / 2;

	for (const item of canvases) {
		const x = offsetX + (item.rect.left - sourceRect.left) * scale;
		const y = offsetY + (item.rect.top - sourceRect.top) * scale;
		const width = item.rect.width * scale;
		const height = item.rect.height * scale;

		outputContext.globalAlpha = item.opacity;
		outputContext.drawImage(item.canvas, x, y, width, height);
	}

	outputContext.globalAlpha = 1;
	outputContext.restore();
}

function getCaptureRoot() {
	const root = document.getElementById("root");

	if (!root) {
		throw new Error("Could not find the application root.");
	}

	return root;
}

function createDownloadUrl(blob: Blob) {
	return window.URL.createObjectURL(blob);
}

function downloadBlob(blob: Blob, filename: string) {
	const url = createDownloadUrl(blob);
	const link = document.createElement("a");

	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();

	window.setTimeout(() => {
		window.URL.revokeObjectURL(url);
	}, 20_000);
}

async function shareBlob(blob: Blob, filename: string) {
	const file = new File([blob], filename, {
		type: blob.type,
	});

	if (
		typeof navigator.canShare === "function" &&
		navigator.canShare({ files: [file] }) &&
		typeof navigator.share === "function"
	) {
		await navigator.share({
			files: [file],
			title: "Bifourcation animation",
			text: "Made with Bifourcation",
		});

		return true;
	}

	return false;
}

function getExportFilename({
	aspect,
	quality,
	duration,
}: {
	aspect: ExportAspect;
	quality: ExportQuality;
	duration: ExportDuration;
}) {
	const timestamp = new Date()
		.toISOString()
		.replaceAll(":", "-")
		.replace(/\.\d+Z$/, "Z");

	return `bifourcation-${aspect}-${quality}-${duration}s-${timestamp}.mp4`;
}

async function exportVisibleAnimationToMp4({
	aspect,
	quality,
	duration,
	onProgress,
}: {
	aspect: ExportAspect;
	quality: ExportQuality;
	duration: ExportDuration;
	onProgress: (progress: number) => void;
}) {
	const config = getExportConfig(aspect, quality);
	const sourceRoot = getCaptureRoot();
	const outputCanvas = document.createElement("canvas");

	outputCanvas.width = config.width;
	outputCanvas.height = config.height;

	await resetAnimationToBeginningForExport();

	const target = new BufferTarget();
	const output = new Output({
		format: new Mp4OutputFormat(),
		target,
	});

	const videoSource = new CanvasSource(outputCanvas, {
		codec: "avc",
		bitrate: config.videoBitrate,
		keyFrameInterval: 1,
	});

	output.addVideoTrack(videoSource);
	output.setMetadataTags({
		title: "Bifourcation animation",
		artist: "Bifourcation",
		comment: "Generated in-browser from a Bifourcation canvas animation.",
	});

	await output.start();

	const totalFrames = Math.max(1, Math.round(duration * config.fps));
	const frameDuration = 1 / config.fps;
	const startedAt = performance.now();

	try {
		for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
			const timestampSeconds = frameIndex * frameDuration;
			const targetTimeMs = startedAt + timestampSeconds * 1000;

			await waitUntil(targetTimeMs);
			await waitForAnimationFrame();

			drawCanvasesToExportCanvas({
				sourceRoot,
				outputCanvas,
			});

			await videoSource.add(timestampSeconds, frameDuration, {
				keyFrame: frameIndex % config.fps === 0,
			});

			onProgress((frameIndex + 1) / totalFrames);
		}
	} finally {
		await pauseAnimationAfterExport();
	}

	videoSource.close();
	await output.finalize();

	if (!target.buffer) {
		throw new Error(
			"The MP4 encoder finished without producing a video buffer.",
		);
	}

	return new Blob([target.buffer], {
		type: "video/mp4",
	});
}

export function VideoExportOverlay() {
	const [isOpen, setIsOpen] = useState(false);
	const [aspect, setAspect] = useState<ExportAspect>("vertical");
	const [quality, setQuality] = useState<ExportQuality>("high");
	const [duration, setDuration] = useState<ExportDuration>(8);
	const [isExporting, setIsExporting] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [lastBlob, setLastBlob] = useState<Blob | null>(null);
	const [lastFilename, setLastFilename] = useState<string | null>(null);

	const exportConfig = useMemo(
		() => getExportConfig(aspect, quality),
		[aspect, quality],
	);

	async function runExport() {
		setError(null);
		setProgress(0);
		setIsExporting(true);

		try {
			const blob = await exportVisibleAnimationToMp4({
				aspect,
				quality,
				duration,
				onProgress: setProgress,
			});
			const filename = getExportFilename({
				aspect,
				quality,
				duration,
			});

			setLastBlob(blob);
			setLastFilename(filename);
			downloadBlob(blob, filename);
		} catch (caughtError) {
			const message =
				caughtError instanceof Error
					? caughtError.message
					: "The MP4 export failed.";

			setError(message);
		} finally {
			setIsExporting(false);
		}
	}

	async function shareLastExport() {
		if (!lastBlob || !lastFilename) return;

		try {
			const didShare = await shareBlob(lastBlob, lastFilename);

			if (!didShare) {
				downloadBlob(lastBlob, lastFilename);
			}
		} catch (caughtError) {
			const message =
				caughtError instanceof Error
					? caughtError.message
					: "The share action failed.";

			setError(message);
		}
	}

	return (
		<>
			<button
				className="fixed bottom-3 left-3 z-70 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-700/70 bg-zinc-950/80 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-zinc-900"
				type="button"
				onClick={() => setIsOpen(true)}
				aria-label="Open video export"
				title="Export MP4"
			>
				<Video className="h-5 w-5" aria-hidden="true" />
			</button>

			{isOpen && (
				<div className="fixed inset-0 z-80 flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm sm:items-center">
					<section className="w-full max-w-md rounded-3xl border border-zinc-700/80 bg-zinc-950/95 p-4 text-zinc-100 shadow-2xl">
						<div className="mb-4 flex items-start justify-between gap-3">
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
									Export
								</p>
								<h2 className="mt-1 text-lg font-semibold">
									MP4 animation
								</h2>
								<p className="mt-1 text-xs leading-5 text-zinc-500">
									Export starts from the beginning, records
									for the selected duration, then pauses the
									animation.
								</p>
							</div>

							<button
								className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700 text-zinc-300 transition hover:bg-zinc-800"
								type="button"
								onClick={() => setIsOpen(false)}
								aria-label="Close export panel"
								disabled={isExporting}
							>
								<X className="h-4 w-4" aria-hidden="true" />
							</button>
						</div>

						<div className="space-y-4">
							<div>
								<p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Format
								</p>

								<div className="grid grid-cols-3 gap-2">
									{(
										["vertical", "square", "wide"] as const
									).map(nextAspect => (
										<button
											key={nextAspect}
											className={[
												"rounded-2xl border px-3 py-2 text-sm font-semibold transition",
												aspect === nextAspect
													? "border-zinc-100 bg-zinc-100 text-zinc-950"
													: "border-zinc-700 text-zinc-200 hover:bg-zinc-800",
											].join(" ")}
											type="button"
											onClick={() =>
												setAspect(nextAspect)
											}
											disabled={isExporting}
										>
											{ASPECT_LABELS[nextAspect]}
										</button>
									))}
								</div>
							</div>

							<div>
								<p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Quality
								</p>

								<div className="grid grid-cols-3 gap-2">
									{(
										["standard", "high", "ultra"] as const
									).map(nextQuality => (
										<button
											key={nextQuality}
											className={[
												"rounded-2xl border px-3 py-2 text-sm font-semibold transition",
												quality === nextQuality
													? "border-zinc-100 bg-zinc-100 text-zinc-950"
													: "border-zinc-700 text-zinc-200 hover:bg-zinc-800",
											].join(" ")}
											type="button"
											onClick={() =>
												setQuality(nextQuality)
											}
											disabled={isExporting}
										>
											{QUALITY_LABELS[nextQuality]}
										</button>
									))}
								</div>

								<p className="mt-2 text-xs leading-5 text-zinc-500">
									{QUALITY_HELP[quality]}
								</p>
							</div>

							<div>
								<p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
									Duration
								</p>

								<div className="grid grid-cols-3 gap-2">
									{([4, 8, 12] as const).map(nextDuration => (
										<button
											key={nextDuration}
											className={[
												"rounded-2xl border px-3 py-2 text-sm font-semibold transition",
												duration === nextDuration
													? "border-zinc-100 bg-zinc-100 text-zinc-950"
													: "border-zinc-700 text-zinc-200 hover:bg-zinc-800",
											].join(" ")}
											type="button"
											onClick={() =>
												setDuration(nextDuration)
											}
											disabled={isExporting}
										>
											{nextDuration}s
										</button>
									))}
								</div>
							</div>

							<div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
								<div className="flex items-center justify-between gap-3 text-sm">
									<span className="text-zinc-400">
										Output
									</span>
									<span className="font-mono text-zinc-100">
										{exportConfig.width}×
										{exportConfig.height} ·{" "}
										{exportConfig.fps}fps
									</span>
								</div>

								<div className="mt-2 flex items-center justify-between gap-3 text-sm">
									<span className="text-zinc-400">
										Bitrate
									</span>
									<span className="font-mono text-zinc-100">
										{Math.round(
											exportConfig.videoBitrate /
												1_000_000,
										)}
										Mbps
									</span>
								</div>
							</div>

							{isExporting && (
								<div>
									<div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
										<span>Rendering</span>
										<span>
											{Math.round(progress * 100)}%
										</span>
									</div>

									<div className="h-2 overflow-hidden rounded-full bg-zinc-800">
										<div
											className="h-full rounded-full bg-zinc-100 transition-[width]"
											style={{
												width: `${Math.round(progress * 100)}%`,
											}}
										/>
									</div>
								</div>
							)}

							{error && (
								<p className="rounded-2xl border border-red-500/40 bg-red-950/40 p-3 text-sm leading-5 text-red-200">
									{error}
								</p>
							)}

							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								<button
									className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-zinc-100 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
									type="button"
									onClick={runExport}
									disabled={isExporting}
								>
									<Download
										className="h-4 w-4"
										aria-hidden="true"
									/>
									{isExporting
										? "Exporting..."
										: "Export MP4"}
								</button>

								<button
									className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
									type="button"
									onClick={shareLastExport}
									disabled={isExporting || !lastBlob}
								>
									<Share2
										className="h-4 w-4"
										aria-hidden="true"
									/>
									Share last export
								</button>
							</div>

							<p className="text-xs leading-5 text-zinc-600">
								Native share works on supported mobile browsers.
								Unsupported browsers will download the MP4
								instead.
							</p>
						</div>
					</section>
				</div>
			)}
		</>
	);
}
