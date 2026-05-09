import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Point, Stroke } from "../types/geometry";

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

type DrawingCanvasProps = {
	clearSignal: number;
};

function getNextStrokeColor(currentIndex: number) {
	return STROKE_COLORS[(currentIndex + 1) % STROKE_COLORS.length];
}

export function DrawingCanvas({ clearSignal }: DrawingCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const isDrawingRef = useRef(false);
	const previousPointRef = useRef<Point | null>(null);
	const strokeColorIndexRef = useRef(-1);
	const currentStrokeColorRef = useRef(STROKE_COLORS[0]);
	const strokesRef = useRef<Stroke[]>([]);
	const currentStrokePointsRef = useRef<Point[]>([]);
	const [pointerPreview, setPointerPreview] = useState<{
		point: Point;
		color: string;
	} | null>(null);

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
		ctx.lineWidth = 4;
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

		const point = getCanvasPoint(event);

		isDrawingRef.current = true;
		previousPointRef.current = point;
		currentStrokePointsRef.current = [point];

		setPointerPreview({
			point,
			color: currentStrokeColorRef.current,
		});
	}

	function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
		if (!isDrawingRef.current) {
			handlePointerHover(event);
			return;
		}

		const currentPoint = getCanvasPoint(event);
		setPointerPreview({
			point: currentPoint,
			color: currentStrokeColorRef.current,
		});
		currentStrokePointsRef.current.push(currentPoint);
		const previousPoint = previousPointRef.current;

		if (!previousPoint) {
			previousPointRef.current = currentPoint;
			return;
		}

		drawSegment(previousPoint, currentPoint);
		previousPointRef.current = currentPoint;
	}

	function stopDrawing(event?: PointerEvent<HTMLCanvasElement>) {
		const canvas = canvasRef.current;

		if (canvas && event && canvas.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}

		if (currentStrokePointsRef.current.length > 1) {
			strokesRef.current.push({
				color: currentStrokeColorRef.current,
				points: currentStrokePointsRef.current,
			});
		}

		isDrawingRef.current = false;
		previousPointRef.current = null;
		currentStrokePointsRef.current = [];
	}

	function handlePointerHover(event: PointerEvent<HTMLCanvasElement>) {
		if (isDrawingRef.current) return;

		setPointerPreview({
			point: getCanvasPoint(event),
			color: getNextStrokeColor(strokeColorIndexRef.current),
		});
	}

	function handlePointerEnter(event: PointerEvent<HTMLCanvasElement>) {
		setPointerPreview({
			point: getCanvasPoint(event),
			color: getNextStrokeColor(strokeColorIndexRef.current),
		});
	}

	function handlePointerLeave() {
		if (isDrawingRef.current) return;
		setPointerPreview(null);
	}

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

		ctx.fillStyle = "#18181b";
		ctx.fillRect(0, 0, rect.width, rect.height);
	}

	function clearCanvas() {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.fillStyle = "#18181b";
		ctx.fillRect(0, 0, rect.width, rect.height);

		strokesRef.current = [];
		currentStrokePointsRef.current = [];
		previousPointRef.current = null;
		isDrawingRef.current = false;
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		resizeCanvasToDisplaySize();

		const resizeObserver = new ResizeObserver(() => {
			resizeCanvasToDisplaySize();
		});

		resizeObserver.observe(canvas);

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	useEffect(() => {
		if (clearSignal === 0) return;
		clearCanvas();
	}, [clearSignal]);

	return (
		<div className="relative h-full w-full">
			<canvas
				ref={canvasRef}
				className="block h-full w-full touch-none select-none cursor-none"
				onPointerDown={handlePointerDown}
				onPointerUp={stopDrawing}
				onPointerCancel={stopDrawing}
				onPointerEnter={handlePointerEnter}
				onPointerMove={handlePointerMove}
				onPointerLeave={handlePointerLeave}
			/>

			{pointerPreview && (
				<div
					className="pointer-events-none absolute h-6 w-6 rounded-full border"
					style={{
						left: pointerPreview.point.x,
						top: pointerPreview.point.y,
						transform: "translate(-50%, -50%)",
						borderColor: pointerPreview.color,
						backgroundColor: `${pointerPreview.color}33`,
					}}
				/>
			)}
		</div>
	);
}
