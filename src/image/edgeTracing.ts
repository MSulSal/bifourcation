import type { Stroke } from "../types/geometry";
import type { Point } from "../types/geometry";

type TraceImageOptions = {
	targetWidth: number;
	targetHeight: number;
	color: string;
	width: number;
	maxProcessingSize?: number;
	maxContours?: number;
	minPoints?: number;
	threshold?: number;
};

type PixelPoint = {
	x: number;
	y: number;
};

const NEIGHBOR_DIRECTIONS: PixelPoint[] = [
	{ x: 1, y: 0 },
	{ x: 1, y: 1 },
	{ x: 0, y: 1 },
	{ x: -1, y: 1 },
	{ x: -1, y: 0 },
	{ x: -1, y: -1 },
	{ x: 0, y: -1 },
	{ x: 1, y: -1 },
];

function getIndex(x: number, y: number, width: number) {
	return y * width + x;
}

function distance(a: Point, b: Point) {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point) {
	const lineLength = distance(lineStart, lineEnd);

	if (lineLength === 0) return distance(point, lineStart);

	const numerator = Math.abs(
		(lineEnd.y - lineStart.y) * point.x -
			(lineEnd.x - lineStart.x) * point.y +
			lineEnd.x * lineStart.y -
			lineEnd.y * lineStart.x,
	);

	return numerator / lineLength;
}

function simplifyPath(points: Point[], epsilon: number): Point[] {
	if (points.length <= 2) return points;

	let maxDistance = 0;
	let splitIndex = 0;

	const start = points[0];
	const end = points[points.length - 1];

	for (let index = 1; index < points.length - 1; index += 1) {
		const currentDistance = perpendicularDistance(
			points[index],
			start,
			end,
		);

		if (currentDistance > maxDistance) {
			maxDistance = currentDistance;
			splitIndex = index;
		}
	}

	if (maxDistance <= epsilon) {
		return [start, end];
	}

	const before = simplifyPath(points.slice(0, splitIndex + 1), epsilon);
	const after = simplifyPath(points.slice(splitIndex), epsilon);

	return [...before.slice(0, -1), ...after];
}

function limitPointCount(points: Point[], maxPoints: number) {
	if (points.length <= maxPoints) return points;

	const limited: Point[] = [];

	for (let index = 0; index < maxPoints; index += 1) {
		const sourceIndex = Math.round(
			(index / (maxPoints - 1)) * (points.length - 1),
		);

		limited.push(points[sourceIndex]);
	}

	return limited;
}

function loadImage(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const image = new Image();

		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve(image);
		};

		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("Unable to load image."));
		};

		image.src = url;
	});
}

function getProcessingSize(
	imageWidth: number,
	imageHeight: number,
	maxProcessingSize: number,
) {
	const scale = Math.min(
		1,
		maxProcessingSize / Math.max(imageWidth, imageHeight),
	);

	return {
		width: Math.max(1, Math.round(imageWidth * scale)),
		height: Math.max(1, Math.round(imageHeight * scale)),
	};
}

function getGrayscalePixels(imageData: ImageData) {
	const grayscale = new Float32Array(imageData.width * imageData.height);

	for (let index = 0; index < grayscale.length; index += 1) {
		const dataIndex = index * 4;
		const red = imageData.data[dataIndex];
		const green = imageData.data[dataIndex + 1];
		const blue = imageData.data[dataIndex + 2];

		grayscale[index] = red * 0.299 + green * 0.587 + blue * 0.114;
	}

	return grayscale;
}

function blurGrayscale(grayscale: Float32Array, width: number, height: number) {
	const blurred = new Float32Array(grayscale.length);

	for (let y = 1; y < height - 1; y += 1) {
		for (let x = 1; x < width - 1; x += 1) {
			let total = 0;

			for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
				for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
					total +=
						grayscale[getIndex(x + offsetX, y + offsetY, width)];
				}
			}

			blurred[getIndex(x, y, width)] = total / 9;
		}
	}

	return blurred;
}

