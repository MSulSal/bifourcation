import { useEffect, useRef } from "react";
import type { Multivector } from "../math/clifford";
import { evaluateFourierTerms, type FourierTerm } from "../math/fourier";
import type { Point } from "../types/geometry";

export type BivectorView = "blade" | "disk" | "companion";

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
	bivectorView: BivectorView;
};

const STROKE_DURATION_MS = 6500;
const MAX_VISIBLE_BLADES = 64;
const MAX_ARROWED_BLADES = 24;

const COMPLETED_STROKE_PROGRESS = 0.999;

export function EpicycleCanvas({
	strokes,
	isActive,
	isPlaying,
	termLimit,
	bivectorView,
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

	function drawLine(
		from: Point,
		to: Point,
		color: string,
		width: number,
		alpha: number,
	) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.globalAlpha = alpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();

		ctx.globalAlpha = 1;
	}

	function drawBladeMode(
		center: Point,
		tip: Point,
		companionUnit: Point,
		length: number,
		frequency: number,
		color: string,
		strokeWidth: number,
		index: number,
		opacity: number,
	) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const bladeThickness = Math.max(5, Math.min(22, length * 0.16));
		const halfOffset = {
			x: companionUnit.x * bladeThickness * 0.5,
			y: companionUnit.y * bladeThickness * 0.5,
		};

		const p0 = {
			x: center.x - halfOffset.x,
			y: center.y - halfOffset.y,
		};

		const p1 = {
			x: tip.x - halfOffset.x,
			y: tip.y - halfOffset.y,
		};

		const p2 = {
			x: tip.x + halfOffset.x,
			y: tip.y + halfOffset.y,
		};

		const p3 = {
			x: center.x + halfOffset.x,
			y: center.y + halfOffset.y,
		};

		const bladeAlpha = Math.max(0.035, 0.18 - index * 0.0025) * opacity;
		const outlineAlpha = Math.max(0.08, 0.35 - index * 0.004) * opacity;
		const vectorAlpha = Math.max(0.18, 0.72 - index * 0.006) * opacity;

		ctx.globalAlpha = bladeAlpha;
		ctx.fillStyle = color;

		ctx.beginPath();
		ctx.moveTo(p0.x, p0.y);
		ctx.lineTo(p1.x, p1.y);
		ctx.lineTo(p2.x, p2.y);
		ctx.lineTo(p3.x, p3.y);
		ctx.closePath();
		ctx.fill();

		ctx.globalAlpha = outlineAlpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;

		ctx.beginPath();
		ctx.moveTo(p0.x, p0.y);
		ctx.lineTo(p1.x, p1.y);
		ctx.lineTo(p2.x, p2.y);
		ctx.lineTo(p3.x, p3.y);
		ctx.closePath();
		ctx.stroke();

		ctx.globalAlpha = 1;

		drawLine(
			center,
			tip,
			color,
			Math.max(1, strokeWidth * 0.4),
			vectorAlpha,
		);

		const companionTip = {
			x: center.x + companionUnit.x * bladeThickness,
			y: center.y + companionUnit.y * bladeThickness,
		};

		drawLine(
			center,
			companionTip,
			color,
			Math.max(1, strokeWidth * 0.28),
			Math.max(0.12, vectorAlpha * 0.6),
		);

		if (index >= MAX_ARROWED_BLADES || frequency === 0) return;

		const componentAngle = Math.atan2(tip.y - center.y, tip.x - center.x);
		const companionAngle = Math.atan2(companionUnit.y, companionUnit.x);
		const arrowSize = Math.max(4, Math.min(9, length * 0.09));
		const arrowAlpha = Math.max(0.14, 0.58 - index * 0.018) * opacity;

		const topEdgeMidpoint = {
			x: (p2.x + p3.x) * 0.5,
			y: (p2.y + p3.y) * 0.5,
		};

		const bottomEdgeMidpoint = {
			x: (p0.x + p1.x) * 0.5,
			y: (p0.y + p1.y) * 0.5,
		};

		drawArrowhead(
			topEdgeMidpoint.x,
			topEdgeMidpoint.y,
			componentAngle,
			color,
			arrowSize,
			arrowAlpha,
		);

		drawArrowhead(
			bottomEdgeMidpoint.x,
			bottomEdgeMidpoint.y,
			componentAngle + Math.PI,
			color,
			arrowSize,
			arrowAlpha,
		);

		drawArrowhead(
			companionTip.x,
			companionTip.y,
			companionAngle,
			color,
			arrowSize * 0.85,
			arrowAlpha * 0.8,
		);
	}

	function drawDiskMode(
		center: Point,
		tip: Point,
		length: number,
		frequency: number,
		color: string,
		strokeWidth: number,
		index: number,
		opacity: number,
	) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const diskAlpha = Math.max(0.018, 0.105 - index * 0.0014) * opacity;
		const outlineAlpha = Math.max(0.06, 0.28 - index * 0.003) * opacity;
		const vectorAlpha = Math.max(0.18, 0.74 - index * 0.006) * opacity;

		ctx.globalAlpha = diskAlpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(center.x, center.y, length, 0, Math.PI * 2);
		ctx.fill();

		ctx.globalAlpha = outlineAlpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(center.x, center.y, length, 0, Math.PI * 2);
		ctx.stroke();

		ctx.globalAlpha = 1;

		drawLine(
			center,
			tip,
			color,
			Math.max(1, strokeWidth * 0.42),
			vectorAlpha,
		);

		if (index >= MAX_ARROWED_BLADES || frequency === 0) return;

		const direction = frequency >= 0 ? 1 : -1;
		const angle = Math.atan2(tip.y - center.y, tip.x - center.x);
		const oppositeAngle = angle + Math.PI;
		const tangentAngle = angle + direction * Math.PI * 0.5;
		const oppositeTangentAngle = oppositeAngle + direction * Math.PI * 0.5;

		const arrowSize = Math.max(4, Math.min(9, length * 0.08));
		const arrowAlpha = Math.max(0.14, 0.55 - index * 0.018) * opacity;

		const firstPoint = {
			x: center.x + Math.cos(angle) * length,
			y: center.y + Math.sin(angle) * length,
		};

		const secondPoint = {
			x: center.x + Math.cos(oppositeAngle) * length,
			y: center.y + Math.sin(oppositeAngle) * length,
		};

		drawArrowhead(
			firstPoint.x,
			firstPoint.y,
			tangentAngle,
			color,
			arrowSize,
			arrowAlpha,
		);

		drawArrowhead(
			secondPoint.x,
			secondPoint.y,
			oppositeTangentAngle,
			color,
			arrowSize,
			arrowAlpha,
		);
	}

	function drawCompanionMode(
		center: Point,
		tip: Point,
		companionUnit: Point,
		length: number,
		color: string,
		strokeWidth: number,
		index: number,
		opacity: number,
	) {
		if (index >= MAX_VISIBLE_BLADES) return;

		const companionTip = {
			x: center.x + companionUnit.x * length,
			y: center.y + companionUnit.y * length,
		};

		const vectorAlpha = Math.max(0.2, 0.72 - index * 0.006) * opacity;
		const companionAlpha = Math.max(0.12, 0.42 - index * 0.004) * opacity;
		const bridgeAlpha = Math.max(0.04, 0.18 - index * 0.0025) * opacity;

		drawLine(
			center,
			tip,
			color,
			Math.max(1, strokeWidth * 0.42),
			vectorAlpha,
		);

		drawLine(
			center,
			companionTip,
			color,
			Math.max(1, strokeWidth * 0.32),
			companionAlpha,
		);

		drawLine(tip, companionTip, color, 1, bridgeAlpha);

		if (index >= MAX_ARROWED_BLADES) return;

		const componentAngle = Math.atan2(tip.y - center.y, tip.x - center.x);
		const companionAngle = Math.atan2(
			companionTip.y - center.y,
			companionTip.x - center.x,
		);
		const arrowSize = Math.max(4, Math.min(9, length * 0.08));
		const arrowAlpha = Math.max(0.14, 0.58 - index * 0.018) * opacity;

		drawArrowhead(
			tip.x,
			tip.y,
			componentAngle,
			color,
			arrowSize,
			arrowAlpha,
		);
		drawArrowhead(
			companionTip.x,
			companionTip.y,
			companionAngle,
			color,
			arrowSize,
			arrowAlpha * 0.85,
		);
	}

	function drawOrientedComponent(
		center: Point,
		tip: Point,
		frequency: number,
		color: string,
		strokeWidth: number,
		index: number,
		opacity = 1,
	) {
		const dx = tip.x - center.x;
		const dy = tip.y - center.y;
		const length = Math.hypot(dx, dy);

		if (length < 4 || index >= MAX_VISIBLE_BLADES) return;

		const orientation = frequency >= 0 ? 1 : -1;

		const companionUnit = {
			x: orientation * (-dy / length),
			y: orientation * (dx / length),
		};

		if (bivectorView === "blade") {
			drawBladeMode(
				center,
				tip,
				companionUnit,
				length,
				frequency,
				color,
				strokeWidth,
				index,
				opacity,
			);

			return;
		}

		if (bivectorView === "disk") {
			drawDiskMode(
				center,
				tip,
				length,
				frequency,
				color,
				strokeWidth,
				index,
				opacity,
			);

			return;
		}

		drawCompanionMode(
			center,
			tip,
			companionUnit,
			length,
			color,
			strokeWidth,
			index,
			opacity,
		);
	}

	function drawBladeSet(
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

			drawOrientedComponent(
				center,
				tip,
				epicycle.frequency,
				stroke.color,
				stroke.width,
				index,
				opacity,
			);
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

		drawBladeSet(stroke, COMPLETED_STROKE_PROGRESS, {
			opacity: 0.72,
			showTip: false,
		});
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

		const point = drawBladeSet(activeStroke, progress, {
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
	}, [isActive, strokes, termLimit, bivectorView]);

	useEffect(() => {
		if (!isActive || strokes.length === 0) {
			stopAnimation();
			clearOverlay();
			return;
		}

		if (!isPlaying) {
			stopAnimation();

			if (lastDrawnFrameRef.current) {
				drawFrame(
					lastDrawnFrameRef.current.strokeIndex,
					lastDrawnFrameRef.current.progress,
				);

				return;
			}

			traceRef.current = [];
			activeStrokeIndexRef.current = 0;
			drawFrame(0, 0);

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
			const elapsed = timestamp - startedAtRef.current;
			const loopElapsed = elapsed % animationDuration;

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
	}, [isActive, isPlaying, strokes, termLimit, bivectorView]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute inset-0 block h-full w-full"
		/>
	);
}
