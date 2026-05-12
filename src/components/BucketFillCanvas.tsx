import {
	useEffect,
	useRef,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { createId, renderBoundaryObject } from "../math/shapes";
import type {
	BucketFillObject,
	BucketFillSpan,
	DrawingObject,
	Point,
} from "../types/geometry";

type BucketFillCanvasProps = {
	enabled: boolean;
	objects: DrawingObject[];
	color: string;
	onCommitFill: (fill: BucketFillObject) => void;
};

const BUCKET_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
	<path d="M8 17L17 8L26 17L17 26L8 17Z" fill="black" stroke="white" stroke-width="3" stroke-linejoin="round"/>
	<path d="M8 17L17 8L26 17L17 26L8 17Z" fill="none" stroke="black" stroke-width="1.7" stroke-linejoin="round"/>
	<path d="M12 17H22" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>
	<path d="M12 17H22" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round"/>
	<path d="M24 28C24 28 29 22.8 29 20.2C29 18.3 27.4 17.2 24 17.2C20.6 17.2 19 18.3 19 20.2C19 22.8 24 28 24 28Z" fill="black" stroke="white" stroke-width="2"/>
</svg>
`)}") 8 24, crosshair`;

function getPointerPoint(
	event: ReactPointerEvent<HTMLCanvasElement>,
	canvas: HTMLCanvasElement,
): Point {
	const rect = canvas.getBoundingClientRect();

	return {
		x: event.clientX - rect.left,
		y: event.clientY - rect.top,
	};
}

function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement) {
	const rect = canvas.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;

	canvas.width = Math.round(rect.width * dpr);
	canvas.height = Math.round(rect.height * dpr);

	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function getFloodFillSpans({
	objects,
	seed,
	width,
	height,
}: {
	objects: DrawingObject[];
	seed: Point;
	width: number;
	height: number;
}): BucketFillSpan[] {
	const pixelWidth = Math.max(1, Math.round(width));
	const pixelHeight = Math.max(1, Math.round(height));
	const startX = Math.floor(seed.x);
	const startY = Math.floor(seed.y);

	if (
		startX < 0 ||
		startX >= pixelWidth ||
		startY < 0 ||
		startY >= pixelHeight
	) {
		return [];
	}

	const boundaryCanvas = document.createElement("canvas");
	boundaryCanvas.width = pixelWidth;
	boundaryCanvas.height = pixelHeight;

	const ctx = boundaryCanvas.getContext("2d");
	if (!ctx) return [];

	ctx.clearRect(0, 0, pixelWidth, pixelHeight);

	for (const object of objects) {
		renderBoundaryObject(ctx, object);
	}

	const imageData = ctx.getImageData(0, 0, pixelWidth, pixelHeight);
	const data = imageData.data;
	const totalPixels = pixelWidth * pixelHeight;
	const startIndex = startY * pixelWidth + startX;

	function isBoundary(index: number) {
		return data[index * 4 + 3] > 8;
	}

	if (isBoundary(startIndex)) return [];

	const visited = new Uint8Array(totalPixels);
	const queue = new Int32Array(totalPixels);

	let head = 0;
	let tail = 0;

	visited[startIndex] = 1;
	queue[tail] = startIndex;
	tail += 1;

	while (head < tail) {
		const index = queue[head];
		head += 1;

		const x = index % pixelWidth;
		const y = Math.floor(index / pixelWidth);

		const neighbors = [
			x > 0 ? index - 1 : -1,
			x < pixelWidth - 1 ? index + 1 : -1,
			y > 0 ? index - pixelWidth : -1,
			y < pixelHeight - 1 ? index + pixelWidth : -1,
		];

		for (const neighbor of neighbors) {
			if (neighbor < 0) continue;
			if (visited[neighbor]) continue;
			if (isBoundary(neighbor)) continue;

			visited[neighbor] = 1;
			queue[tail] = neighbor;
			tail += 1;
		}
	}

	const spans: BucketFillSpan[] = [];

	for (let y = 0; y < pixelHeight; y += 1) {
		let x = 0;

		while (x < pixelWidth) {
			const index = y * pixelWidth + x;

			if (!visited[index]) {
				x += 1;
				continue;
			}

			const start = x;

			while (x < pixelWidth && visited[y * pixelWidth + x]) {
				x += 1;
			}

			spans.push({
				x: start,
				y,
				width: x - start,
			});
		}
	}

	return spans;
}

export function BucketFillCanvas({
	enabled,
	objects,
	color,
	onCommitFill,
}: BucketFillCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	function clearCanvas() {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, rect.width, rect.height);
	}

	function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!enabled || event.button !== 0) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		event.preventDefault();

		const rect = canvas.getBoundingClientRect();
		const seed = getPointerPoint(event, canvas);

		const spans = getFloodFillSpans({
			objects,
			seed,
			width: rect.width,
			height: rect.height,
		});

		if (spans.length === 0) return;

		onCommitFill({
			id: createId("fill"),
			color,
			opacity: 1,
			seed,
			canvasWidth: rect.width,
			canvasHeight: rect.height,
			spans,
		});
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		resizeCanvasToDisplaySize(canvas);
		clearCanvas();

		const resizeObserver = new ResizeObserver(() => {
			resizeCanvasToDisplaySize(canvas);
			clearCanvas();
		});

		resizeObserver.observe(canvas);

		return () => resizeObserver.disconnect();
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className={[
				"absolute inset-0 z-20 block h-full w-full touch-none",
				enabled ? "pointer-events-auto" : "pointer-events-none",
			].join(" ")}
			style={enabled ? { cursor: BUCKET_CURSOR } : undefined}
			onPointerDown={handlePointerDown}
		/>
	);
}
