import {
	useEffect,
	useRef,
	type PointerEvent as ReactPointerEvent,
} from "react";
import {
	normalizeRect,
	rotateShape,
	shapeObjectToStroke,
	translateShape,
	updateLineShapeFromEndpoints,
} from "../math/shapes";
import type { DrawingObject, Point, ShapeObject } from "../types/geometry";

type ObjectTransformCanvasProps = {
	objects: DrawingObject[];
	selectedObjectId: string | null;
	enabled: boolean;
	onSelectObject: (id: string | null) => void;
	onBeginEdit: () => void;
	onChangeShape: (
		id: string,
		updater: (shape: ShapeObject) => ShapeObject,
	) => void;
	onEndEdit: () => void;
	onContextMenuRequest: (
		clientX: number,
		clientY: number,
		objectId: string | null,
	) => void;
};

type BoxHandleName = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type HandleName = BoxHandleName | "rotate" | "line-start" | "line-end";

type DragState =
	| {
			type: "move";
			pointerId: number;
			objectId: string;
			startPointer: Point;
			startShape: ShapeObject;
	  }
	| {
			type: "resize";
			pointerId: number;
			objectId: string;
			handle: BoxHandleName;
			startShape: ShapeObject;
	  }
	| {
			type: "line-endpoint";
			pointerId: number;
			objectId: string;
			handle: "line-start" | "line-end";
			startShape: ShapeObject;
	  }
	| {
			type: "rotate";
			pointerId: number;
			objectId: string;
			center: Point;
			startAngle: number;
			startRotation: number;
	  };

const HANDLE_SIZE = 10;
const HIT_RADIUS = 9;
const ROTATE_HANDLE_OFFSET = 34;
const MIN_SIZE = 4;

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

function getShapeObject(objects: DrawingObject[], id: string | null) {
	if (!id) return null;

	const object = objects.find(item => item.id === id);

	if (!object || object.type !== "shape") return null;

	return object;
}

function getShapeCenter(shape: ShapeObject): Point {
	const bounds = normalizeRect(shape.bounds);

	return {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
}

function getBasis(rotation: number) {
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);

	return {
		ux: { x: cos, y: sin },
		uy: { x: -sin, y: cos },
	};
}

function dot(a: Point, b: Point) {
	return a.x * b.x + a.y * b.y;
}

function add(a: Point, b: Point): Point {
	return {
		x: a.x + b.x,
		y: a.y + b.y,
	};
}

function subtract(a: Point, b: Point): Point {
	return {
		x: a.x - b.x,
		y: a.y - b.y,
	};
}

function scale(point: Point, amount: number): Point {
	return {
		x: point.x * amount,
		y: point.y * amount,
	};
}

function distance(a: Point, b: Point) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function localToWorld(shape: ShapeObject, local: Point): Point {
	const center = getShapeCenter(shape);
	const { ux, uy } = getBasis(shape.rotation);

	return add(center, add(scale(ux, local.x), scale(uy, local.y)));
}

function worldToLocal(shape: ShapeObject, point: Point): Point {
	const center = getShapeCenter(shape);
	const { ux, uy } = getBasis(shape.rotation);
	const delta = subtract(point, center);

	return {
		x: dot(delta, ux),
		y: dot(delta, uy),
	};
}

function getLocalBoxPoints(shape: ShapeObject) {
	const bounds = normalizeRect(shape.bounds);
	const halfWidth = bounds.width / 2;
	const halfHeight = bounds.height / 2;

	return {
		nw: { x: -halfWidth, y: -halfHeight },
		n: { x: 0, y: -halfHeight },
		ne: { x: halfWidth, y: -halfHeight },
		e: { x: halfWidth, y: 0 },
		se: { x: halfWidth, y: halfHeight },
		s: { x: 0, y: halfHeight },
		sw: { x: -halfWidth, y: halfHeight },
		w: { x: -halfWidth, y: 0 },
	};
}

function getOppositeHandle(handle: BoxHandleName): BoxHandleName {
	const opposites: Record<BoxHandleName, BoxHandleName> = {
		nw: "se",
		n: "s",
		ne: "sw",
		e: "w",
		se: "nw",
		s: "n",
		sw: "ne",
		w: "e",
	};

	return opposites[handle];
}

