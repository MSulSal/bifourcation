import type { Point } from "../types/geometry";

export function distance(a: Point, b: Point) {
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

	for (let index = 1; index < points.length; index += 1) {
		total += distance(points[index - 1], points[index]);
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

	let distanceAtSegmentStart = 0;
	let nextSampleDistance = spacing;

	for (
		let segmentEndIndex = 1;
		segmentEndIndex < points.length && resampled.length < sampleCount - 1;
		segmentEndIndex += 1
	) {
		const segmentStart = points[segmentEndIndex - 1];
		const segmentEnd = points[segmentEndIndex];
		const segmentLength = distance(segmentStart, segmentEnd);

		if (segmentLength === 0) continue;

		const distanceAtSegmentEnd = distanceAtSegmentStart + segmentLength;

		while (
			nextSampleDistance <= distanceAtSegmentEnd &&
			resampled.length < sampleCount - 1
		) {
			const distanceIntoSegment =
				nextSampleDistance - distanceAtSegmentStart;
			const t = distanceIntoSegment / segmentLength;

			resampled.push(lerpPoint(segmentStart, segmentEnd, t));
			nextSampleDistance += spacing;
		}

		distanceAtSegmentStart = distanceAtSegmentEnd;
	}

	resampled.push(points[points.length - 1]);

	while (resampled.length < sampleCount) {
		resampled.push(points[points.length - 1]);
	}

	return resampled;
}
