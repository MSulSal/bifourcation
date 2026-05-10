import type { Point } from "../types/geometry";
import {
	ZERO,
	addMultivectors,
	geometricProduct,
	scaleMultivector,
	vector,
	type Multivector,
} from "./clifford";
import {
	evenMagnitude,
	evenPhase,
	evenMultivectorToVector,
	rotor,
	vectorToEvenMultivector,
} from "./evenSubalgebra";

export type FourierTerm = {
	frequency: number;
	coefficient: Multivector;
	amplitude: number;
	phase: number;
};

export type EpicycleState = {
	center: Multivector;
	tip: Multivector;
	radius: number;
	frequency: number;
	phase: number;
};

export function pointsToVectorSignal(points: Point[]): Multivector[] {
	return points.map(point => vector(point.x, point.y));
}

export function vectorSignalToEvenSignal(
	vectors: Multivector[],
): Multivector[] {
	return vectors.map(vectorToEvenMultivector);
}

export function pointsToEvenSignal(points: Point[]): Multivector[] {
	return vectorSignalToEvenSignal(pointsToVectorSignal(points));
}

export function computeDft(samples: Multivector[]): FourierTerm[] {
	const sampleCount = samples.length;

	if (sampleCount === 0) return [];

	const terms: FourierTerm[] = [];

	for (let k = 0; k < sampleCount; k += 1) {
		let sum: Multivector = ZERO;

		for (let n = 0; n < sampleCount; n += 1) {
			const angle = (-2 * Math.PI * k * n) / sampleCount;
			const basis = rotor(angle);
			const contribution = geometricProduct(samples[n], basis);

			sum = addMultivectors(sum, contribution);
		}

		const frequency = k <= sampleCount / 2 ? k : k - sampleCount;
		const coefficient = scaleMultivector(sum, 1 / sampleCount);

		terms.push({
			frequency,
			coefficient,
			amplitude: evenMagnitude(coefficient),
			phase: evenPhase(coefficient),
		});
	}

	return terms;
}

export function computeFourierTerms(points: Point[]): FourierTerm[] {
	return computeDft(pointsToEvenSignal(points)).sort(
		(a, b) => b.amplitude - a.amplitude,
	);
}

export function evaluateFourierTerms(
	terms: FourierTerm[],
	progress: number,
	termLimit = terms.length,
): {
	epicycles: EpicycleState[];
	point: Multivector;
} {
	const activeTerms = terms.slice(0, termLimit);

	let currentEven = ZERO;
	const epicycles: EpicycleState[] = [];

	for (const term of activeTerms) {
		const center = evenMultivectorToVector(currentEven);

		const angle = 2 * Math.PI * term.frequency * progress;
		const rotatingCoefficient = geometricProduct(
			term.coefficient,
			rotor(angle),
		);

		currentEven = addMultivectors(currentEven, rotatingCoefficient);

		const tip = evenMultivectorToVector(currentEven);

		epicycles.push({
			center,
			tip,
			radius: term.amplitude,
			frequency: term.frequency,
			phase: term.phase,
		});
	}

	return {
		epicycles,
		point: evenMultivectorToVector(currentEven),
	};
}