function getSobelMagnitudes(
	grayscale: Float32Array,
	width: number,
	height: number,
) {
	const magnitudes = new Float32Array(grayscale.length);

	for (let y = 1; y < height - 1; y += 1) {
		for (let x = 1; x < width - 1; x += 1) {
			const topLeft = grayscale[getIndex(x - 1, y - 1, width)];
			const top = grayscale[getIndex(x, y - 1, width)];
			const topRight = grayscale[getIndex(x + 1, y - 1, width)];
			const left = grayscale[getIndex(x - 1, y, width)];
			const right = grayscale[getIndex(x + 1, y, width)];
			const bottomLeft = grayscale[getIndex(x - 1, y + 1, width)];
			const bottom = grayscale[getIndex(x, y + 1, width)];
			const bottomRight = grayscale[getIndex(x + 1, y + 1, width)];

			const gradientX =
				-topLeft -
				2 * left -
				bottomLeft +
				topRight +
				2 * right +
				bottomRight;

			const gradientY =
				-topLeft -
				2 * top -
				topRight +
				bottomLeft +
				2 * bottom +
				bottomRight;

			magnitudes[getIndex(x, y, width)] = Math.hypot(
				gradientX,
				gradientY,
			);
		}
	}

	return magnitudes;
}

function getAutomaticThreshold(magnitudes: Float32Array) {
	let total = 0;
	let count = 0;

	for (const magnitude of magnitudes) {
		if (magnitude === 0) continue;

		total += magnitude;
		count += 1;
	}

	if (count === 0) return 80;

	const mean = total / count;

	let squaredDifferenceTotal = 0;

	for (const magnitude of magnitudes) {
		if (magnitude === 0) continue;

		squaredDifferenceTotal += (magnitude - mean) ** 2;
	}

	const standardDeviation = Math.sqrt(squaredDifferenceTotal / count);

	return Math.max(52, mean + standardDeviation * 0.7);
}

function thresholdEdges(
	magnitudes: Float32Array,
	threshold: number,
	width: number,
	height: number,
) {
	const edgePixels = new Uint8Array(magnitudes.length);

	for (let y = 1; y < height - 1; y += 1) {
		for (let x = 1; x < width - 1; x += 1) {
			const index = getIndex(x, y, width);

			edgePixels[index] = magnitudes[index] >= threshold ? 1 : 0;
		}
	}

	return edgePixels;
}

function getUnvisitedNeighbors(
	point: PixelPoint,
	edgePixels: Uint8Array,
	visited: Uint8Array,
	width: number,
	height: number,
) {
	const neighbors: PixelPoint[] = [];

	for (const direction of NEIGHBOR_DIRECTIONS) {
		const x = point.x + direction.x;
		const y = point.y + direction.y;

		if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;

		const index = getIndex(x, y, width);

		if (edgePixels[index] === 1 && visited[index] === 0) {
			neighbors.push({ x, y });
		}
	}

	return neighbors;
}

function getNeighborCount(
	point: PixelPoint,
	edgePixels: Uint8Array,
	width: number,
	height: number,
) {
	let count = 0;

	for (const direction of NEIGHBOR_DIRECTIONS) {
		const x = point.x + direction.x;
		const y = point.y + direction.y;

		if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;

		if (edgePixels[getIndex(x, y, width)] === 1) {
			count += 1;
		}
	}

	return count;
}

function chooseNextNeighbor(
	current: PixelPoint,
	previous: PixelPoint | null,
	neighbors: PixelPoint[],
) {
	if (neighbors.length === 0) return null;
	if (!previous) return neighbors[0];

	const previousDirection = {
		x: current.x - previous.x,
		y: current.y - previous.y,
	};

	let bestNeighbor = neighbors[0];
	let bestScore = Number.POSITIVE_INFINITY;

	for (const neighbor of neighbors) {
		const nextDirection = {
			x: neighbor.x - current.x,
			y: neighbor.y - current.y,
		};

		const score =
			(nextDirection.x - previousDirection.x) ** 2 +
			(nextDirection.y - previousDirection.y) ** 2;

		if (score < bestScore) {
			bestScore = score;
			bestNeighbor = neighbor;
		}
	}

	return bestNeighbor;
}

function traceFromPixel(
	start: PixelPoint,
	edgePixels: Uint8Array,
	visited: Uint8Array,
	width: number,
	height: number,
) {
	const contour: PixelPoint[] = [];

	let previous: PixelPoint | null = null;
	let current: PixelPoint | null = start;

	while (current) {
		const currentIndex = getIndex(current.x, current.y, width);

		if (visited[currentIndex] === 1) break;

		visited[currentIndex] = 1;
		contour.push(current);

		const neighbors = getUnvisitedNeighbors(
			current,
			edgePixels,
			visited,
			width,
			height,
		);

		const next = chooseNextNeighbor(current, previous, neighbors);

		previous = current;
		current = next;
	}

	return contour;
}

