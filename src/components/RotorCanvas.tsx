import { useEffect, useRef } from "react";
import type { Multivector } from "../math/clifford";
import { evaluateFourierTerms, type FourierTerm } from "../math/fourier";
import type { Point } from "../types/geometry";

export type BivectorView = "blade" | "disk" | "companion";
export type AnimationTraceMode = "sequential" | "simultaneous";

type AnimatedStroke = {
	id: string;
	color: string;
	width: number;
	path: Point[];
	terms: FourierTerm[];
};

type RotorCanvasProps = {
	strokes: AnimatedStroke[];
	isActive: boolean;
	isPlaying: boolean;
	termLimit: number;
	bivectorView: BivectorView;
	animationTraceMode: AnimationTraceMode;
};

type LastDrawnFrame =
	| {
			mode: "sequential";
			strokeIndex: number;
			progress: number;
	  }
	| {
			mode: "simultaneous";
			progress: number;
	  };

const STROKE_DURATION_MS = 6500;
const MAX_VISIBLE_COMPONENTS = 64;
const MAX_ARROWED_COMPONENTS = 24;
const MAX_LABELED_COMPONENTS = 10;

const COMPLETED_STROKE_PROGRESS = 0.999;

export function RotorCanvas({
	strokes,
	isActive,
	isPlaying,
	termLimit,
	bivectorView,
	animationTraceMode,
}: RotorCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const startedAtRef = useRef<number | null>(null);
	const traceRef = useRef<Multivector[]>([]);
	const simultaneousTraceCacheRef = useRef<Map<string, Multivector[]>>(
		new Map(),
	);
	const activeStrokeIndexRef = useRef(0);
	const completedTraceCacheRef = useRef<
		Map<string, { path: Point[]; progress: number }>
	>(new Map());
	const lastDrawnFrameRef = useRef<LastDrawnFrame | null>(null);
	const lastSimultaneousProgressRef = useRef(0);

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
		simultaneousTraceCacheRef.current.clear();
		completedTraceCacheRef.current.clear();
		activeStrokeIndexRef.current = 0;
		startedAtRef.current = null;
		lastDrawnFrameRef.current = null;
		lastSimultaneousProgressRef.current = 0;
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
		ctx.setLineDash([]);

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
		dash: number[] = [],
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
		ctx.setLineDash(dash);

		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();

		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}

	function formatRotorLabel(frequency: number) {
		const sign = frequency > 0 ? "+" : "−";

		return `c${sign}${Math.abs(frequency)}R${sign}${Math.abs(frequency)}(t)`;
	}

	function drawRotorLabel(
		center: Point,
		tip: Point,
		frequency: number,
		color: string,
		index: number,
		opacity: number,
	) {
		if (frequency === 0 || index >= MAX_LABELED_COMPONENTS) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dx = tip.x - center.x;
		const dy = tip.y - center.y;
		const length = Math.hypot(dx, dy);

		if (length < 26) return;

		const normal = {
			x: -dy / length,
			y: dx / length,
		};

		const labelPoint = {
			x: (center.x + tip.x) * 0.5 + normal.x * 13,
			y: (center.y + tip.y) * 0.5 + normal.y * 13,
		};

		const alpha = Math.max(0.08, 0.36 - index * 0.03) * opacity;
		const label = formatRotorLabel(frequency);

		ctx.save();
		ctx.font =
			"10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.lineWidth = 4;
		ctx.strokeStyle = "#18181b";
		ctx.globalAlpha = alpha * 0.85;
		ctx.strokeText(label, labelPoint.x, labelPoint.y);
		ctx.fillStyle = color;
		ctx.globalAlpha = alpha;
		ctx.fillText(label, labelPoint.x, labelPoint.y);
		ctx.restore();
	}

	function drawPolygonHatching(
		points: Point[],
		color: string,
		alpha: number,
		spacing = 9,
	) {
		const canvas = canvasRef.current;
		if (!canvas || points.length === 0) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const xs = points.map(point => point.x);
		const ys = points.map(point => point.y);

		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		const height = maxY - minY;
		const width = maxX - minX;

		ctx.save();

		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);

		for (const point of points.slice(1)) {
			ctx.lineTo(point.x, point.y);
		}

		ctx.closePath();
		ctx.clip();

		ctx.globalAlpha = alpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 5]);

		for (
			let x = minX - height - spacing;
			x <= maxX + width + spacing;
			x += spacing
		) {
			ctx.beginPath();
			ctx.moveTo(x, minY - spacing);
			ctx.lineTo(x + height + spacing * 2, maxY + spacing);
			ctx.stroke();
		}

		ctx.restore();
	}

	function drawDiskHatching(
		center: Point,
		radius: number,
		color: string,
		alpha: number,
		spacing = 9,
	) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.save();

		ctx.beginPath();
		ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
		ctx.clip();

		ctx.globalAlpha = alpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 5]);

		for (
			let x = center.x - radius * 2;
			x <= center.x + radius * 2;
			x += spacing
		) {
			ctx.beginPath();
			ctx.moveTo(x, center.y - radius - spacing);
			ctx.lineTo(x + radius * 2, center.y + radius + spacing);
			ctx.stroke();
		}

		ctx.restore();
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

		const isNegativeFrequency = frequency < 0;

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

		const bladePoints = [center, tip, farCorner, companionTip];

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

		if (isNegativeFrequency) {
			drawPolygonHatching(
				bladePoints,
				color,
				Math.max(0.035, 0.16 - index * 0.0025) * opacity,
			);
		}

		ctx.globalAlpha = outlineAlpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.setLineDash(isNegativeFrequency ? [5, 5] : []);

		ctx.beginPath();
		ctx.moveTo(center.x, center.y);
		ctx.lineTo(tip.x, tip.y);
		ctx.lineTo(farCorner.x, farCorner.y);
		ctx.lineTo(companionTip.x, companionTip.y);
		ctx.closePath();
		ctx.stroke();

		ctx.setLineDash([]);
		ctx.globalAlpha = 1;

		drawLine(
			center,
			tip,
			color,
			Math.max(1, strokeWidth * 0.44),
			vectorAlpha,
		);

		drawLine(
			center,
			companionTip,
			color,
			Math.max(1, strokeWidth * 0.34),
			companionAlpha,
			isNegativeFrequency ? [5, 5] : [],
		);

		drawLine(
			companionTip,
			farCorner,
			color,
			1,
			Math.max(0.04, outlineAlpha * 0.7),
			isNegativeFrequency ? [4, 5] : [],
		);

		drawLine(
			tip,
			farCorner,
			color,
			1,
			Math.max(0.04, outlineAlpha * 0.7),
			isNegativeFrequency ? [4, 5] : [],
		);

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

		const isNegativeFrequency = frequency < 0;

		const diskRadius = length / Math.sqrt(Math.PI);

		const diskAlpha = Math.max(0.018, 0.11 - index * 0.0014) * opacity;
		const hatchAlpha = Math.max(0.035, 0.15 - index * 0.002) * opacity;
		const outlineAlpha = Math.max(0.06, 0.28 - index * 0.003) * opacity;
		const vectorAlpha = Math.max(0.18, 0.74 - index * 0.006) * opacity;

		ctx.globalAlpha = diskAlpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(center.x, center.y, diskRadius, 0, Math.PI * 2);
		ctx.fill();

		if (isNegativeFrequency) {
			drawDiskHatching(center, diskRadius, color, hatchAlpha);
		}

		ctx.globalAlpha = outlineAlpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.setLineDash(isNegativeFrequency ? [5, 5] : []);
		ctx.beginPath();
		ctx.arc(center.x, center.y, diskRadius, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);

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
		frequency: number,
		color: string,
		strokeWidth: number,
		index: number,
		opacity: number,
	) {
		if (index >= MAX_VISIBLE_COMPONENTS) return;

		const isNegativeFrequency = frequency < 0;

		const companionTip = {
			x: center.x + companionUnit.x * length,
			y: center.y + companionUnit.y * length,
		};

		const vectorAlpha = Math.max(0.2, 0.72 - index * 0.006) * opacity;
		const companionAlpha = Math.max(0.12, 0.42 - index * 0.004) * opacity;

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
			isNegativeFrequency ? [6, 5] : [],
		);

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
			frequency,
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

		const { rotors, point } = evaluateFourierTerms(
			stroke.terms,
			progress,
			activeTermLimit,
		);

		for (const [index, rotor] of rotors.entries()) {
			const center = getCanvasPoint(rotor.center);
			const tip = getCanvasPoint(rotor.tip);

			drawOrientedComponent(
				center,
				tip,
				rotor.frequency,
				stroke.color,
				stroke.width,
				index,
				opacity,
			);
		}

		for (const [index, rotor] of rotors.entries()) {
			const center = getCanvasPoint(rotor.center);
			const tip = getCanvasPoint(rotor.tip);

			drawRotorLabel(
				center,
				tip,
				rotor.frequency,
				stroke.color,
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

	function cacheCompletedTrace(stroke: AnimatedStroke | undefined) {
		if (!stroke || traceRef.current.length < 2) return;

		const cachedProgress =
			lastDrawnFrameRef.current?.mode === "sequential" &&
			lastDrawnFrameRef.current.strokeIndex ===
				activeStrokeIndexRef.current
				? lastDrawnFrameRef.current.progress
				: COMPLETED_STROKE_PROGRESS;

		completedTraceCacheRef.current.set(stroke.id, {
			path: traceRef.current.map(getCanvasPoint),
			progress: cachedProgress,
		});
	}

	function drawCompletedStroke(stroke: AnimatedStroke) {
		const completedTrace = completedTraceCacheRef.current.get(stroke.id);

		if (completedTrace) {
			drawPath(
				completedTrace.path,
				stroke.color,
				Math.max(2, stroke.width),
				0.95,
			);

			drawBladeSet(stroke, completedTrace.progress, {
				opacity: 0.72,
				showTip: false,
			});
		}
	}

	function drawSequentialFrame(
		strokeIndex: number,
		progress: number,
		options: {
			appendTrace?: boolean;
		} = {},
	) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const appendTrace = options.appendTrace ?? true;

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

		if (point && appendTrace) {
			traceRef.current.push(point);
		}

		drawTrace(
			traceRef.current,
			activeStroke.color,
			Math.max(2, activeStroke.width),
			1,
		);

		lastDrawnFrameRef.current = {
			mode: "sequential",
			strokeIndex,
			progress,
		};
	}

	function getSimultaneousTrace(strokeId: string) {
		const existingTrace = simultaneousTraceCacheRef.current.get(strokeId);

		if (existingTrace) return existingTrace;

		const nextTrace: Multivector[] = [];
		simultaneousTraceCacheRef.current.set(strokeId, nextTrace);

		return nextTrace;
	}

	function clearSimultaneousTraces() {
		simultaneousTraceCacheRef.current.clear();
	}

	function drawSimultaneousFrame(
		progress: number,
		options: {
			appendTrace?: boolean;
		} = {},
	) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const appendTrace = options.appendTrace ?? true;
		const rotorOpacity = strokes.length > 4 ? 0.62 : 0.86;

		ctx.clearRect(0, 0, rect.width, rect.height);

		for (const stroke of strokes) {
			const trace = getSimultaneousTrace(stroke.id);

			drawTrace(trace, stroke.color, Math.max(2, stroke.width), 0.95);
		}

		for (const stroke of strokes) {
			const point = drawBladeSet(stroke, progress, {
				opacity: rotorOpacity,
				showTip: true,
			});

			if (point && appendTrace) {
				const trace = getSimultaneousTrace(stroke.id);
				trace.push(point);
			}
		}

		for (const stroke of strokes) {
			const trace = getSimultaneousTrace(stroke.id);

			drawTrace(trace, stroke.color, Math.max(2, stroke.width), 1);
		}

		lastDrawnFrameRef.current = {
			mode: "simultaneous",
			progress,
		};
	}

	function redrawLastFrameWithoutAppending() {
		const lastFrame = lastDrawnFrameRef.current;

		if (!lastFrame) return false;

		if (lastFrame.mode === "sequential") {
			drawSequentialFrame(lastFrame.strokeIndex, lastFrame.progress, {
				appendTrace: false,
			});

			return true;
		}

		drawSimultaneousFrame(lastFrame.progress, {
			appendTrace: false,
		});

		return true;
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

			redrawLastFrameWithoutAppending();
		});

		resizeObserver.observe(canvas);

		return () => {
			resizeObserver.disconnect();
		};
	}, [isActive, strokes, termLimit, bivectorView, animationTraceMode]);

	useEffect(() => {
		traceRef.current = [];
		simultaneousTraceCacheRef.current.clear();
		completedTraceCacheRef.current.clear();
		activeStrokeIndexRef.current = 0;
		lastDrawnFrameRef.current = null;
		startedAtRef.current = null;
		lastSimultaneousProgressRef.current = 0;
	}, [strokes, termLimit, animationTraceMode]);

	useEffect(() => {
		if (!isActive || strokes.length === 0) {
			stopAnimation();
			clearOverlay();
			return;
		}

		if (!isPlaying) {
			stopAnimation();

			if (redrawLastFrameWithoutAppending()) {
				return;
			}

			traceRef.current = [];
			simultaneousTraceCacheRef.current.clear();
			activeStrokeIndexRef.current = 0;

			if (animationTraceMode === "simultaneous") {
				drawSimultaneousFrame(0, { appendTrace: false });
				return;
			}

			drawSequentialFrame(0, 0, { appendTrace: false });

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

			const elapsed = timestamp - startedAtRef.current;

			if (animationTraceMode === "simultaneous") {
				const loopElapsed = elapsed % STROKE_DURATION_MS;
				const progress = loopElapsed / STROKE_DURATION_MS;

				if (progress < lastSimultaneousProgressRef.current) {
					clearSimultaneousTraces();
				}

				drawSimultaneousFrame(progress);
				lastSimultaneousProgressRef.current = progress;
				animationFrameRef.current = requestAnimationFrame(animate);

				return;
			}

			const animationDuration = strokes.length * STROKE_DURATION_MS;
			const loopElapsed = elapsed % animationDuration;

			const strokeIndex = Math.min(
				strokes.length - 1,
				Math.floor(loopElapsed / STROKE_DURATION_MS),
			);

			const strokeElapsed =
				loopElapsed - strokeIndex * STROKE_DURATION_MS;
			const progress = strokeElapsed / STROKE_DURATION_MS;

			if (strokeIndex !== activeStrokeIndexRef.current) {
				cacheCompletedTrace(strokes[activeStrokeIndexRef.current]);
				traceRef.current = [];
				activeStrokeIndexRef.current = strokeIndex;
			}

			if (
				strokeIndex === 0 &&
				activeStrokeIndexRef.current !== 0 &&
				progress < 0.02
			) {
				completedTraceCacheRef.current.clear();
			}

			drawSequentialFrame(strokeIndex, progress);

			animationFrameRef.current = requestAnimationFrame(animate);
		}

		animationFrameRef.current = requestAnimationFrame(animate);

		return () => {
			stopAnimation();
		};
	}, [
		isActive,
		isPlaying,
		strokes,
		termLimit,
		bivectorView,
		animationTraceMode,
	]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute inset-0 block h-full w-full"
		/>
	);
}
