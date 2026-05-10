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
const MAX_VISIBLE_COMPONENTS = 64;
const MAX_ARROWED_COMPONENTS = 24;

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

	function drawTranslationComponent(
		center: Point,
		tip: Point,
		color: string,
		strokeWidth: number,
		index: number,
		opacity: number,
	) {
		const alpha = Math.max(0.08, 0.35 - index * 0.004) * opacity;

		drawLine(center, tip, color, Math.max(1, strokeWidth * 0.32), alpha);
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

		// Accurate blade geometry:
		//
		// r is the component vector:
		//   center → tip
		//
		// e₁e₂r is the companion vector:
		//   center → companionTip
		//
		// The blade is the parallelogram spanned by those two edge vectors.
		// Its area is |r|² because |e₁e₂r| = |r| and the two are perpendicular.
		const companionVector = {
			x: companionUnit.x * length,
			y: companionUnit.y * length,
		};

		const companionTip = {
			x: center.x + companionVector.x,
			y: center.y + companionVector.y,
		};

		const farCorner = {
			x: tip.x + companionVector.x,
			y: tip.y + companionVector.y,
		};

		const bladeAlpha = Math.max(0.012, 0.075 - index * 0.001) * opacity;
		const outlineAlpha = Math.max(0.045, 0.24 - index * 0.0025) * opacity;
		const vectorAlpha = Math.max(0.18, 0.72 - index * 0.006) * opacity;
		const companionAlpha = Math.max(0.12, vectorAlpha * 0.58) * opacity;

		ctx.globalAlpha = bladeAlpha;
		ctx.fillStyle = color;

		ctx.beginPath();
		ctx.moveTo(center.x, center.y);
		ctx.lineTo(tip.x, tip.y);
		ctx.lineTo(farCorner.x, farCorner.y);
		ctx.lineTo(companionTip.x, companionTip.y);
		ctx.closePath();
		ctx.fill();

		ctx.globalAlpha = outlineAlpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;

		ctx.beginPath();
		ctx.moveTo(center.x, center.y);
		ctx.lineTo(tip.x, tip.y);
		ctx.lineTo(farCorner.x, farCorner.y);
		ctx.lineTo(companionTip.x, companionTip.y);
		ctx.closePath();
		ctx.stroke();

		ctx.globalAlpha = 1;

		// Primary edge: r.
		drawLine(
			center,
			tip,
			color,
			Math.max(1, strokeWidth * 0.44),
			vectorAlpha,
		);

		// Companion edge: e₁e₂r.
		drawLine(
			center,
			companionTip,
			color,
			Math.max(1, strokeWidth * 0.34),
			companionAlpha,
		);

		// Opposite edges, faintly, so the parallelogram reads as a blade.
		drawLine(
			companionTip,
			farCorner,
			color,
			1,
			Math.max(0.04, outlineAlpha * 0.7),
		);

		drawLine(tip, farCorner, color, 1, Math.max(0.04, outlineAlpha * 0.7));

		if (index >= MAX_ARROWED_COMPONENTS || frequency === 0) return;

		const componentAngle = Math.atan2(tip.y - center.y, tip.x - center.x);
		const companionAngle = Math.atan2(companionVector.y, companionVector.x);
		const arrowSize = Math.max(4, Math.min(9, length * 0.075));
		const arrowAlpha = Math.max(0.12, 0.5 - index * 0.016) * opacity;

		const primaryEdgeMidpoint = {
			x: (center.x + tip.x) * 0.5,
			y: (center.y + tip.y) * 0.5,
		};

		const companionEdgeMidpoint = {
			x: (center.x + companionTip.x) * 0.5,
			y: (center.y + companionTip.y) * 0.5,
		};

		const oppositePrimaryEdgeMidpoint = {
			x: (companionTip.x + farCorner.x) * 0.5,
			y: (companionTip.y + farCorner.y) * 0.5,
		};

		drawArrowhead(
			primaryEdgeMidpoint.x,
			primaryEdgeMidpoint.y,
			componentAngle,
			color,
			arrowSize,
			arrowAlpha,
		);

		drawArrowhead(
			companionEdgeMidpoint.x,
			companionEdgeMidpoint.y,
			companionAngle,
			color,
			arrowSize * 0.9,
			arrowAlpha * 0.85,
		);

		drawArrowhead(
			oppositePrimaryEdgeMidpoint.x,
			oppositePrimaryEdgeMidpoint.y,
			componentAngle,
			color,
			arrowSize,
			arrowAlpha * 0.7,
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

		// Accurate circular blade area:
		// blade area from r ∧ e₁e₂r is |r|².
		// For a circular disk with the same area, πR² = |r|²,
		// so R = |r| / √π.
		const diskRadius = length / Math.sqrt(Math.PI);

		const diskAlpha = Math.max(0.018, 0.11 - index * 0.0014) * opacity;
		const outlineAlpha = Math.max(0.06, 0.28 - index * 0.003) * opacity;
		const vectorAlpha = Math.max(0.18, 0.74 - index * 0.006) * opacity;

		ctx.globalAlpha = diskAlpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(center.x, center.y, diskRadius, 0, Math.PI * 2);
		ctx.fill();

		ctx.globalAlpha = outlineAlpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(center.x, center.y, diskRadius, 0, Math.PI * 2);
		ctx.stroke();

		ctx.globalAlpha = 1;

		drawLine(
			center,
			tip,
			color,
			Math.max(1, strokeWidth * 0.42),
			vectorAlpha,
		);

		if (index >= MAX_ARROWED_COMPONENTS || frequency === 0) return;

		const direction = frequency >= 0 ? 1 : -1;
		const angle = Math.atan2(tip.y - center.y, tip.x - center.x);
		const oppositeAngle = angle + Math.PI;
		const tangentAngle = angle + direction * Math.PI * 0.5;
		const oppositeTangentAngle = oppositeAngle + direction * Math.PI * 0.5;

		const arrowSize = Math.max(4, Math.min(9, diskRadius * 0.12));
		const arrowAlpha = Math.max(0.14, 0.55 - index * 0.018) * opacity;

		const firstPoint = {
			x: center.x + Math.cos(angle) * diskRadius,
			y: center.y + Math.sin(angle) * diskRadius,
		};

		const secondPoint = {
			x: center.x + Math.cos(oppositeAngle) * diskRadius,
			y: center.y + Math.sin(oppositeAngle) * diskRadius,
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
		if (index >= MAX_VISIBLE_COMPONENTS) return;

		// Accurate companion geometry:
		// |e₁e₂r| = |r|.
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

		if (index >= MAX_ARROWED_COMPONENTS) return;

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

		if (length < 4 || index >= MAX_VISIBLE_COMPONENTS) return;

		if (frequency === 0) {
			drawTranslationComponent(
				center,
				tip,
				color,
				strokeWidth,
				index,
				opacity,
			);

			return;
		}

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