function getBoxHandlePoints(shape: ShapeObject) {
	const local = getLocalBoxPoints(shape);
	const center = getShapeCenter(shape);
	const rotateHandle = localToWorld(shape, {
		x: 0,
		y: -normalizeRect(shape.bounds).height / 2 - ROTATE_HANDLE_OFFSET,
	});

	return {
		nw: localToWorld(shape, local.nw),
		n: localToWorld(shape, local.n),
		ne: localToWorld(shape, local.ne),
		e: localToWorld(shape, local.e),
		se: localToWorld(shape, local.se),
		s: localToWorld(shape, local.s),
		sw: localToWorld(shape, local.sw),
		w: localToWorld(shape, local.w),
		rotate: rotateHandle,
		center,
	};
}

function getLineEndpoints(shape: ShapeObject) {
	const stroke = shapeObjectToStroke(shape);

	return {
		start: stroke.points[0],
		end: stroke.points[stroke.points.length - 1],
	};
}

function getLineHandlePoints(shape: ShapeObject) {
	const endpoints = getLineEndpoints(shape);
	const center = {
		x: (endpoints.start.x + endpoints.end.x) / 2,
		y: (endpoints.start.y + endpoints.end.y) / 2,
	};
	const normal = {
		x: -Math.sin(shape.rotation),
		y: Math.cos(shape.rotation),
	};

	return {
		"line-start": endpoints.start,
		"line-end": endpoints.end,
		rotate: add(center, scale(normal, -ROTATE_HANDLE_OFFSET)),
		center,
	};
}

function getAngle(center: Point, point: Point) {
	return Math.atan2(point.y - center.y, point.x - center.x);
}

function hitPoint(point: Point, target: Point) {
	return distance(point, target) <= HIT_RADIUS;
}

function hitHandle(shape: ShapeObject, point: Point): HandleName | null {
	if (shape.kind === "line") {
		const handles = getLineHandlePoints(shape);

		if (hitPoint(point, handles["line-start"])) return "line-start";
		if (hitPoint(point, handles["line-end"])) return "line-end";
		if (hitPoint(point, handles.rotate)) return "rotate";

		return null;
	}

	const handles = getBoxHandlePoints(shape);

	for (const handle of [
		"nw",
		"n",
		"ne",
		"e",
		"se",
		"s",
		"sw",
		"w",
		"rotate",
	] as const) {
		if (hitPoint(point, handles[handle])) return handle;
	}

	return null;
}

function pointNearSegment(
	point: Point,
	start: Point,
	end: Point,
	radius: number,
) {
	const segment = subtract(end, start);
	const lengthSquared = segment.x * segment.x + segment.y * segment.y;

	if (lengthSquared === 0) return distance(point, start) <= radius;

	const t = Math.max(
		0,
		Math.min(1, dot(subtract(point, start), segment) / lengthSquared),
	);

	const projected = add(start, scale(segment, t));

	return distance(point, projected) <= radius;
}

function containsShapePoint(shape: ShapeObject, point: Point) {
	if (shape.kind === "line") {
		const endpoints = getLineEndpoints(shape);

		return pointNearSegment(
			point,
			endpoints.start,
			endpoints.end,
			Math.max(10, shape.width + 5),
		);
	}

	const bounds = normalizeRect(shape.bounds);
	const local = worldToLocal(shape, point);

	return (
		local.x >= -bounds.width / 2 - HIT_RADIUS &&
		local.x <= bounds.width / 2 + HIT_RADIUS &&
		local.y >= -bounds.height / 2 - HIT_RADIUS &&
		local.y <= bounds.height / 2 + HIT_RADIUS
	);
}

function getShapeAtPoint(objects: DrawingObject[], point: Point) {
	for (const object of [...objects].reverse()) {
		if (object.type !== "shape") continue;
		if (containsShapePoint(object.shape, point)) return object;
	}

	return null;
}

