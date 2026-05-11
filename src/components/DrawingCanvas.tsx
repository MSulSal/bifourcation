import { useEffect, useRef } from "react";
import type { Dispatch, PointerEvent, SetStateAction } from "react";
import type { Stroke } from "../types/geometry";
import type { Point } from "../types/geometry";

type DrawingCanvasProps = {
	strokes: Stroke[];
	clearSignal: number;
	penColor: string;
	penWidth: number;
	onStrokesChange: Dispatch<SetStateAction<Stroke[]>>;
};

export function DrawingCanvas({
	strokes,
	clearSignal,
	penColor,
	penWidth,
	onStrokesChange,
}: DrawingCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const activeStrokeRef = useRef<Stroke | null>(null);
	const activePointerIdRef = useRef<number | null>(null);

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

	function clearCanvas() {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, rect.width, rect.height);
	}

	function drawStroke(stroke: Stroke) {
		const canvas = canvasRef.current;
		if (!canvas || stroke.points.length === 0) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.strokeStyle = stroke.color;
		ctx.fillStyle = stroke.color;
		ctx.lineWidth = stroke.width;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		if (stroke.points.length === 1) {
			const point = stroke.points[0];

			ctx.beginPath();
			ctx.arc(
				point.x,
				point.y,
				Math.max(1, stroke.width / 2),
				0,
				Math.PI * 2,
			);
			ctx.fill();
			return;
		}

		ctx.beginPath();
		ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

		for (const point of stroke.points.slice(1)) {
			ctx.lineTo(point.x, point.y);
		}

		ctx.stroke();
	}

	function redrawCanvas() {
		clearCanvas();

		for (const stroke of strokes) {
			drawStroke(stroke);
		}
	}

	function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>): Point {
		const canvas = canvasRef.current;

		if (!canvas) {
			return {
				x: event.clientX,
				y: event.clientY,
			};
		}

		const rect = canvas.getBoundingClientRect();

		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		};
	}

	function drawSegment(from: Point, to: Point, color: string, width: number) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
	}

	function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
		if (event.button !== 0) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const point = getCanvasPoint(event);

		activePointerIdRef.current = event.pointerId;
		activeStrokeRef.current = {
			color: penColor,
			width: penWidth,
			points: [point],
		};

		canvas.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
		if (activePointerIdRef.current !== event.pointerId) return;

		const activeStroke = activeStrokeRef.current;
		if (!activeStroke) return;

		const point = getCanvasPoint(event);
		const previousPoint =
			activeStroke.points[activeStroke.points.length - 1];

		activeStroke.points.push(point);

		drawSegment(
			previousPoint,
			point,
			activeStroke.color,
			activeStroke.width,
		);
	}

	function finishStroke(event: PointerEvent<HTMLCanvasElement>) {
		if (activePointerIdRef.current !== event.pointerId) return;

		const canvas = canvasRef.current;
		const activeStroke = activeStrokeRef.current;

		if (canvas?.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}

		activePointerIdRef.current = null;
		activeStrokeRef.current = null;

		if (!activeStroke || activeStroke.points.length < 2) return;

		onStrokesChange(currentStrokes => [...currentStrokes, activeStroke]);
	}

	useEffect(() => {
		resizeCanvasToDisplaySize();
		redrawCanvas();

		const canvas = canvasRef.current;
		if (!canvas) return;

		const resizeObserver = new ResizeObserver(() => {
			resizeCanvasToDisplaySize();
			redrawCanvas();
		});

		resizeObserver.observe(canvas);

		return () => {
			resizeObserver.disconnect();
		};
	}, [strokes, clearSignal]);

	return (
		<canvas
			ref={canvasRef}
			className="block h-full w-full touch-none"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={finishStroke}
			onPointerCancel={finishStroke}
			onPointerLeave={finishStroke}
		/>
	);
}
