import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Point, Stroke } from "../types/geometry";

type DrawingCanvasProps = {
	clearSignal: number;
	penColor: string;
	penWidth: number;
	onStrokesChange: (strokes: Stroke[]) => void;
};

export function DrawingCanvas({
	clearSignal,
	penColor,
	penWidth,
	onStrokesChange,
}: DrawingCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	const isDrawingRef = useRef(false);
	const previousPointRef = useRef<Point | null>(null);

	const strokesRef = useRef<Stroke[]>([]);
	const currentStrokePointsRef = useRef<Point[]>([]);

	const currentStrokeColorRef = useRef(penColor);
	const currentStrokeWidthRef = useRef(penWidth);

	const [pointerPreview, setPointerPreview] = useState<{
		point: Point;
		color: string;
		width: number;
	} | null>(null);

	useEffect(() => {
		if (isDrawingRef.current) return;

		currentStrokeColorRef.current = penColor;
		currentStrokeWidthRef.current = penWidth;

		setPointerPreview(preview => {
			if (!preview) return preview;

			return {
				...preview,
				color: penColor,
				width: penWidth,
			};
		});
	}, [penColor, penWidth]);

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

	function emitStrokesChange() {
		onStrokesChange(
			strokesRef.current.map(stroke => ({
				color: stroke.color,
				width: stroke.width,
				points: [...stroke.points],
			})),
		);
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

		emitStrokesChange();
	}

	function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>): Point {
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
		ctx.lineWidth = currentStrokeWidthRef.current;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
	}

	function handlePointerHover(event: PointerEvent<HTMLCanvasElement>) {
		if (isDrawingRef.current) return;

		setPointerPreview({
			point: getCanvasPoint(event),
			color: penColor,
			width: penWidth,
		});
	}

	function handlePointerEnter(event: PointerEvent<HTMLCanvasElement>) {
		handlePointerHover(event);
	}

	function handlePointerLeave() {
		if (isDrawingRef.current) return;
		setPointerPreview(null);
	}

	function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		canvas.setPointerCapture(event.pointerId);

		currentStrokeColorRef.current = penColor;
		currentStrokeWidthRef.current = penWidth;

		const point = getCanvasPoint(event);

		isDrawingRef.current = true;
		previousPointRef.current = point;
		currentStrokePointsRef.current = [point];

		setPointerPreview({
			point,
			color: currentStrokeColorRef.current,
			width: currentStrokeWidthRef.current,
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
			width: currentStrokeWidthRef.current,
		});

		const previousPoint = previousPointRef.current;

		if (!previousPoint) {
			previousPointRef.current = currentPoint;
			currentStrokePointsRef.current.push(currentPoint);
			return;
		}

		currentStrokePointsRef.current.push(currentPoint);
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
				width: currentStrokeWidthRef.current,
				points: currentStrokePointsRef.current,
			});

			emitStrokesChange();
		}

		currentStrokePointsRef.current = [];
		isDrawingRef.current = false;
		previousPointRef.current = null;
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
				onPointerEnter={handlePointerEnter}
				onPointerMove={handlePointerMove}
				onPointerLeave={handlePointerLeave}
				onPointerDown={handlePointerDown}
				onPointerUp={stopDrawing}
				onPointerCancel={stopDrawing}
			/>

			{pointerPreview && (
				<div
					className="pointer-events-none absolute rounded-full border"
					style={{
						left: pointerPreview.point.x,
						top: pointerPreview.point.y,
						width: Math.max(18, pointerPreview.width * 2.5),
						height: Math.max(18, pointerPreview.width * 2.5),
						transform: "translate(-50%, -50%)",
						borderColor: pointerPreview.color,
						backgroundColor: `${pointerPreview.color}33`,
					}}
				/>
			)}
		</div>
	);
}
