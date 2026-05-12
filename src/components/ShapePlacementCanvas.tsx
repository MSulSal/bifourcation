import {
	useEffect,
	useRef,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { createShapeStroke, type ShapeKind } from "../math/shapes";
import type { Point, Stroke } from "../types/geometry";

type ShapePlacementCanvasProps = {
	selectedShape: ShapeKind | null;
	color: string;
	width: number;
	onCommitShape: (stroke: Stroke) => void;
};

type DraftShape = {
	pointerId: number;
	start: Point;
	end: Point;
};

const MIN_SHAPE_RADIUS = 8;

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

function getDraftGeometry(draft: DraftShape) {
	const dx = draft.end.x - draft.start.x;
	const dy = draft.end.y - draft.start.y;
	const radius = Math.hypot(dx, dy);
	const rotation = Math.atan2(dy, dx);

	return {
		center: draft.start,
		radius,
		rotation,
	};
}

function getPreviewStroke({
	selectedShape,
	draft,
	color,
	width,
}: {
	selectedShape: ShapeKind;
	draft: DraftShape;
	color: string;
	width: number;
}) {
	const { center, radius, rotation } = getDraftGeometry(draft);

	const shapeWidth = radius * 2;
	const shapeHeight =
		selectedShape === "line"
			? Math.max(18, radius * 0.3)
			: selectedShape === "sine"
				? Math.max(24, radius)
				: radius * 2;

	return createShapeStroke({
		kind: selectedShape,
		bounds: {
			center,
			width: shapeWidth,
			height: shapeHeight,
		},
		style: {
			color,
			width,
		},
		rotation,
	});
}

export function ShapePlacementCanvas({
	selectedShape,
	color,
	width,
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

	function drawPath(
		points: Point[],
		strokeColor: string,
		strokeWidth: number,
	) {
		const canvas = canvasRef.current;
		if (!canvas || points.length < 2) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.save();
		ctx.strokeStyle = strokeColor;
		ctx.lineWidth = strokeWidth;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.setLineDash([]);

		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);

		for (const point of points.slice(1)) {
			ctx.lineTo(point.x, point.y);
		}

		ctx.stroke();
		ctx.restore();
	}

	function drawDraftGuides(draft: DraftShape) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const { radius } = getDraftGeometry(draft);

		ctx.save();

		ctx.strokeStyle = "rgba(244, 244, 245, 0.38)";
		ctx.fillStyle = "rgba(244, 244, 245, 0.82)";
		ctx.lineWidth = 1;
		ctx.setLineDash([5, 7]);

		ctx.beginPath();
		ctx.moveTo(draft.start.x, draft.start.y);
		ctx.lineTo(draft.end.x, draft.end.y);
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(
			draft.start.x,
			draft.start.y,
			Math.max(radius, MIN_SHAPE_RADIUS),
			0,
			Math.PI * 2,
		);
		ctx.stroke();

		ctx.setLineDash([]);

		ctx.beginPath();
		ctx.arc(draft.start.x, draft.start.y, 3.5, 0, Math.PI * 2);
		ctx.fill();

		ctx.beginPath();
		ctx.arc(draft.end.x, draft.end.y, 3.5, 0, Math.PI * 2);
		ctx.fill();

		ctx.restore();
	}

	function drawPreview(nextDraft = draftRef.current) {
		clearPreview();

		if (!nextDraft || !selectedShape) return;

		const stroke = getPreviewStroke({
			selectedShape,
			draft: nextDraft,
			color,
			width,
		});

		drawPath(stroke.points, color, Math.max(2, width));
		drawDraftGuides(nextDraft);
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

		const { radius } = getDraftGeometry(finalDraft);

		draftRef.current = null;

		if (canvas.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}

		clearPreview();

		if (radius < MIN_SHAPE_RADIUS) return;

		const committedStroke = getPreviewStroke({
			selectedShape,
			draft: finalDraft,
			color,
			width,
		});

		onCommitShape(committedStroke);
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
	}, [selectedShape, color, width]);

	useEffect(() => {
		if (!selectedShape) {
			draftRef.current = null;
			clearPreview();
			return;
		}

		drawPreview();
	}, [selectedShape, color, width]);

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
