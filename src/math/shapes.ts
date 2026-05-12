import type {
	BucketFillObject,
	DrawingObject,
	Point,
	Rect,
	ShapeFill,
	ShapeKind,
	ShapeObject,
	Stroke,
} from "../types/geometry";

const DEFAULT_POINT_COUNT = 220;
const MIN_SHAPE_SIZE = 2;

export const SHAPE_TOOLS: ShapeKind[] = [
	"line",
	"ellipse",
	"rectangle",
	"parallelogram",
	"triangle-equilateral",
	"triangle-isosceles",
	"triangle-scalene",
	"star",
	"spiral",
	"sine",
];

export function createId(prefix = "object") {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}

	return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function normalizeRectFromPoints(start: Point, end: Point): Rect {
	const x = Math.min(start.x, end.x);
	const y = Math.min(start.y, end.y);
	const width = Math.abs(end.x - start.x);
	const height = Math.abs(end.y - start.y);

	return {
		x,
		y,
		width,
		height,
	};
}

export function normalizeRect(rect: Rect): Rect {
	const x = rect.width < 0 ? rect.x + rect.width : rect.x;
	const y = rect.height < 0 ? rect.y + rect.height : rect.y;

	return {
		x,
		y,
		width: Math.abs(rect.width),
		height: Math.abs(rect.height),
	};
}

function getCenter(bounds: Rect): Point {
	return {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
}

function rotatePoint(point: Point, center: Point, angle: number): Point {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const dx = point.x - center.x;
	const dy = point.y - center.y;

	return {
		x: center.x + dx * cos - dy * sin,
		y: center.y + dx * sin + dy * cos,
	};
}

function transformLocalPoint(
	local: Point,
	shape: ShapeObject,
	center: Point,
): Point {
	let x = local.x;
	let y = local.y;

	if (shape.kind === "parallelogram") {
		x += y * shape.skewX;
	}

	if (shape.flipX) x = -x;
	if (shape.flipY) y = -y;

	const world = {
		x: center.x + x,
		y: center.y + y,
	};

	return shape.rotation === 0
		? world
		: rotatePoint(world, center, shape.rotation);
}

function getPolylineLength(points: Point[]) {
	let total = 0;

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];

		total += Math.hypot(current.x - previous.x, current.y - previous.y);
	}

	return total;
}

function interpolatePolyline(points: Point[], targetCount: number): Point[] {
	if (points.length <= 1) return points;
	if (targetCount <= 2) return [points[0], points[points.length - 1]];

	const totalLength = getPolylineLength(points);

	if (totalLength === 0) {
		return Array.from({ length: targetCount }, () => points[0]);
	}

	const result: Point[] = [points[0]];
	const spacing = totalLength / (targetCount - 1);

	let distanceAtSegmentStart = 0;
	let nextDistance = spacing;

	for (
		let segmentIndex = 1;
		segmentIndex < points.length && result.length < targetCount - 1;
		segmentIndex += 1
	) {
		const start = points[segmentIndex - 1];
		const end = points[segmentIndex];
		const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);

		if (segmentLength === 0) continue;

		const distanceAtSegmentEnd = distanceAtSegmentStart + segmentLength;

		while (
			nextDistance <= distanceAtSegmentEnd &&
			result.length < targetCount - 1
		) {
			const t = (nextDistance - distanceAtSegmentStart) / segmentLength;

			result.push({
				x: start.x + (end.x - start.x) * t,
				y: start.y + (end.y - start.y) * t,
			});

			nextDistance += spacing;
		}

		distanceAtSegmentStart = distanceAtSegmentEnd;
	}

	result.push(points[points.length - 1]);

	return result;
}

function createLineLocalPoints(width: number): Point[] {
	return interpolatePolyline(
		[
			{ x: -width / 2, y: 0 },
			{ x: width / 2, y: 0 },
		],
		32,
	);
}

