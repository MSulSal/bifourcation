import { useEffect, useRef } from "react";
import type { Multivector } from "../math/clifford";
import { evaluateFourierTerms, type FourierTerm } from "../math/fourier";
import type { Point } from "../types/geometry";

type AnimatedStroke = {
	id: string;
	color: string;
	width: number;
	path: Point[];
	terms: FourierTerm[];
};

type EpicycleCanvasProps = {
	strokes: AnimatedStroke[];
	isActive: boolean;
	isPlaying: boolean;
	termLimit: number;
};

const STROKE_DURATION_MS = 6500;
const FINAL_HOLD_MS = 5000;
const MAX_ARROWED_EPICYCLES = 18;

const COMPLETED_STROKE_PROGRESS = 0.999;

export function EpicycleCanvas({
	strokes,
	isActive,
	isPlaying,
	termLimit,
}: EpicycleCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const startedAtRef = useRef<number | null>(null);
	const traceRef = useRef<Multivector[]>([]);
	const activeStrokeIndexRef = useRef(0);
	const lastDrawnFrameRef = useRef<{
		strokeIndex: number;
		progress: number;
	} | null>(null);

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

	function clearOverlay() {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, rect.width, rect.height);
		traceRef.current = [];
		activeStrokeIndexRef.current = 0;
		startedAtRef.current = null;
		lastDrawnFrameRef.current = null;
	}

	function stopAnimation() {
		if (animationFrameRef.current !== null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
	}

	function getCanvasPoint(value: Multivector): Point {
		return {
			x: value.e1,
			y: value.e2,
		};
	}

	function drawPath(
		points: Point[],
		color: string,
		width: number,
		alpha = 1,
	) {
		const canvas = canvasRef.current;
		if (!canvas || points.length < 2) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.globalAlpha = alpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);

		for (const point of points.slice(1)) {
			ctx.lineTo(point.x, point.y);
		}

		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	function drawTrace(
		trace: Multivector[],
		color: string,
		width: number,
		alpha = 1,
	) {
		drawPath(trace.map(getCanvasPoint), color, width, alpha);
	}

	function drawArrowhead(
		x: number,
		y: number,
		angle: number,
		color: string,
		size: number,
		alpha: number,
	) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.fillStyle = color;
		ctx.translate(x, y);
		ctx.rotate(angle);

		ctx.beginPath();
		ctx.moveTo(size, 0);
		ctx.lineTo(-size * 0.7, size * 0.45);
		ctx.lineTo(-size * 0.35, 0);
		ctx.lineTo(-size * 0.7, -size * 0.45);
		ctx.closePath();
		ctx.fill();

		ctx.restore();
	}

	function drawBivectorArrowPair(
		center: Point,
		radius: number,
		angle: number,
		frequency: number,
		color: string,
		index: number,
		opacity = 1,
	) {
		if (radius < 8 || index >= MAX_ARROWED_EPICYCLES || frequency === 0)
			return;

		const direction = frequency >= 0 ? 1 : -1;
		const arrowSize = Math.max(4, Math.min(9, radius * 0.12));
		const alpha = Math.max(0.15, 0.55 - index * 0.02) * opacity;

		const firstAngle = angle;
		const secondAngle = angle + Math.PI;

		const firstX = center.x + Math.cos(firstAngle) * radius;
		const firstY = center.y + Math.sin(firstAngle) * radius;

		const secondX = center.x + Math.cos(secondAngle) * radius;
		const secondY = center.y + Math.sin(secondAngle) * radius;

		const firstTangentAngle = firstAngle + direction * Math.PI * 0.5;
		const secondTangentAngle = secondAngle + direction * Math.PI * 0.5;

		drawArrowhead(
			firstX,
			firstY,
			firstTangentAngle,
			color,
			arrowSize,
			alpha,
		);
		drawArrowhead(
			secondX,
			secondY,
			secondTangentAngle,
			color,
			arrowSize,
			alpha,
		);
	}

	function drawEpicycleSet(
		stroke: AnimatedStroke,
		progress: number,
		options: {
			opacity?: number;
			showTip?: boolean;
		} = {},
	) {
		const canvas = canvasRef.current;
		if (!canvas) return null;

		const ctx = canvas.getContext("2d");
		if (!ctx) return null;

		const opacity = options.opacity ?? 1;
		const showTip = options.showTip ?? true;
		const activeTermLimit = Math.min(termLimit, stroke.terms.length);

		const { epicycles, point } = evaluateFourierTerms(
			stroke.terms,
			progress,
			activeTermLimit,
		);

		for (const [index, epicycle] of epicycles.entries()) {
			const center = getCanvasPoint(epicycle.center);
			const tip = getCanvasPoint(epicycle.tip);
			const angle =
				2 * Math.PI * epicycle.frequency * progress + epicycle.phase;

			ctx.strokeStyle = stroke.color;
			ctx.globalAlpha = 0.16 * opacity;
			ctx.lineWidth = 1;

			ctx.beginPath();
			ctx.arc(center.x, center.y, epicycle.radius, 0, Math.PI * 2);
			ctx.stroke();

			drawBivectorArrowPair(
				center,
				epicycle.radius,
				angle,
				epicycle.frequency,
				stroke.color,
				index,
				opacity,
			);

			ctx.globalAlpha = 0.55 * opacity;
			ctx.lineWidth = Math.max(1, stroke.width * 0.35);

			ctx.beginPath();
			ctx.moveTo(center.x, center.y);
			ctx.lineTo(tip.x, tip.y);
			ctx.stroke();

			ctx.globalAlpha = 1;
		}

		if (showTip) {
			const currentPoint = getCanvasPoint(point);

			ctx.globalAlpha = opacity;
			ctx.fillStyle = stroke.color;
			ctx.beginPath();
			ctx.arc(
				currentPoint.x,
				currentPoint.y,
				Math.max(4, stroke.width),
				0,
				Math.PI * 2,
			);
			ctx.fill();
			ctx.globalAlpha = 1;
		}

		return point;
	}

	function drawCompletedStroke(stroke: AnimatedStroke) {
		drawPath(stroke.path, stroke.color, stroke.width, 0.95);

		drawEpicycleSet(stroke, COMPLETED_STROKE_PROGRESS, {
			opacity: 0.72,
			showTip: false,
		});
	}

	function drawFinalFrame() {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, rect.width, rect.height);

		for (const stroke of strokes) {
			drawCompletedStroke(stroke);
		}

		traceRef.current = [];

		lastDrawnFrameRef.current =
			strokes.length > 0
				? {
						strokeIndex: strokes.length - 1,
						progress: COMPLETED_STROKE_PROGRESS,
					}
				: null;
	}

	function drawFrame(strokeIndex: number, progress: number) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, rect.width, rect.height);

		for (let index = 0; index < strokeIndex; index += 1) {
			const completedStroke = strokes[index];
			drawCompletedStroke(completedStroke);
		}

		const activeStroke = strokes[strokeIndex];

		if (!activeStroke) {
			lastDrawnFrameRef.current = null;
			return;
		}

		const point = drawEpicycleSet(activeStroke, progress, {
			opacity: 1,
			showTip: true,
		});

		if (point) {
			traceRef.current.push(point);
		}

		drawTrace(
			traceRef.current,
			activeStroke.color,
			Math.max(2, activeStroke.width),
			1,
		);

		lastDrawnFrameRef.current = {
			strokeIndex,
			progress,
		};
	}

	useEffect(() => {
		resizeCanvasToDisplaySize();

		const canvas = canvasRef.current;
		if (!canvas) return;

		const resizeObserver = new ResizeObserver(() => {
			resizeCanvasToDisplaySize();

			if (!isActive) {
				clearOverlay();
				return;
			}

			if (lastDrawnFrameRef.current) {
				drawFrame(
					lastDrawnFrameRef.current.strokeIndex,
					lastDrawnFrameRef.current.progress,
				);
			}
		});

		resizeObserver.observe(canvas);

		return () => {
			resizeObserver.disconnect();
		};
	}, [isActive, strokes]);

	useEffect(() => {
		if (!isActive || strokes.length === 0) {
			stopAnimation();
			clearOverlay();
			return;
		}

		if (!isPlaying) {
			stopAnimation();

			if (!lastDrawnFrameRef.current) {
				traceRef.current = [];
				activeStrokeIndexRef.current = 0;
				drawFrame(0, 0);
			}

			return;
		}

		stopAnimation();

		if (startedAtRef.current === null) {
			startedAtRef.current = performance.now();
		}

		function animate(timestamp: number) {
			if (startedAtRef.current === null) {
				startedAtRef.current = timestamp;
			}

			const animationDuration = strokes.length * STROKE_DURATION_MS;
			const cycleDuration = animationDuration + FINAL_HOLD_MS;
			const elapsed = timestamp - startedAtRef.current;
			const loopElapsed = elapsed % cycleDuration;

			if (loopElapsed >= animationDuration) {
				drawFinalFrame();
				animationFrameRef.current = requestAnimationFrame(animate);
				return;
			}

			const strokeIndex = Math.min(
				strokes.length - 1,
				Math.floor(loopElapsed / STROKE_DURATION_MS),
			);

			const strokeElapsed =
				loopElapsed - strokeIndex * STROKE_DURATION_MS;
			const progress = strokeElapsed / STROKE_DURATION_MS;

			if (
				strokeIndex !== activeStrokeIndexRef.current ||
				progress < 0.01
			) {
				traceRef.current = [];
				activeStrokeIndexRef.current = strokeIndex;
			}

			drawFrame(strokeIndex, progress);

			animationFrameRef.current = requestAnimationFrame(animate);
		}

		animationFrameRef.current = requestAnimationFrame(animate);

		return () => {
			stopAnimation();
		};
	}, [isActive, isPlaying, strokes, termLimit]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute inset-0 block h-full w-full"
		/>
	);
}
