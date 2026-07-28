/**
 * @zakkster/lite-aabb — Zero-GC 2D Axis-Aligned Bounding Boxes
 *
 * Format: Float32Array(4) -> [minX, minY, maxX, maxY]
 *
 * Every operation that returns an AABB writes into a caller-provided `out`
 * buffer. The only allocators are `create()` and `clone()` — call them at
 * initialization, never in your hot loop.
 *
 * Compatible with the leaf-AABB format expected by `@zakkster/lite-bvh`.
 *
 * @license MIT
 * @author Zahary Shinikchiev
 */

export const aabb2 = {
    /**
     * Allocates a new AABB. Call once at setup; never in a hot loop.
     * @param {number} [minX=0]
     * @param {number} [minY=0]
     * @param {number} [maxX=0]
     * @param {number} [maxY=0]
     * @returns {Float32Array} length 4
     */
    create(minX = 0, minY = 0, maxX = 0, maxY = 0) {
        const out = new Float32Array(4);
        out[0] = minX;
        out[1] = minY;
        out[2] = maxX;
        out[3] = maxY;
        return out;
    },

    /**
     * Allocates a new AABB with the same values as `a`. Call once at setup.
     * @param {Float32Array} a
     * @returns {Float32Array} length 4
     */
    clone(a) {
        const out = new Float32Array(4);
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        out[3] = a[3];
        return out;
    },

    /**
     * Copies `a` into `out`. Zero allocations.
     * @param {Float32Array} out
     * @param {Float32Array} a
     * @returns {Float32Array} `out`
     */
    copy(out, a) {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        out[3] = a[3];
        return out;
    },

    /**
     * Writes explicit bounds into `out`. Zero allocations.
     * @param {Float32Array} out
     * @param {number} minX
     * @param {number} minY
     * @param {number} maxX
     * @param {number} maxY
     * @returns {Float32Array} `out`
     */
    set(out, minX, minY, maxX, maxY) {
        out[0] = minX;
        out[1] = minY;
        out[2] = maxX;
        out[3] = maxY;
        return out;
    },

    /**
     * `out = bounding box enclosing both a and b`. Safe when `out` aliases `a` or `b`.
     * @param {Float32Array} out
     * @param {Float32Array} a
     * @param {Float32Array} b
     * @returns {Float32Array} `out`
     */
    merge(out, a, b) {
        out[0] = Math.min(a[0], b[0]);
        out[1] = Math.min(a[1], b[1]);
        out[2] = Math.max(a[2], b[2]);
        out[3] = Math.max(a[3], b[3]);
        return out;
    },

    /**
     * Enlarges `out` in place to include `b`. Branchless via `Math.min/max`.
     * Equivalent to `merge(out, out, b)` but avoids one indirection.
     * @param {Float32Array} out
     * @param {Float32Array} b
     * @returns {Float32Array} `out`
     */
    extend(out, b) {
        out[0] = Math.min(out[0], b[0]);
        out[1] = Math.min(out[1], b[1]);
        out[2] = Math.max(out[2], b[2]);
        out[3] = Math.max(out[3], b[3]);
        return out;
    },

    /**
     * Perimeter (2*(w+h)). Used as the Surface Area Heuristic cost in 2D BVHs.
     * @param {Float32Array} a
     * @returns {number}
     */
    perimeter(a) {
        const wx = a[2] - a[0];
        const wy = a[3] - a[1];
        return 2 * (wx + wy);
    },

    /**
     * Area (width * height). Negative for inverted boxes (don't do that).
     * @param {Float32Array} a
     * @returns {number}
     */
    area(a) {
        const wx = a[2] - a[0];
        const wy = a[3] - a[1];
        return wx * wy;
    },

    /**
     * Area of the intersection of `a` and `b`. Returns `0` if they don't overlap.
     * @param {Float32Array} a
     * @param {Float32Array} b
     * @returns {number}
     */
    overlapArea(a, b) {
        const minX = Math.max(a[0], b[0]);
        const minY = Math.max(a[1], b[1]);
        const maxX = Math.min(a[2], b[2]);
        const maxY = Math.min(a[3], b[3]);
        const wx = maxX - minX;
        const wy = maxY - minY;
        return wx > 0 && wy > 0 ? wx * wy : 0;
    },

    /**
     * True if `a` and `b` overlap (touching counts as overlapping).
     * @param {Float32Array} a
     * @param {Float32Array} b
     * @returns {boolean}
     */
    intersects(a, b) {
        return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    },

    /**
     * True if `a` fully contains `b` (touching edges count).
     * @param {Float32Array} a
     * @param {Float32Array} b
     * @returns {boolean}
     */
    contains(a, b) {
        return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
    },

    /**
     * Expands `a` by `margin` on every side and writes into `out`.
     * Negative margins are allowed (shrink); the caller is responsible for
     * the result staying non-inverted. Safe when `out === a`.
     * @param {Float32Array} out
     * @param {Float32Array} a
     * @param {number} margin
     * @returns {Float32Array} `out`
     */
    fatten(out, a, margin) {
        out[0] = a[0] - margin;
        out[1] = a[1] - margin;
        out[2] = a[2] + margin;
        out[3] = a[3] + margin;
        return out;
    }
};