function createEllipseLocalPoints(width: number, height: number): Point[] {
	const points: Point[] = [];
	const radiusX = width / 2;
	const radiusY = height / 2;

	for (let index = 0; index <= DEFAULT_POINT_COUNT; index += 1) {
		const angle = (index / DEFAULT_POINT_COUNT) * Math.PI * 2;

		points.push({
			x: Math.cos(angle) * radiusX,
			y: Math.sin(angle) * radiusY,
		});
	}

	return points;
}

function createRectangleLocalPoints(width: number, height: number): Point[] {
	return interpolatePolyline(
		[
			{ x: -width / 2, y: -height / 2 },
			{ x: width / 2, y: -height / 2 },
			{ x: width / 2, y: height / 2 },
			{ x: -width / 2, y: height / 2 },
			{ x: -width / 2, y: -height / 2 },
		],
		DEFAULT_POINT_COUNT,
	);
}

function createTriangleLocalPoints(
	kind: ShapeKind,
	width: number,
	height: number,
): Point[] {
	if (kind === "triangle-equilateral") {
		const size = Math.min(width, height);
		const triangleHeight = (Math.sqrt(3) / 2) * size;

		return interpolatePolyline(
			[
				{ x: 0, y: -triangleHeight / 2 },
				{ x: size / 2, y: triangleHeight / 2 },
				{ x: -size / 2, y: triangleHeight / 2 },
				{ x: 0, y: -triangleHeight / 2 },
			],
			DEFAULT_POINT_COUNT,
		);
	}

	if (kind === "triangle-scalene") {
		return interpolatePolyline(
			[
				{ x: -width / 2, y: height / 2 },
				{ x: width / 2, y: height / 2 },
				{ x: -width * 0.18, y: -height / 2 },
				{ x: -width / 2, y: height / 2 },
			],
			DEFAULT_POINT_COUNT,
		);
	}

	return interpolatePolyline(
		[
			{ x: 0, y: -height / 2 },
			{ x: width / 2, y: height / 2 },
			{ x: -width / 2, y: height / 2 },
			{ x: 0, y: -height / 2 },
		],
		DEFAULT_POINT_COUNT,
	);
}

function createStarLocalPoints(width: number, height: number): Point[] {
	const outerRadius = Math.min(width, height) / 2;
	const innerRadius = outerRadius * 0.43;
	const rawPoints: Point[] = [];

	for (let index = 0; index < 10; index += 1) {
		const radius = index % 2 === 0 ? outerRadius : innerRadius;
		const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;

		rawPoints.push({
			x: Math.cos(angle) * radius,
			y: Math.sin(angle) * radius,
		});
	}

	rawPoints.push(rawPoints[0]);

	return interpolatePolyline(rawPoints, DEFAULT_POINT_COUNT);
}

function createSpiralLocalPoints(width: number, height: number): Point[] {
	const maxRadius = Math.min(width, height) / 2;
	const turns = 3.2;
	const points: Point[] = [];

	for (let index = 0; index < DEFAULT_POINT_COUNT; index += 1) {
		const t = index / (DEFAULT_POINT_COUNT - 1);
		const angle = t * Math.PI * 2 * turns;
		const radius = maxRadius * t;

		points.push({
			x: Math.cos(angle) * radius,
			y: Math.sin(angle) * radius,
		});
	}

	return points;
}

function createSineLocalPoints(width: number, height: number): Point[] {
	const points: Point[] = [];
	const cycles = 2.5;

	for (let index = 0; index < DEFAULT_POINT_COUNT; index += 1) {
		const t = index / (DEFAULT_POINT_COUNT - 1);

		points.push({
			x: -width / 2 + t * width,
			y: Math.sin(t * Math.PI * 2 * cycles) * (height / 2),
		});
	}

	return points;
}

function createLocalPoints(kind: ShapeKind, width: number, height: number) {
	if (kind === "line") return createLineLocalPoints(width);
	if (kind === "ellipse") return createEllipseLocalPoints(width, height);
	if (kind === "rectangle" || kind === "parallelogram") {
		return createRectangleLocalPoints(width, height);
	}
	if (
		kind === "triangle-equilateral" ||
		kind === "triangle-isosceles" ||
		kind === "triangle-scalene"
	) {
		return createTriangleLocalPoints(kind, width, height);
	}
	if (kind === "star") return createStarLocalPoints(width, height);
	if (kind === "spiral") return createSpiralLocalPoints(width, height);

	return createSineLocalPoints(width, height);
}

