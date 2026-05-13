import {
	useEffect,
	useRef,
	type PointerEvent as ReactPointerEvent,
} from "react";
import {
	createId,
	renderDrawingObject,
} from "../math/shapes";
import type { DrawingObject, Point, Stroke } from "../types/geometry";

type DrawingCanvasProps = {
	objects: DrawingObject[];
	clearSignal: number;
	penColor: string;
	penWidth: number;
	nonFillOpacity?: number;
	isInteractive: boolean;
	onCommitStroke: (stroke: Stroke) => void;
};

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

export function DrawingCanvas({
	objects,
	clearSignal,
	penColor,
	penWidth,
	nonFillOpacity = 1,
	isInteractive,
	onCommitStroke,
}: DrawingCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const currentStrokeRef = useRef<Stroke | null>(null);

	function resizeCanvasToDisplaySize() {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;

		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	function drawCanvas(currentStroke = currentStrokeRef.current) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, rect.width, rect.height);

		for (const object of objects) {
			if (object.type === "bucket-fill") {
				renderDrawingObject(ctx, object);
			}
		}

		ctx.save();
		ctx.globalAlpha = Math.max(0, Math.min(1, nonFillOpacity));

		for (const object of objects) {
			if (object.type !== "bucket-fill") {
				renderDrawingObject(ctx, object);
			}
		}

		if (currentStroke && currentStroke.points.length >= 2) {
			renderDrawingObject(ctx, {
				type: "freehand",
				id: createId("preview"),
				stroke: currentStroke,
			});
		}

		ctx.restore();
	}

	function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!isInteractive || event.button !== 0) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		event.preventDefault();

		const point = getPointerPoint(event, canvas);

		canvas.setPointerCapture(event.pointerId);

		currentStrokeRef.current = {
			color: penColor,
			width: penWidth,
			points: [point],
		};

		drawCanvas();
	}

	function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!isInteractive) return;

		const canvas = canvasRef.current;
		const currentStroke = currentStrokeRef.current;

		if (!canvas || !currentStroke) return;

		const point = getPointerPoint(event, canvas);
		const previous = currentStroke.points.at(-1);

		if (
			previous &&
			Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5
		) {
			return;
		}

		currentStrokeRef.current = {
			...currentStroke,
			points: [...currentStroke.points, point],
		};

		drawCanvas();
	}

	function finishStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
		const canvas = canvasRef.current;
		const currentStroke = currentStrokeRef.current;

		if (!canvas || !currentStroke) return;

		if (canvas.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}

		currentStrokeRef.current = null;

		if (currentStroke.points.length >= 2) {
			onCommitStroke(currentStroke);
		}

		drawCanvas(null);
	}

	function cancelStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
		const canvas = canvasRef.current;

		if (canvas?.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}

		currentStrokeRef.current = null;
		drawCanvas(null);
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		resizeCanvasToDisplaySize();
		drawCanvas();

		const resizeObserver = new ResizeObserver(() => {
			resizeCanvasToDisplaySize();
			drawCanvas();
		});

		resizeObserver.observe(canvas);

		return () => resizeObserver.disconnect();
	}, []);

	useEffect(() => {
		drawCanvas();
	}, [objects, nonFillOpacity]);

	useEffect(() => {
		currentStrokeRef.current = null;
		drawCanvas(null);
	}, [clearSignal]);

	return (
		<canvas
			ref={canvasRef}
			className={[
				"absolute inset-0 block h-full w-full touch-none",
				isInteractive
					? "pointer-events-auto cursor-crosshair"
					: "pointer-events-none",
			].join(" ")}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={finishStroke}
			onPointerCancel={cancelStroke}
		/>
	);
}
