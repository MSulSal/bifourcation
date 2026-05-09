export type BasisBlade = 0 | 1 | 2 | 3;

export type Multivector = {
	scalar: number;
	e1: number;
	e2: number;
	e1e2: number;
};

const BLADE_FIELDS = ["scalar", "e1", "e2", "e1e2"] as const;

type BladeField = (typeof BLADE_FIELDS)[number];

export const BASIS = {
	scalar: 0,
	e1: 1,
	e2: 2,
	e1e2: 3,
} as const satisfies Record<BladeField, BasisBlade>;

export const ZERO: Multivector = {
	scalar: 0,
	e1: 0,
	e2: 0,
	e1e2: 0,
};

export const ONE: Multivector = {
	scalar: 1,
	e1: 0,
	e2: 0,
	e1e2: 0,
};

export const E1: Multivector = {
	scalar: 0,
	e1: 1,
	e2: 0,
	e1e2: 0,
};

export const E2: Multivector = {
	scalar: 0,
	e1: 0,
	e2: 1,
	e1e2: 0,
};

export const E1E2: Multivector = {
	scalar: 0,
	e1: 0,
	e2: 0,
	e1e2: 1,
};

export function multivector(parts: Partial<Multivector> = {}): Multivector {
	return {
		scalar: parts.scalar ?? 0,
		e1: parts.e1 ?? 0,
		e2: parts.e2 ?? 0,
		e1e2: parts.e1e2 ?? 0,
	};
}

export function scalar(value: number): Multivector {
	return multivector({ scalar: value });
}

export function vector(e1: number, e2: number): Multivector {
	return multivector({ e1, e2 });
}

export function bivector(e1e2: number): Multivector {
	return multivector({ e1e2 });
}

export function addMultivectors(a: Multivector, b: Multivector): Multivector {
	return {
		scalar: a.scalar + b.scalar,
		e1: a.e1 + b.e1,
		e2: a.e2 + b.e2,
		e1e2: a.e1e2 + b.e1e2,
	};
}

export function scaleMultivector(
	value: Multivector,
	scale: number,
): Multivector {
	return {
		scalar: value.scalar * scale,
		e1: value.e1 * scale,
		e2: value.e2 * scale,
		e1e2: value.e1e2 * scale,
	};
}

function countSetBits(value: number): number {
	let count = 0;
	let remaining = value;

	while (remaining > 0) {
		count += remaining & 1;
		remaining >>= 1;
	}

	return count;
}

function getCoefficient(value: Multivector, blade: BasisBlade): number {
	return value[BLADE_FIELDS[blade]];
}

function addCoefficient(
	value: Multivector,
	blade: BasisBlade,
	amount: number,
): Multivector {
	const field = BLADE_FIELDS[blade];

	return {
		...value,
		[field]: value[field] + amount,
	};
}

function countSwapsForBasisBladeProduct(
	left: BasisBlade,
	right: BasisBlade,
): number {
	let swaps = 0;

	for (let leftIndex = 0; leftIndex < 2; leftIndex += 1) {
		const leftBasisBit = 1 << leftIndex;

		if ((left & leftBasisBit) === 0) continue;

		const lowerBasisMask = leftBasisBit - 1;
		swaps += countSetBits(right & lowerBasisMask);
	}

	return swaps;
}

export function gradeOfBasisBlade(blade: BasisBlade): number {
	return countSetBits(blade);
}

export function basisBladeProduct(
	left: BasisBlade,
	right: BasisBlade,
): {
	sign: 1 | -1;
	blade: BasisBlade;
} {
	const swaps = countSwapsForBasisBladeProduct(left, right);
	const sign = swaps % 2 === 0 ? 1 : -1;
	const blade = (left ^ right) as BasisBlade;

	return { sign, blade };
}

export function geometricProduct(a: Multivector, b: Multivector): Multivector {
	let result = ZERO;

	const blades: BasisBlade[] = [BASIS.scalar, BASIS.e1, BASIS.e2, BASIS.e1e2];

	for (const leftBlade of blades) {
		const leftCoefficient = getCoefficient(a, leftBlade);
		if (leftCoefficient === 0) continue;

		for (const rightBlade of blades) {
			const rightCoefficient = getCoefficient(b, rightBlade);
			if (rightCoefficient === 0) continue;

			const { sign, blade } = basisBladeProduct(leftBlade, rightBlade);
			const amount = sign * leftCoefficient * rightCoefficient;

			result = addCoefficient(result, blade, amount);
		}
	}

	return result;
}

export function projectGrade(value: Multivector, grade: number): Multivector {
	let result = ZERO;

	const blades: BasisBlade[] = [BASIS.scalar, BASIS.e1, BASIS.e2, BASIS.e1e2];

	for (const blade of blades) {
		if (gradeOfBasisBlade(blade) !== grade) continue;

		result = addCoefficient(result, blade, getCoefficient(value, blade));
	}

	return result;
}

export function projectEven(value: Multivector): Multivector {
	return addMultivectors(projectGrade(value, 0), projectGrade(value, 2));
}

export function projectOdd(value: Multivector): Multivector {
	return projectGrade(value, 1);
}

export function innerProduct(a: Multivector, b: Multivector): number {
	return projectGrade(geometricProduct(a, b), 0).scalar;
}

export function outerProduct(a: Multivector, b: Multivector): Multivector {
	return projectGrade(geometricProduct(a, b), 2);
}

export function geometricProductVectors(
	a: Multivector,
	b: Multivector,
): Multivector {
	return addMultivectors(scalar(innerProduct(a, b)), outerProduct(a, b));
}

export function approximatelyEqualMultivectors(
	a: Multivector,
	b: Multivector,
	tolerance = 1e-12,
): boolean {
	return (
		Math.abs(a.scalar - b.scalar) < tolerance &&
		Math.abs(a.e1 - b.e1) < tolerance &&
		Math.abs(a.e2 - b.e2) < tolerance &&
		Math.abs(a.e1e2 - b.e1e2) < tolerance
	);
}

export function algebraAxiomsHold(): boolean {
	const e1Squared = geometricProduct(E1, E1);
	const e2Squared = geometricProduct(E2, E2);
	const e1TimesE2 = geometricProduct(E1, E2);
	const e2TimesE1 = geometricProduct(E2, E1);
	const bivectorSquared = geometricProduct(E1E2, E1E2);

	return (
		approximatelyEqualMultivectors(e1Squared, ONE) &&
		approximatelyEqualMultivectors(e2Squared, ONE) &&
		approximatelyEqualMultivectors(e1TimesE2, E1E2) &&
		approximatelyEqualMultivectors(e2TimesE1, scaleMultivector(E1E2, -1)) &&
		approximatelyEqualMultivectors(bivectorSquared, scalar(-1))
	);
}