export function createShapeObject({
	kind,
	start,
	end,
	color,
	width,
	fill,
}: {
	kind: ShapeKind;
	start: Point;
	end: Point;
	color: string;
	width: number;
	fill: ShapeFill | null;
}): ShapeObject {
	if (kind === "line") {
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const length = Math.max(MIN_SHAPE_SIZE, Math.hypot(dx, dy));
		const center = {
			x: (start.x + end.x) / 2,
			y: (start.y + end.y) / 2,
		};

		return {
			id: createId("shape"),
			kind,
			color,
			width,
			fill,
			bounds: {
				x: center.x - length / 2,
				y: center.y - MIN_SHAPE_SIZE / 2,
				width: length,
				height: MIN_SHAPE_SIZE,
			},
			rotation: Math.atan2(dy, dx),
			flipX: false,
			flipY: false,
			skewX: 0,
		};
	}

	const rawBounds = normalizeRectFromPoints(start, end);
	const bounds = {
		x: rawBounds.x,
		y: rawBounds.y,
		width: Math.max(MIN_SHAPE_SIZE, rawBounds.width),
		height: Math.max(MIN_SHAPE_SIZE, rawBounds.height),
	};

	return {
		id: createId("shape"),
		kind,
		color,
		width,
		fill,
		bounds,
		rotation: 0,
		flipX: end.x < start.x,
		flipY: end.y < start.y,
		skewX: kind === "parallelogram" ? 0.24 : 0,
	};
}

export function updateLineShapeFromEndpoints(
	shape: ShapeObject,
	start: Point,
	end: Point,
): ShapeObject {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.max(MIN_SHAPE_SIZE, Math.hypot(dx, dy));
	const center = {
		x: (start.x + end.x) / 2,
		y: (start.y + end.y) / 2,
	};

	return {
		...shape,
		kind: "line",
		bounds: {
			x: center.x - length / 2,
			y: center.y - MIN_SHAPE_SIZE / 2,
			width: length,
			height: MIN_SHAPE_SIZE,
		},
		rotation: Math.atan2(dy, dx),
		flipX: false,
		flipY: false,
		skewX: 0,
	};
}

export function shapeObjectToStroke(shape: ShapeObject): Stroke {
	const bounds = normalizeRect(shape.bounds);
	const width = Math.max(MIN_SHAPE_SIZE, bounds.width);
	const height = Math.max(MIN_SHAPE_SIZE, bounds.height);
	const center = getCenter(bounds);
	const localPoints = createLocalPoints(shape.kind, width, height);

	return {
		color: shape.color,
		width: shape.width,
		points: localPoints.map(point =>
			transformLocalPoint(point, shape, center),
		),
	};
}

export function drawingObjectToStroke(object: DrawingObject): Stroke | null {
	if (object.type === "freehand") return object.stroke;
	if (object.type === "shape") return shapeObjectToStroke(object.shape);

	return null;
}

export function getPointsBounds(points: Point[]): Rect {
	if (points.length === 0) {
		return {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		};
	}

	const xs = points.map(point => point.x);
	const ys = points.map(point => point.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);

	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY,
	};
}

export function getDrawingObjectBounds(object: DrawingObject): Rect {
	if (object.type === "bucket-fill") {
		return {
			x: 0,
			y: 0,
			width: object.fill.canvasWidth,
			height: object.fill.canvasHeight,
		};
	}

	const stroke = drawingObjectToStroke(object);

	return stroke
		? getPointsBounds(stroke.points)
		: { x: 0, y: 0, width: 0, height: 0 };
}

export function translateShape(shape: ShapeObject, dx: number, dy: number) {
	return {
		...shape,
		bounds: {
			...shape.bounds,
			x: shape.bounds.x + dx,
			y: shape.bounds.y + dy,
		},
	};
}