function traceContours(
	edgePixels: Uint8Array,
	width: number,
	height: number,
	minPoints: number,
) {
	const visited = new Uint8Array(edgePixels.length);
	const contours: PixelPoint[][] = [];

	const starts: PixelPoint[] = [];
	const loopStarts: PixelPoint[] = [];

	for (let y = 1; y < height - 1; y += 1) {
		for (let x = 1; x < width - 1; x += 1) {
			const index = getIndex(x, y, width);

			if (edgePixels[index] !== 1) continue;

			const neighborCount = getNeighborCount(
				{ x, y },
				edgePixels,
				width,
				height,
			);

			if (neighborCount <= 1) {
				starts.push({ x, y });
			} else {
				loopStarts.push({ x, y });
			}
		}
	}

	for (const start of [...starts, ...loopStarts]) {
		const index = getIndex(start.x, start.y, width);

		if (visited[index] === 1) continue;

		const contour = traceFromPixel(
			start,
			edgePixels,
			visited,
			width,
			height,
		);

		if (contour.length >= minPoints) {
			contours.push(contour);
		}
	}

	return contours;
}

function convertContoursToStrokes({
	contours,
	processWidth,
	processHeight,
	targetWidth,
	targetHeight,
	color,
	width,
	maxContours,
}: {
	contours: PixelPoint[][];
	processWidth: number;
	processHeight: number;
	targetWidth: number;
	targetHeight: number;
	color: string;
	width: number;
	maxContours: number;
}) {
	const padding = Math.min(
		36,
		Math.max(16, Math.min(targetWidth, targetHeight) * 0.06),
	);

	const scale = Math.min(
		(targetWidth - padding * 2) / processWidth,
		(targetHeight - padding * 2) / processHeight,
	);

	const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

	const renderedWidth = processWidth * safeScale;
	const renderedHeight = processHeight * safeScale;

	const offsetX = (targetWidth - renderedWidth) / 2;
	const offsetY = (targetHeight - renderedHeight) / 2;

	return contours
		.sort((a, b) => b.length - a.length)
		.slice(0, maxContours)
		.map((contour): Stroke => {
			const points = contour.map(point => ({
				x: offsetX + point.x * safeScale,
				y: offsetY + point.y * safeScale,
			}));

			const simplified = simplifyPath(points, 1.8);
			const limited = limitPointCount(simplified, 220);

			return {
				color,
				width,
				points: limited,
			};
		})
		.filter(stroke => stroke.points.length >= 2);
}

export async function traceImageFileToStrokes(
	file: File,
	options: TraceImageOptions,
): Promise<Stroke[]> {
	const image = await loadImage(file);
	const maxProcessingSize = options.maxProcessingSize ?? 480;
	const maxContours = options.maxContours ?? 12;
	const minPoints = options.minPoints ?? 28;

	const processSize = getProcessingSize(
		image.naturalWidth,
		image.naturalHeight,
		maxProcessingSize,
	);

	const canvas = document.createElement("canvas");
	canvas.width = processSize.width;
	canvas.height = processSize.height;

	const ctx = canvas.getContext("2d", { willReadFrequently: true });

	if (!ctx) {
		throw new Error("Unable to create image processing canvas.");
	}

	ctx.drawImage(image, 0, 0, processSize.width, processSize.height);

	const imageData = ctx.getImageData(
		0,
		0,
		processSize.width,
		processSize.height,
	);
	const grayscale = getGrayscalePixels(imageData);
	const blurred = blurGrayscale(
		grayscale,
		processSize.width,
		processSize.height,
	);
	const magnitudes = getSobelMagnitudes(
		blurred,
		processSize.width,
		processSize.height,
	);

	const threshold = options.threshold ?? getAutomaticThreshold(magnitudes);

	const edgePixels = thresholdEdges(
		magnitudes,
		threshold,
		processSize.width,
		processSize.height,
	);

	const contours = traceContours(
		edgePixels,
		processSize.width,
		processSize.height,
		minPoints,
	);

	return convertContoursToStrokes({
		contours,
		processWidth: processSize.width,
		processHeight: processSize.height,
		targetWidth: options.targetWidth,
		targetHeight: options.targetHeight,
		color: options.color,
		width: options.width,
		maxContours,
	});
}
