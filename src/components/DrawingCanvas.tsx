import { useEffect, useRef, type PointerEvent } from "react";
import type { Point } from "../types/geometry";

const STROKE_COLORS = [
	"#e84d3d", // red
	"#2f80ed", // blue
	"#27ae60", // green
	"#f2c94c", // yellow
	"#9b51e0", // purple
	"#f2994a", // orange
	"#56ccf2", // light blue
	"#eb5757", // coral
];

export function DrawingCanvas() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const isDrawingRef = useRef(false);
	const previousPointRef = useRef<Point | null>(null);
	const strokeColorIndexRef = useRef(-1);
	const currentStrokeColorRef = useRef(STROKE_COLORS[0]);

	function getCanvasPoint(event: PointerEvent): Point {
		const canvas = canvasRef.current;
		if (!canvas) return { x: 0, y: 0 };

		const rect = canvas.getBoundingClientRect();

		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		};
	}

	function drawSegment(from: Point, to: Point) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.strokeStyle = currentStrokeColorRef.current;
		ctx.lineWidth = 5;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
	}

	function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		canvas.setPointerCapture(event.pointerId);

		strokeColorIndexRef.current =
			(strokeColorIndexRef.current + 1) % STROKE_COLORS.length;

		currentStrokeColorRef.current =
			STROKE_COLORS[strokeColorIndexRef.current];
		isDrawingRef.current = true;
		previousPointRef.current = getCanvasPoint(event);
	}

	function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
		if (!isDrawingRef.current) return;

		const currentPoint = getCanvasPoint(event);
		const previousPoint = previousPointRef.current;

		if (!previousPoint) {
			previousPointRef.current = currentPoint;
			return;
		}

		drawSegment(previousPoint, currentPoint);
		previousPointRef.current = currentPoint;
	}

	function stopDrawing() {
		isDrawingRef.current = false;
		previousPointRef.current = null;
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();

		canvas.width = rect.width;
		canvas.height = rect.height;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.fillStyle = "#18181b";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className="h-full w-full touch-none"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={stopDrawing}
			onPointerCancel={stopDrawing}
		/>
	);
}
