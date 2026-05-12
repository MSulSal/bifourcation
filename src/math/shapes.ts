import type { Point, Stroke } from "../types/geometry";

export type ShapeKind =
	| "line"
	| "circle"
	| "rectangle"
	| "triangle"
	| "star"
	| "spiral"
	| "sine";

type ShapeBounds = {
	center: Point;
	width: number;
	height: number;
};

type ShapeStyle = {
	color: string;
	width: number;
};

const DEFAULT_POINT_COUNT = 220;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
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

function createLinePoints({ center, width }: ShapeBounds): Point[] {
	const halfWidth = width / 2;

	return [
		{ x: center.x - halfWidth, y: center.y },
		{ x: center.x + halfWidth, y: center.y },
	];
}

function createCirclePoints({ center, width, height }: ShapeBounds): Point[] {
	const radius = Math.min(width, height) / 2;
	const points: Point[] = [];

	for (let index = 0; index <= DEFAULT_POINT_COUNT; index += 1) {
		const angle = (index / DEFAULT_POINT_COUNT) * Math.PI * 2;

		points.push({
			x: center.x + Math.cos(angle) * radius,
			y: center.y + Math.sin(angle) * radius,
		});
	}

	return points;
}

function createRectanglePoints({
	center,
	width,
	height,
}: ShapeBounds): Point[] {
	const left = center.x - width / 2;
	const right = center.x + width / 2;
	const top = center.y - height / 2;
	const bottom = center.y + height / 2;

	const corners: Point[] = [
		{ x: left, y: top },
		{ x: right, y: top },
		{ x: right, y: bottom },
		{ x: left, y: bottom },
		{ x: left, y: top },
	];

	return interpolatePolyline(corners, DEFAULT_POINT_COUNT);
}

function createTrianglePoints({ center, width, height }: ShapeBounds): Point[] {
	const points: Point[] = [
		{ x: center.x, y: center.y - height / 2 },
		{ x: center.x + width / 2, y: center.y + height / 2 },
		{ x: center.x - width / 2, y: center.y + height / 2 },
		{ x: center.x, y: center.y - height / 2 },
	];

	return interpolatePolyline(points, DEFAULT_POINT_COUNT);
}

function createStarPoints({ center, width, height }: ShapeBounds): Point[] {
	const outerRadius = Math.min(width, height) / 2;
	const innerRadius = outerRadius * 0.43;
	const rawPoints: Point[] = [];

	for (let index = 0; index < 10; index += 1) {
		const radius = index % 2 === 0 ? outerRadius : innerRadius;
		const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;

		rawPoints.push({
			x: center.x + Math.cos(angle) * radius,
			y: center.y + Math.sin(angle) * radius,
		});
	}

	rawPoints.push(rawPoints[0]);

	return interpolatePolyline(rawPoints, DEFAULT_POINT_COUNT);
}

function createSpiralPoints({ center, width, height }: ShapeBounds): Point[] {
	const maxRadius = Math.min(width, height) / 2;
	const turns = 3.2;
	const points: Point[] = [];

	for (let index = 0; index < DEFAULT_POINT_COUNT; index += 1) {
		const t = index / (DEFAULT_POINT_COUNT - 1);
		const angle = t * Math.PI * 2 * turns;
		const radius = maxRadius * t;

		points.push({
			x: center.x + Math.cos(angle) * radius,
			y: center.y + Math.sin(angle) * radius,
		});
	}

	return points;
}

function createSinePoints({ center, width, height }: ShapeBounds): Point[] {
	const points: Point[] = [];
	const cycles = 2.5;
	const left = center.x - width / 2;

	for (let index = 0; index < DEFAULT_POINT_COUNT; index += 1) {
		const t = index / (DEFAULT_POINT_COUNT - 1);
		const x = left + t * width;
		const y = center.y + Math.sin(t * Math.PI * 2 * cycles) * (height / 2);

		points.push({ x, y });
	}

	return points;
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

export function createShapeStroke({
	kind,
	bounds,
	style,
	rotation = 0,
}: {
	kind: ShapeKind;
	bounds: ShapeBounds;
	style: ShapeStyle;
	rotation?: number;
}): Stroke {
	const normalizedBounds = {
		center: bounds.center,
		width: clamp(bounds.width, 24, 1200),
		height: clamp(bounds.height, 24, 1200),
	};

	const points =
		kind === "line"
			? createLinePoints(normalizedBounds)
			: kind === "circle"
				? createCirclePoints(normalizedBounds)
				: kind === "rectangle"
					? createRectanglePoints(normalizedBounds)
					: kind === "triangle"
						? createTrianglePoints(normalizedBounds)
						: kind === "star"
							? createStarPoints(normalizedBounds)
							: kind === "spiral"
								? createSpiralPoints(normalizedBounds)
								: createSinePoints(normalizedBounds);

	const rotatedPoints =
		rotation === 0
			? points
			: points.map(point =>
					rotatePoint(point, normalizedBounds.center, rotation),
				);

	return {
		color: style.color,
		width: style.width,
		points: rotatedPoints,
	};
}
