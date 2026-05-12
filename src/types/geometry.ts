export type Point = {
	x: number;
	y: number;
};

export type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type Stroke = {
	color: string;
	width: number;
	points: Point[];
};

export type ShapeKind =
	| "line"
	| "ellipse"
	| "rectangle"
	| "parallelogram"
	| "triangle-equilateral"
	| "triangle-isosceles"
	| "triangle-scalene"
	| "star"
	| "spiral"
	| "sine";

export type ShapeFill = {
	color: string;
	opacity: number;
};

export type BucketFillSpan = {
	x: number;
	y: number;
	width: number;
};

export type BucketFillObject = {
	id: string;
	color: string;
	opacity: number;
	seed: Point;
	canvasWidth: number;
	canvasHeight: number;
	spans: BucketFillSpan[];
};

export type ShapeObject = {
	id: string;
	kind: ShapeKind;
	color: string;
	width: number;
	fill: ShapeFill | null;
	bounds: Rect;
	rotation: number;
	flipX: boolean;
	flipY: boolean;
	skewX: number;
};

export type DrawingObject =
	| {
			type: "freehand";
			id: string;
			stroke: Stroke;
	  }
	| {
			type: "shape";
			id: string;
			shape: ShapeObject;
	  }
	| {
			type: "bucket-fill";
			id: string;
			fill: BucketFillObject;
	  };
