import {
	E1,
	addMultivectors,
	bivector,
	geometricProduct,
	projectEven,
	projectOdd,
	scalar,
	type Multivector,
} from "./clifford";

export type EvenMultivector = Multivector;

export function even(
	scalarPart: number,
	bivectorPart: number,
): EvenMultivector {
	return addMultivectors(scalar(scalarPart), bivector(bivectorPart));
}

export function vectorToEvenMultivector(vector: Multivector): EvenMultivector {
	return projectEven(geometricProduct(E1, vector));
}

export function evenMultivectorToVector(
	evenValue: EvenMultivector,
): Multivector {
	return projectOdd(geometricProduct(E1, evenValue));
}

export function rotor(angle: number): EvenMultivector {
	return even(Math.cos(angle), Math.sin(angle));
}

export function evenMagnitude(value: EvenMultivector): number {
	return Math.hypot(value.scalar, value.e1e2);
}

export function evenPhase(value: EvenMultivector): number {
	return Math.atan2(value.e1e2, value.scalar);
}
