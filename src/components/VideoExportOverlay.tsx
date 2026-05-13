import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Share2, X } from "lucide-react";

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

type MediabunnyModule = typeof import("mediabunny");

const STORAGE_KEYS = {
	aspect: "bifourcation.export.aspect",
	quality: "bifourcation.export.quality",
	duration: "bifourcation.export.duration",
} as const;

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

const AUDIO_EXPORT_BITRATE = 128_000;
const EXPORT_SIZE_OVERHEAD_FACTOR = 1.18;
const STORAGE_WARNING_RATIO = 0.85;

async function loadMediabunny(): Promise<MediabunnyModule> {
	return await import("mediabunny");
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

function readStoredAspect(): ExportAspect {
	const value = readStoredValue(STORAGE_KEYS.aspect);

	return value === "square" || value === "vertical" || value === "wide"
		? value
		: "vertical";
}

function readStoredQuality(): ExportQuality {
	const value = readStoredValue(STORAGE_KEYS.quality);

	return value === "standard" || value === "high" || value === "ultra"
		? value
		: "high";
}

function readStoredDuration(): ExportDuration {
	const value = Number(readStoredValue(STORAGE_KEYS.duration));

	return value === 4 || value === 8 || value === 12 ? value : 8;
}

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

class ExportCanceledError extends Error {
	constructor() {
		super("Export canceled.");
		this.name = "ExportCanceledError";
	}
}

function throwIfCanceled(signal?: AbortSignal) {
	if (signal?.aborted) {
		throw new ExportCanceledError();
	}
}

function isExportCanceledError(error: unknown): error is ExportCanceledError {
	return error instanceof ExportCanceledError;
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

function estimateExportFileSizeBytes({
	duration,
	videoBitrate,
	includeAudio,
}: {
	duration: ExportDuration;
	videoBitrate: number;
	includeAudio: boolean;
}) {
	const totalBitrate =
		videoBitrate + (includeAudio ? AUDIO_EXPORT_BITRATE : 0);

	return Math.ceil(
		(duration * totalBitrate * EXPORT_SIZE_OVERHEAD_FACTOR) / 8,
	);
}

function formatBytes(bytes: number) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

	const units = ["B", "KB", "MB", "GB", "TB"];
	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	const scaled = bytes / 1024 ** exponent;

	return `${scaled.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

async function getAvailableStorageEstimateBytes() {
	try {
		if (
			!("storage" in navigator) ||
			typeof navigator.storage?.estimate !== "function"
		) {
			return null;
		}

		const estimate = await navigator.storage.estimate();
		const usage = estimate.usage ?? 0;
		const quota = estimate.quota ?? 0;

		if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) {
			return null;
		}

		return Math.max(0, quota - usage);
	} catch {
		return null;
	}
}

function requestExportAudioTrack() {
	let audioTrack: MediaStreamTrack | null = null;

	window.dispatchEvent(
		new CustomEvent("bifourcation:export-request-audio-track", {
			detail: {
				resolve: (track: MediaStreamTrack | null) => {
					audioTrack = track;
				},
			},
		}),
	);

	return audioTrack;
}

async function exportVisibleAnimationToMp4({
	aspect,
	quality,
	duration,
	onProgress,
	signal,
}: {
	aspect: ExportAspect;
	quality: ExportQuality;
	duration: ExportDuration;
	onProgress: (progress: number) => void;
	signal?: AbortSignal;
}) {
	throwIfCanceled(signal);

	const config = getExportConfig(aspect, quality);
	const sourceRoot = getCaptureRoot();
	const outputCanvas = document.createElement("canvas");

	outputCanvas.width = config.width;
	outputCanvas.height = config.height;

	await resetAnimationToBeginningForExport();
	throwIfCanceled(signal);

	const {
		BufferTarget,
		CanvasSource,
		MediaStreamAudioTrackSource,
		Mp4OutputFormat,
		Output,
	} = await loadMediabunny();

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

	const audioTrack = requestExportAudioTrack();
	let audioSource: InstanceType<typeof MediaStreamAudioTrackSource> | null =
		null;

	if (audioTrack) {
		audioSource = new MediaStreamAudioTrackSource(
			audioTrack as ConstructorParameters<
				typeof MediaStreamAudioTrackSource
			>[0],
			{
				codec: "aac",
				bitrate: AUDIO_EXPORT_BITRATE,
			},
		);
		audioSource.errorPromise.catch(() => {
			// Export will still succeed with video if audio capture errors.
		});
		output.addAudioTrack(audioSource);
	}

	output.setMetadataTags({
		title: "Bifourcation animation",
		artist: "Bifourcation",
		comment: "Generated in-browser from a Bifourcation canvas animation.",
	});

	const totalFrames = Math.max(1, Math.round(duration * config.fps));
	const frameDuration = 1 / config.fps;
	let outputStarted = false;
	let exportError: unknown = null;

	try {
		await output.start();
		outputStarted = true;
		throwIfCanceled(signal);

		const startedAt = performance.now();

		for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
			throwIfCanceled(signal);

			const timestampSeconds = frameIndex * frameDuration;
			const targetTimeMs = startedAt + timestampSeconds * 1000;

			await waitUntil(targetTimeMs);
			throwIfCanceled(signal);
			await waitForAnimationFrame();
			throwIfCanceled(signal);

			drawCanvasesToExportCanvas({
				sourceRoot,
				outputCanvas,
			});

			await videoSource.add(timestampSeconds, frameDuration, {
				keyFrame: frameIndex % config.fps === 0,
			});
			throwIfCanceled(signal);

			onProgress((frameIndex + 1) / totalFrames);
		}
	} catch (caughtError) {
		exportError = caughtError;
	} finally {
		await pauseAnimationAfterExport();

		videoSource.close();
		audioSource?.close();

		if (outputStarted) {
			if (exportError || signal?.aborted) {
				await output.cancel().catch(() => undefined);
			} else {
				await output.finalize();
			}
		}
	}

	if (exportError) {
		throw exportError;
	}

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
	const [aspect, setAspect] = useState<ExportAspect>(readStoredAspect);
	const [quality, setQuality] = useState<ExportQuality>(readStoredQuality);
	const [duration, setDuration] =
		useState<ExportDuration>(readStoredDuration);
	const [isExporting, setIsExporting] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [storageNotice, setStorageNotice] = useState<string | null>(null);
	const [lastBlob, setLastBlob] = useState<Blob | null>(null);
	const [lastFilename, setLastFilename] = useState<string | null>(null);
	const exportAbortControllerRef = useRef<AbortController | null>(null);

	const exportConfig = useMemo(
		() => getExportConfig(aspect, quality),
		[aspect, quality],
	);
	const estimatedExportBytes = useMemo(
		() =>
			estimateExportFileSizeBytes({
				duration,
				videoBitrate: exportConfig.videoBitrate,
				includeAudio: true,
			}),
		[duration, exportConfig.videoBitrate],
	);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.aspect, aspect);
	}, [aspect]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.quality, quality);
	}, [quality]);

	useEffect(() => {
		writeStoredValue(STORAGE_KEYS.duration, String(duration));
	}, [duration]);

	useEffect(() => {
		function openPanel() {
			setIsOpen(true);
		}

		window.addEventListener("bifourcation:open-video-export", openPanel);

		return () => {
			window.removeEventListener(
				"bifourcation:open-video-export",
				openPanel,
			);
		};
	}, []);

	useEffect(() => {
		return () => {
			exportAbortControllerRef.current?.abort();
			exportAbortControllerRef.current = null;
		};
	}, []);

	function cancelExport() {
		exportAbortControllerRef.current?.abort();
	}

	function closePanel() {
		if (isExporting) {
			cancelExport();
		}

		setIsOpen(false);
	}

	async function runExport() {
		setError(null);
		setStorageNotice(null);
		setProgress(0);

		try {
			const availableStorageBytes = await getAvailableStorageEstimateBytes();

			if (availableStorageBytes !== null) {
				if (estimatedExportBytes > availableStorageBytes) {
					setError(
						`Not enough storage estimated. Need about ${formatBytes(estimatedExportBytes)}, but only about ${formatBytes(availableStorageBytes)} is available.`,
					);
					return;
				}

				if (estimatedExportBytes > availableStorageBytes * STORAGE_WARNING_RATIO) {
					setStorageNotice(
						`Low available storage: export may fail. Estimated ${formatBytes(estimatedExportBytes)} file size.`,
					);
				}
			}

			const abortController = new AbortController();
			exportAbortControllerRef.current = abortController;
			setIsExporting(true);

			const blob = await exportVisibleAnimationToMp4({
				aspect,
				quality,
				duration,
				onProgress: setProgress,
				signal: abortController.signal,
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
			if (isExportCanceledError(caughtError)) {
				setStorageNotice("Export canceled.");
			} else {
				const message =
					caughtError instanceof Error
						? caughtError.message
						: "The MP4 export failed.";

				setError(message);
			}
		} finally {
			exportAbortControllerRef.current = null;
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
			{isOpen && (
				<section className="fixed bottom-16 right-3 z-[80] flex max-h-[calc(100dvh-5rem)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border border-zinc-700/80 bg-zinc-950/95 p-4 text-zinc-100 shadow-2xl">
						<div className="mb-4 flex shrink-0 items-start justify-between gap-3">
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
								className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-zinc-300 transition hover:bg-zinc-800"
								type="button"
								onClick={closePanel}
								aria-label="Close export panel"
							>
								<X className="h-5 w-5" aria-hidden="true" />
							</button>
						</div>

						<div className="space-y-4 overflow-y-auto pr-1">
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

								<div className="mt-2 flex items-center justify-between gap-3 text-sm">
									<span className="text-zinc-400">
										Est. size
									</span>
									<span className="font-mono text-zinc-100">
										{formatBytes(estimatedExportBytes)}
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

							{storageNotice && (
								<p className="rounded-2xl border border-amber-500/40 bg-amber-950/30 p-3 text-sm leading-5 text-amber-100">
									{storageNotice}
								</p>
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

								{isExporting && (
									<button
										className="flex h-12 items-center justify-center rounded-2xl border border-red-900/70 px-4 text-sm font-semibold text-red-200 transition hover:bg-red-950/50 sm:col-span-2"
										type="button"
										onClick={cancelExport}
									>
										Cancel export
									</button>
								)}
							</div>

							<p className="text-xs leading-5 text-zinc-600">
								Native share works on supported mobile browsers.
								Unsupported browsers will download the MP4
								instead.
							</p>
						</div>
					</section>
			)}
		</>
	);
}
