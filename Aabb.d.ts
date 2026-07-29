/**
 * @zakkster/lite-aabb
 * Zero-GC 2D Axis-Aligned Bounding Boxes
 *
 * Format: Float32Array(4) -> [minX, minY, maxX, maxY]
 */

/** An axis-aligned bounding box: a length-4 `Float32Array` `[minX, minY, maxX, maxY]`. */
export type AABB2 = Float32Array;

/** Package version. Kept in sync with package.json and CHANGELOG.md. */
export const VERSION: string;

export const aabb2: {
    /** Allocates. Call once at setup. */
    create(minX?: number, minY?: number, maxX?: number, maxY?: number): AABB2;

    /** Allocates. Call once at setup. */
    clone(a: AABB2): AABB2;

    /** Copies `a` into `out`. Zero allocations. `out` may alias `a` under any view. */
    copy(out: AABB2, a: AABB2): AABB2;

    /** Writes explicit bounds into `out`. Zero allocations. */
    set(out: AABB2, minX: number, minY: number, maxX: number, maxY: number): AABB2;

    /**
     * `out = bounding box enclosing both a and b`. `out` may safely alias `a`,
     * `b`, or a shifted/overlapping view of either (v1.0.2+; see the aliasing
     * contract). Zero allocations.
     */
    merge(out: AABB2, a: AABB2, b: AABB2): AABB2;

    /** Enlarges `out` in place to include `b`. Equivalent to `merge(out, out, b)`. `b` may alias/overlap `out`. */
    extend(out: AABB2, b: AABB2): AABB2;

    /** `2 * (width + height)`. Surface Area Heuristic cost in 2D BVHs. */
    perimeter(a: AABB2): number;

    /** `width * height`. Negative for inverted boxes (don't do that). */
    area(a: AABB2): number;

    /**
     * Area of the intersection of `a` and `b`. Returns `0` for a genuine
     * non-overlap, but **`NaN` if either box carries a `NaN` coordinate**
     * (v1.1.0+: NaN propagates, it is no longer laundered to `0`).
     */
    overlapArea(a: AABB2, b: AABB2): number;

    /** True if `a` and `b` overlap (touching counts as overlapping). */
    intersects(a: AABB2, b: AABB2): boolean;

    /** True if `a` fully contains `b` (touching edges count). */
    contains(a: AABB2, b: AABB2): boolean;

    /** Expands `a` by `margin` on every side and writes into `out`. `out` may alias `a` under any view. */
    fatten(out: AABB2, a: AABB2, margin: number): AABB2;

    /**
     * True if `a` is safe to do geometry with: four finite coordinates and
     * `min <= max` on both axes. False for NaN, mixed infinities, and inverted
     * boxes. The empty sentinel is not valid -- use `isEmpty`. (v1.1.0+)
     */
    isValid(a: AABB2): boolean;

    /** True if `a` is exactly the canonical empty box `[Inf, Inf, -Inf, -Inf]`. (v1.1.0+) */
    isEmpty(a: AABB2): boolean;

    /** Writes the canonical empty box `[Inf, Inf, -Inf, -Inf]` into `out`; the seed for a merge/extend reduction. (v1.1.0+) */
    setEmpty(out: AABB2): AABB2;

    /**
     * The smallest margin that provably widens `a` on all four sides at its
     * coordinates: the float32 ULP of the largest-magnitude coordinate. A
     * smaller margin rounds away silently (finding A-01). Clamp with it:
     * `fatten(out, a, Math.max(margin, marginFloor(a)))`. Returns `NaN` for a
     * NaN coordinate and `Infinity` for an infinite one. Zero allocations.
     * (v1.2.0+)
     */
    marginFloor(a: AABB2): number;
};
