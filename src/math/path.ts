import type { Point } from "../types/geometry";

export function distance(a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;

	return Math.hypot(dx, dy);
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
	};
}

export function getPathLength(points: Point[]) {
	let total = 0;

	for (let i = 1; i < points.length; i++) {
		total += distance(points[i - 1], points[i]);
	}

	return total;
}

export function resamplePath(points: Point[], sampleCount: number): Point[] {
	if (points.length === 0) return [];
	if (points.length === 1) return [...points];
	if (sampleCount <= 1) return [points[0]];

	const totalLength = getPathLength(points);

	if (totalLength === 0) {
		return Array.from({ length: sampleCount }, () => points[0]);
	}

	const spacing = totalLength / (sampleCount - 1);
	const resampled: Point[] = [points[0]];

	let currentSegmentStart = points[0];
	let currentSegmentIndex = 1;
	let distanceIntoSegment = 0;

	while (
		resampled.length < sampleCount &&
		currentSegmentIndex < points.length
	) {
		const currentSegmentEnd = points[currentSegmentIndex];
		const segmentLength = distance(currentSegmentStart, currentSegmentEnd);

		const remainingSegmentLength = segmentLength - distanceIntoSegment;
		const distanceToNextSample = spacing;

		if (remainingSegmentLength >= distanceToNextSample) {
			const t =
				(distanceIntoSegment + distanceToNextSample) / segmentLength;
			const nextPoint = lerpPoint(
				currentSegmentStart,
				currentSegmentEnd,
				t,
			);

			resampled.push(nextPoint);

			currentSegmentStart = nextPoint;
			distanceIntoSegment = 0;
		} else {
			currentSegmentStart = currentSegmentEnd;
			currentSegmentIndex += 1;
			distanceIntoSegment = 0;
		}
	}

	while (resampled.length < sampleCount) {
		resampled.push(points[points.length - 1]);
	}

	return resampled;
}
