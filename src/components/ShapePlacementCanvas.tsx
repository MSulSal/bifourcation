import {
	useEffect,
	useRef,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { createShapeObject, renderDrawingObject } from "../math/shapes";
import type {
	DrawingObject,
	Point,
	ShapeFill,
	ShapeKind,
	ShapeObject,
} from "../types/geometry";

type ShapePlacementCanvasProps = {
	selectedShape: ShapeKind | null;
	color: string;
	width: number;
	fill: ShapeFill | null;
	onCommitShape: (shape: ShapeObject) => void;
};

type DraftShape = {
	pointerId: number;
	start: Point;
	end: Point;
};

const MIN_DRAG_DISTANCE = 8;

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

function getDraftDistance(draft: DraftShape) {
	return Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y);
}

export function ShapePlacementCanvas({
	selectedShape,
	color,
	width,
	fill,
	onCommitShape,
}: ShapePlacementCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const draftRef = useRef<DraftShape | null>(null);

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

	function clearPreview() {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, rect.width, rect.height);
	}

	function drawGuides(draft: DraftShape) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.save();
		ctx.strokeStyle = "rgba(244, 244, 245, 0.4)";
		ctx.fillStyle = "rgba(244, 244, 245, 0.86)";
		ctx.lineWidth = 1;
		ctx.setLineDash([5, 7]);

		ctx.beginPath();
		ctx.moveTo(draft.start.x, draft.start.y);
		ctx.lineTo(draft.end.x, draft.end.y);
		ctx.stroke();

		ctx.strokeRect(
			draft.start.x,
			draft.start.y,
			draft.end.x - draft.start.x,
			draft.end.y - draft.start.y,
		);

		ctx.setLineDash([]);

		for (const point of [draft.start, draft.end]) {
			ctx.beginPath();
			ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.restore();
	}

	function createPreviewShape(draft: DraftShape) {
		if (!selectedShape) return null;

		return createShapeObject({
			kind: selectedShape,
			start: draft.start,
			end: draft.end,
			color,
			width,
			fill,
		});
	}

	function drawPreview(nextDraft = draftRef.current) {
		clearPreview();

		if (!nextDraft || !selectedShape) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const shape = createPreviewShape(nextDraft);
		if (!shape) return;

		const previewObject: DrawingObject = {
			type: "shape",
			id: shape.id,
			shape,
		};

		renderDrawingObject(ctx, previewObject);
		drawGuides(nextDraft);
	}

	function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!selectedShape || event.button !== 0) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		event.preventDefault();

		const point = getPointerPoint(event, canvas);

		canvas.setPointerCapture(event.pointerId);

		const nextDraft = {
			pointerId: event.pointerId,
			start: point,
			end: point,
		};

		draftRef.current = nextDraft;
		drawPreview(nextDraft);
	}

	function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!selectedShape) return;

		const canvas = canvasRef.current;
		const draft = draftRef.current;

		if (!canvas || !draft || draft.pointerId !== event.pointerId) return;

		const nextDraft = {
			...draft,
			end: getPointerPoint(event, canvas),
		};

		draftRef.current = nextDraft;
		drawPreview(nextDraft);
	}

	function finishDraft(event: ReactPointerEvent<HTMLCanvasElement>) {
		const canvas = canvasRef.current;
		const draft = draftRef.current;

		if (
			!canvas ||
			!selectedShape ||
			!draft ||
			draft.pointerId !== event.pointerId
		) {
			return;
		}

		const finalDraft = {
			...draft,
			end: getPointerPoint(event, canvas),
		};

		draftRef.current = null;

		if (canvas.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}

		clearPreview();

		if (getDraftDistance(finalDraft) < MIN_DRAG_DISTANCE) return;

		const shape = createPreviewShape(finalDraft);

		if (shape) {
			onCommitShape(shape);
		}
	}

	function cancelDraft(event: ReactPointerEvent<HTMLCanvasElement>) {
		const canvas = canvasRef.current;

		if (canvas?.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}

		draftRef.current = null;
		clearPreview();
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		resizeCanvasToDisplaySize();

		const resizeObserver = new ResizeObserver(() => {
			resizeCanvasToDisplaySize();
			drawPreview();
		});

		resizeObserver.observe(canvas);

		return () => resizeObserver.disconnect();
	}, []);

	useEffect(() => {
		if (!selectedShape) {
			draftRef.current = null;
			clearPreview();
			return;
		}

		drawPreview();
	}, [selectedShape, color, width, fill]);

	return (
		<canvas
			ref={canvasRef}
			className={[
				"absolute inset-0 z-20 block h-full w-full touch-none",
				selectedShape
					? "pointer-events-auto cursor-crosshair"
					: "pointer-events-none",
			].join(" ")}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={finishDraft}
			onPointerCancel={cancelDraft}
		/>
	);
}
