import { useEffect, useRef } from "react";
import type { Multivector } from "../math/clifford";
import { evaluateFourierTerms, type FourierTerm } from "../math/fourier";

type EpicycleCanvasProps = {
	terms: FourierTerm[];
	isPlaying: boolean;
	termLimit: number;
};

export function EpicycleCanvas({
	terms,
	isPlaying,
	termLimit,
}: EpicycleCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const startedAtRef = useRef<number | null>(null);
	const traceRef = useRef<Multivector[]>([]);

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
		startedAtRef.current = null;
	}

	function stopAnimation() {
		if (animationFrameRef.current !== null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
	}

	function getCanvasPoint(value: Multivector) {
		return {
			x: value.e1,
			y: value.e2,
		};
	}

	function drawFrame(progress: number) {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, rect.width, rect.height);

		const { epicycles, point } = evaluateFourierTerms(
			terms,
			progress,
			termLimit,
		);

		traceRef.current.push(point);

		for (const epicycle of epicycles) {
			const center = getCanvasPoint(epicycle.center);
			const tip = getCanvasPoint(epicycle.tip);

			ctx.strokeStyle = "rgba(244, 244, 245, 0.18)";
			ctx.lineWidth = 1;

			ctx.beginPath();
			ctx.arc(center.x, center.y, epicycle.radius, 0, Math.PI * 2);
			ctx.stroke();

			ctx.strokeStyle = "rgba(244, 244, 245, 0.55)";
			ctx.lineWidth = 1.5;

			ctx.beginPath();
			ctx.moveTo(center.x, center.y);
			ctx.lineTo(tip.x, tip.y);
			ctx.stroke();
		}

		if (traceRef.current.length > 1) {
			ctx.strokeStyle = "#f4f4f5";
			ctx.lineWidth = 3;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";

			ctx.beginPath();

			const first = getCanvasPoint(traceRef.current[0]);
			ctx.moveTo(first.x, first.y);

			for (const tracePoint of traceRef.current.slice(1)) {
				const canvasPoint = getCanvasPoint(tracePoint);
				ctx.lineTo(canvasPoint.x, canvasPoint.y);
			}

			ctx.stroke();
		}

		const currentPoint = getCanvasPoint(point);

		ctx.fillStyle = "#f4f4f5";
		ctx.beginPath();
		ctx.arc(currentPoint.x, currentPoint.y, 4, 0, Math.PI * 2);
		ctx.fill();
	}

	useEffect(() => {
		resizeCanvasToDisplaySize();

		const canvas = canvasRef.current;
		if (!canvas) return;

		const resizeObserver = new ResizeObserver(() => {
			resizeCanvasToDisplaySize();

			if (!isPlaying) {
				clearOverlay();
			}
		});

		resizeObserver.observe(canvas);

		return () => {
			resizeObserver.disconnect();
		};
	}, [isPlaying]);

	useEffect(() => {
		if (!isPlaying || terms.length === 0) {
			stopAnimation();
			clearOverlay();
			return;
		}

		clearOverlay();

		function animate(timestamp: number) {
			if (startedAtRef.current === null) {
				startedAtRef.current = timestamp;
			}

			const elapsed = timestamp - startedAtRef.current;
			const duration = 8000;
			const progress = (elapsed % duration) / duration;

			if (progress < 0.01) {
				traceRef.current = [];
			}

			drawFrame(progress);

			animationFrameRef.current = requestAnimationFrame(animate);
		}

		animationFrameRef.current = requestAnimationFrame(animate);

		return () => {
			stopAnimation();
		};
	}, [isPlaying, terms, termLimit]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute inset-0 block h-full w-full"
		/>
	);
}
