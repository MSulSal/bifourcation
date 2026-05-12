import {
	useEffect,
	useRef,
	type PointerEvent as ReactPointerEvent,
} from "react";
import {
	getDrawingObjectBounds,
	resizeShapeFromBounds,
	rotateShape,
	translateShape,
} from "../math/shapes";
import type {
	DrawingObject,
	Point,
	Rect,
	ShapeObject,
} from "../types/geometry";

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
};

type HandleName = "nw" | "ne" | "sw" | "se" | "rotate";

type DragState =
	| {
			type: "move";
			pointerId: number;
			objectId: string;
			startPointer: Point;
			startBounds: Rect;
	  }
	| {
			type: "resize";
			pointerId: number;
			objectId: string;
			handle: Exclude<HandleName, "rotate">;
			startPointer: Point;
			startBounds: Rect;
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
const ROTATE_HANDLE_OFFSET = 30;

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

function containsPoint(bounds: Rect, point: Point) {
	return (
		point.x >= bounds.x &&
		point.x <= bounds.x + bounds.width &&
		point.y >= bounds.y &&
		point.y <= bounds.y + bounds.height
	);
}

function getCenter(bounds: Rect): Point {
	return {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
}

function getShapeObject(objects: DrawingObject[], id: string | null) {
	if (!id) return null;

	const object = objects.find(item => item.id === id);

	if (!object || object.type !== "shape") return null;

	return object;
}

function getHandleRects(bounds: Rect) {
	const half = HANDLE_SIZE / 2;
	const rotatePoint = {
		x: bounds.x + bounds.width / 2,
		y: bounds.y - ROTATE_HANDLE_OFFSET,
	};

	return {
		nw: {
			x: bounds.x - half,
			y: bounds.y - half,
			width: HANDLE_SIZE,
			height: HANDLE_SIZE,
		},
		ne: {
			x: bounds.x + bounds.width - half,
			y: bounds.y - half,
			width: HANDLE_SIZE,
			height: HANDLE_SIZE,
		},
		sw: {
			x: bounds.x - half,
			y: bounds.y + bounds.height - half,
			width: HANDLE_SIZE,
			height: HANDLE_SIZE,
		},
		se: {
			x: bounds.x + bounds.width - half,
			y: bounds.y + bounds.height - half,
			width: HANDLE_SIZE,
			height: HANDLE_SIZE,
		},
		rotate: {
			x: rotatePoint.x - half,
			y: rotatePoint.y - half,
			width: HANDLE_SIZE,
			height: HANDLE_SIZE,
		},
	};
}

function hitHandle(bounds: Rect, point: Point): HandleName | null {
	const handles = getHandleRects(bounds);

	for (const [name, rect] of Object.entries(handles)) {
		if (containsPoint(rect, point)) {
			return name as HandleName;
		}
	}

	return null;
}

function resizeBoundsFromHandle(
	startBounds: Rect,
	handle: Exclude<HandleName, "rotate">,
	point: Point,
): Rect {
	const left = handle === "nw" || handle === "sw" ? point.x : startBounds.x;
	const right =
		handle === "ne" || handle === "se"
			? point.x
			: startBounds.x + startBounds.width;
	const top = handle === "nw" || handle === "ne" ? point.y : startBounds.y;
	const bottom =
		handle === "sw" || handle === "se"
			? point.y
			: startBounds.y + startBounds.height;

	return {
		x: Math.min(left, right),
		y: Math.min(top, bottom),
		width: Math.abs(right - left),
		height: Math.abs(bottom - top),
	};
}

function getAngle(center: Point, point: Point) {
	return Math.atan2(point.y - center.y, point.x - center.x);
}

export function ObjectTransformCanvas({
	objects,
	selectedObjectId,
	enabled,
	onSelectObject,
	onBeginEdit,
	onChangeShape,
	onEndEdit,
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

	function drawSelection() {
		clearCanvas();

		if (!enabled) return;

		const selectedObject = getShapeObject(objects, selectedObjectId);

		if (!selectedObject) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const bounds = getDrawingObjectBounds(selectedObject);
		const center = getCenter(bounds);
		const handles = getHandleRects(bounds);

		ctx.save();

		ctx.strokeStyle = "rgba(244, 244, 245, 0.86)";
		ctx.lineWidth = 1;
		ctx.setLineDash([6, 5]);
		ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

		ctx.setLineDash([]);
		ctx.beginPath();
		ctx.moveTo(center.x, bounds.y);
		ctx.lineTo(center.x, handles.rotate.y + HANDLE_SIZE / 2);
		ctx.stroke();

		ctx.fillStyle = "#f4f4f5";
		ctx.strokeStyle = "#18181b";
		ctx.lineWidth = 2;

		for (const rect of Object.values(handles)) {
			ctx.beginPath();
			ctx.rect(rect.x, rect.y, rect.width, rect.height);
			ctx.fill();
			ctx.stroke();
		}

		ctx.restore();
	}

	function selectObjectAtPoint(point: Point) {
		for (const object of [...objects].reverse()) {
			if (object.type !== "shape") continue;

			const bounds = getDrawingObjectBounds(object);

			if (containsPoint(bounds, point)) {
				onSelectObject(object.id);
				return object;
			}
		}

		onSelectObject(null);
		return null;
	}

	function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
		if (!enabled || event.button !== 0) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const point = getPointerPoint(event, canvas);
		let selectedObject = getShapeObject(objects, selectedObjectId);

		if (selectedObject) {
			const selectedBounds = getDrawingObjectBounds(selectedObject);
			const handle = hitHandle(selectedBounds, point);

			if (handle) {
				event.preventDefault();
				canvas.setPointerCapture(event.pointerId);
				onBeginEdit();

				if (handle === "rotate") {
					const center = getCenter(selectedBounds);

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

				dragRef.current = {
					type: "resize",
					pointerId: event.pointerId,
					objectId: selectedObject.id,
					handle,
					startPointer: point,
					startBounds: selectedObject.shape.bounds,
				};

				return;
			}
		}

		selectedObject = selectObjectAtPoint(point);

		if (!selectedObject) return;

		const bounds = selectedObject.shape.bounds;

		event.preventDefault();
		canvas.setPointerCapture(event.pointerId);
		onBeginEdit();

		dragRef.current = {
			type: "move",
			pointerId: event.pointerId,
			objectId: selectedObject.id,
			startPointer: point,
			startBounds: bounds,
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

			onChangeShape(drag.objectId, shape =>
				translateShape(
					{
						...shape,
						bounds: drag.startBounds,
					},
					dx,
					dy,
				),
			);

			return;
		}

		if (drag.type === "resize") {
			const nextBounds = resizeBoundsFromHandle(
				drag.startBounds,
				drag.handle,
				point,
			);

			onChangeShape(drag.objectId, shape =>
				resizeShapeFromBounds(shape, nextBounds),
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
	}, []);

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
		/>
	);
}