function getResizedShape(
	startShape: ShapeObject,
	handle: BoxHandleName,
	point: Point,
): ShapeObject {
	const startBounds = normalizeRect(startShape.bounds);
	const local = getLocalBoxPoints(startShape);
	const anchorHandle = getOppositeHandle(handle);
	const anchorLocal = local[anchorHandle];
	const handleLocal = local[handle];
	const anchorWorld = localToWorld(startShape, anchorLocal);
	const { ux, uy } = getBasis(startShape.rotation);
	const pointerVector = subtract(point, anchorWorld);

	const dx0 = handleLocal.x - anchorLocal.x;
	const dy0 = handleLocal.y - anchorLocal.y;

	const projectedX = dot(pointerVector, ux);
	const projectedY = dot(pointerVector, uy);

	let nextWidth = startBounds.width;
	let nextHeight = startBounds.height;
	let center = getShapeCenter(startShape);
	let flipX = startShape.flipX;
	let flipY = startShape.flipY;

	if (handle === "e" || handle === "w") {
		nextWidth = Math.max(MIN_SIZE, Math.abs(projectedX));
		center = add(anchorWorld, scale(ux, projectedX / 2));
		flipX = startShape.flipX !== projectedX * dx0 < 0;
	} else if (handle === "n" || handle === "s") {
		nextHeight = Math.max(MIN_SIZE, Math.abs(projectedY));
		center = add(anchorWorld, scale(uy, projectedY / 2));
		flipY = startShape.flipY !== projectedY * dy0 < 0;
	} else {
		nextWidth = Math.max(MIN_SIZE, Math.abs(projectedX));
		nextHeight = Math.max(MIN_SIZE, Math.abs(projectedY));
		center = add(
			anchorWorld,
			add(scale(ux, projectedX / 2), scale(uy, projectedY / 2)),
		);
		flipX = startShape.flipX !== projectedX * dx0 < 0;
		flipY = startShape.flipY !== projectedY * dy0 < 0;
	}

	return {
		...startShape,
		bounds: {
			x: center.x - nextWidth / 2,
			y: center.y - nextHeight / 2,
			width: nextWidth,
			height: nextHeight,
		},
		flipX,
		flipY,
	};
}