export function resizeShapeFromBounds(shape: ShapeObject, bounds: Rect) {
	const normalized = normalizeRect(bounds);

	return {
		...shape,
		bounds: {
			x: normalized.x,
			y: normalized.y,
			width: Math.max(MIN_SHAPE_SIZE, normalized.width),
			height: Math.max(MIN_SHAPE_SIZE, normalized.height),
		},
	};
}

export function rotateShape(shape: ShapeObject, rotation: number) {
	return {
		...shape,
		rotation,
	};
}

export function flipShapeHorizontal(shape: ShapeObject) {
	return {
		...shape,
		flipX: !shape.flipX,
	};
}

export function flipShapeVertical(shape: ShapeObject) {
	return {
		...shape,
		flipY: !shape.flipY,
	};
}

export function setShapeFill(shape: ShapeObject, fill: ShapeFill | null) {
	return {
		...shape,
		fill,
	};
}

export function getShapeLabel(kind: ShapeKind) {
	if (kind === "line") return "Line";
	if (kind === "ellipse") return "Ellipse";
	if (kind === "rectangle") return "Rectangle";
	if (kind === "parallelogram") return "Parallelogram";
	if (kind === "triangle-equilateral") return "Equilateral triangle";
	if (kind === "triangle-isosceles") return "Isosceles triangle";
	if (kind === "triangle-scalene") return "Scalene triangle";
	if (kind === "star") return "Star";
	if (kind === "spiral") return "Spiral";

	return "Sine wave";
}

function renderStrokePath(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	options: {
		fill?: ShapeFill | null;
		stroke?: boolean;
	} = {},
) {
	if (stroke.points.length < 2) return;

	const shouldStroke = options.stroke ?? true;

	ctx.save();

	ctx.beginPath();
	ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

	for (const point of stroke.points.slice(1)) {
		ctx.lineTo(point.x, point.y);
	}

	if (options.fill) {
		ctx.globalAlpha = options.fill.opacity;
		ctx.fillStyle = options.fill.color;
		ctx.fill();
		ctx.globalAlpha = 1;
	}

	if (shouldStroke) {
		ctx.strokeStyle = stroke.color;
		ctx.lineWidth = stroke.width;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.stroke();
	}

	ctx.restore();
}

function renderBucketFill(
	ctx: CanvasRenderingContext2D,
	fill: BucketFillObject,
) {
	if (fill.spans.length === 0) return;

	ctx.save();
	ctx.globalAlpha = fill.opacity;
	ctx.fillStyle = fill.color;

	for (const span of fill.spans) {
		ctx.fillRect(span.x, span.y, span.width, 1);
	}

	ctx.restore();
}

export function renderDrawingObject(
	ctx: CanvasRenderingContext2D,
	object: DrawingObject,
) {
	if (object.type === "bucket-fill") {
		renderBucketFill(ctx, object.fill);
		return;
	}

	if (object.type === "shape") {
		const stroke = shapeObjectToStroke(object.shape);

		renderStrokePath(ctx, stroke, {
			fill: object.shape.fill,
			stroke: true,
		});

		return;
	}

	renderStrokePath(ctx, object.stroke);
}

export function renderBoundaryObject(
	ctx: CanvasRenderingContext2D,
	object: DrawingObject,
) {
	if (object.type === "bucket-fill") return;

	const stroke =
		object.type === "shape"
			? shapeObjectToStroke(object.shape)
			: object.stroke;

	if (stroke.points.length < 2) return;

	ctx.save();

	ctx.strokeStyle = "#000000";
	ctx.lineWidth = Math.max(1, stroke.width);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	ctx.beginPath();
	ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

	for (const point of stroke.points.slice(1)) {
		ctx.lineTo(point.x, point.y);
	}

	ctx.stroke();
	ctx.restore();
}

export function renderDrawingObjects(
	ctx: CanvasRenderingContext2D,
	objects: DrawingObject[],
) {
	for (const object of objects) {
		if (object.type === "bucket-fill") {
			renderDrawingObject(ctx, object);
		}
	}

	for (const object of objects) {
		if (object.type !== "bucket-fill") {
			renderDrawingObject(ctx, object);
		}
	}
}

export function clampFillOpacity(value: number) {
	return clamp(value, 0, 1);
}
