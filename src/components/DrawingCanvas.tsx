import { useEffect, useRef } from "react";

export function DrawingCanvas() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();

		canvas.width = rect.width;
		canvas.height = rect.height;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.fillStyle = "#18181b";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}, []);

	return <canvas ref={canvasRef} className="h-full w-full touch-none" />;
}