export function ObjectTransformCanvas({
	objects,
	selectedObjectId,
	enabled,
	onSelectObject,
	onBeginEdit,
	onChangeShape,
	onEndEdit,
	onContextMenuRequest,
}: ObjectTransformCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const dragRef = useRef<DragState | null>(null);

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

	function drawHandle(ctx: CanvasRenderingContext2D, point: Point) {
		ctx.beginPath();
		ctx.rect(
			point.x - HANDLE_SIZE / 2,
			point.y - HANDLE_SIZE / 2,
			HANDLE_SIZE,
			HANDLE_SIZE,
		);
		ctx.fill();
		ctx.stroke();
	}

	function drawSelection() {
		clearCanvas();

		if (!enabled) return;

		const selectedObject = getShapeObject(objects, selectedObjectId);

		if (!selectedObject) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const shape = selectedObject.shape;

		ctx.save();
		ctx.strokeStyle = "rgba(244, 244, 245, 0.86)";
		ctx.fillStyle = "#f4f4f5";
		ctx.lineWidth = 1;
		ctx.setLineDash([6, 5]);

		if (shape.kind === "line") {
			const handles = getLineHandlePoints(shape);

			ctx.beginPath();
			ctx.moveTo(handles["line-start"].x, handles["line-start"].y);
			ctx.lineTo(handles["line-end"].x, handles["line-end"].y);
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(handles.center.x, handles.center.y);
			ctx.lineTo(handles.rotate.x, handles.rotate.y);
			ctx.stroke();

			ctx.setLineDash([]);
			ctx.strokeStyle = "#18181b";
			ctx.lineWidth = 2;

			drawHandle(ctx, handles["line-start"]);
			drawHandle(ctx, handles["line-end"]);
			drawHandle(ctx, handles.rotate);

			ctx.restore();
			return;
		}

		const handles = getBoxHandlePoints(shape);

		ctx.beginPath();
		ctx.moveTo(handles.nw.x, handles.nw.y);
		ctx.lineTo(handles.ne.x, handles.ne.y);
		ctx.lineTo(handles.se.x, handles.se.y);
		ctx.lineTo(handles.sw.x, handles.sw.y);
		ctx.closePath();
		ctx.stroke();

		ctx.beginPath();
		ctx.moveTo(handles.n.x, handles.n.y);
		ctx.lineTo(handles.rotate.x, handles.rotate.y);
		ctx.stroke();

		ctx.setLineDash([]);
		ctx.strokeStyle = "#18181b";
		ctx.lineWidth = 2;

		for (const handle of [
			"nw",
			"n",
			"ne",
			"e",
			"se",
			"s",
			"sw",
			"w",
			"rotate",
		] as const) {
			drawHandle(ctx, handles[handle]);
		}

		ctx.restore();
	}

	function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!enabled || event.button !== 0) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const point = getPointerPoint(event, canvas);
		let selectedObject = getShapeObject(objects, selectedObjectId);

		if (selectedObject) {
			const handle = hitHandle(selectedObject.shape, point);

			if (handle) {
				event.preventDefault();
				canvas.setPointerCapture(event.pointerId);
				onBeginEdit();

				if (handle === "rotate") {
					const center = getShapeCenter(selectedObject.shape);

					dragRef.current = {
						type: "rotate",
						pointerId: event.pointerId,
						objectId: selectedObject.id,
						center,
						startAngle: getAngle(center, point),
						startRotation: selectedObject.shape.rotation,
					};

					return;
				}

				if (handle === "line-start" || handle === "line-end") {
					dragRef.current = {
						type: "line-endpoint",
						pointerId: event.pointerId,
						objectId: selectedObject.id,
						handle,
						startShape: selectedObject.shape,
					};

					return;
				}

				dragRef.current = {
					type: "resize",
					pointerId: event.pointerId,
					objectId: selectedObject.id,
					handle,
					startShape: selectedObject.shape,
				};

				return;
			}
		}

		selectedObject = getShapeAtPoint(objects, point);

		if (!selectedObject) {
			onSelectObject(null);
			return;
		}

		onSelectObject(selectedObject.id);

		event.preventDefault();
		canvas.setPointerCapture(event.pointerId);
		onBeginEdit();

		dragRef.current = {
			type: "move",
			pointerId: event.pointerId,
			objectId: selectedObject.id,
			startPointer: point,
			startShape: selectedObject.shape,
		};
	}

	function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!enabled) return;

		const canvas = canvasRef.current;
		const drag = dragRef.current;

		if (!canvas || !drag || drag.pointerId !== event.pointerId) return;

		const point = getPointerPoint(event, canvas);

		if (drag.type === "move") {
			const dx = point.x - drag.startPointer.x;
			const dy = point.y - drag.startPointer.y;

			onChangeShape(drag.objectId, () =>
				translateShape(drag.startShape, dx, dy),
			);

			return;
		}

		if (drag.type === "resize") {
			onChangeShape(drag.objectId, () =>
				getResizedShape(drag.startShape, drag.handle, point),
			);

			return;
		}

		if (drag.type === "line-endpoint") {
			const endpoints = getLineEndpoints(drag.startShape);

			onChangeShape(drag.objectId, () =>
				drag.handle === "line-start"
					? updateLineShapeFromEndpoints(
							drag.startShape,
							point,
							endpoints.end,
						)
					: updateLineShapeFromEndpoints(
							drag.startShape,
							endpoints.start,
							point,
						),
			);

			return;
		}

		const angle = getAngle(drag.center, point);
		const nextRotation = drag.startRotation + angle - drag.startAngle;

		onChangeShape(drag.objectId, shape => rotateShape(shape, nextRotation));
	}

	function finishDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
		const canvas = canvasRef.current;
		const drag = dragRef.current;

		if (canvas?.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}

		if (drag && drag.pointerId === event.pointerId) {
			onEndEdit();
		}

		dragRef.current = null;
	}

	function handleContextMenu(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!enabled) return;

		event.preventDefault();

		const canvas = canvasRef.current;
		if (!canvas) return;

		const point = getPointerPoint(event, canvas);
		const object = getShapeAtPoint(objects, point);

		if (object) {
			onSelectObject(object.id);
		}

		onContextMenuRequest(event.clientX, event.clientY, object?.id ?? null);
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		resizeCanvasToDisplaySize();
		drawSelection();

		const resizeObserver = new ResizeObserver(() => {
			resizeCanvasToDisplaySize();
			drawSelection();
		});

		resizeObserver.observe(canvas);

		return () => resizeObserver.disconnect();
	});

	useEffect(() => {
		drawSelection();
	}, [objects, selectedObjectId, enabled]);

	return (
		<canvas
			ref={canvasRef}
			className={[
				"absolute inset-0 z-30 block h-full w-full touch-none",
				enabled
					? "pointer-events-auto cursor-move"
					: "pointer-events-none",
			].join(" ")}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={finishDrag}
			onPointerCancel={finishDrag}
			onContextMenu={handleContextMenu}
		/>
	);
}
