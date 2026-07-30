/**
 * @zakkster/lite-aabb -- Zero-GC 2D Axis-Aligned Bounding Boxes
 *
 * Format: Float32Array(4) -> [minX, minY, maxX, maxY]
 *
 * Every operation that returns an AABB writes into a caller-provided `out`
 * buffer. The only allocators are `create()` and `clone()` -- call them at
 * initialization, never in your hot loop.
 *
 * Compatible with the leaf-AABB format expected by `@zakkster/lite-bvh`.
 *
 * @license MIT
 * @author Zahary Shinikchiev
 */

/** Package version. Keep in sync with package.json and CHANGELOG.md (three-place sync). */
export const VERSION = '2.0.0';

/**
 * The version of the shared FORMAT contract (see FORMAT.md), NOT the package
 * version. `@zakkster/lite-bvh` exports the identical constant; the two packages
 * compare it for equality to detect a format skew. It is an integer compared for
 * equality, on a separate axis from `VERSION` -- do not sync it to semver.
 * Bumps only when the buffer layout itself changes (decisions/0005). (v2.0.0+)
 */
export const FORMAT_VERSION = 1;

/*
 * Module-private scratch for marginFloor's exact float32-ULP computation.
 * Allocated ONCE at import, never in a hot path, never resized. Reading a
 * value's next representable float32 via its bit pattern is exact across the
 * whole normal range -- unlike Math.log2, which rounds at powers of two.
 * This is module-local state with no externally observable effect, so it does
 * not violate `sideEffects: false`.
 */
const _ulpF32 = new Float32Array(1);
const _ulpI32 = new Int32Array(_ulpF32.buffer);

/**
 * Aliasing contract (see decisions/0001-aliasing.md):
 *
 *   `out` may safely alias ANY input, under ANY view relationship -- the same
 *   view, a shifted/partially-overlapping view of one buffer, or a distinct
 *   buffer. Every writer below snapshots all of its array inputs into locals
 *   BEFORE the first write to `out`, so a write can never clobber a slot that a
 *   later read still needs. These are register-resident locals in V8: no
 *   allocation is added to any hot body (proven by test/torture t6 + the
 *   assertOps gate; measured numbers in the decision record).
 *
 * The namespace is frozen (A-06): its operations are a contract, not a mutable
 * bag. Reassigning a method throws in strict mode (ESM is always strict).
 *
 * Degenerate-value law (see decisions/0002-degenerate-values.md):
 *
 *   NaN propagates -- it is never laundered into a clean number. Every box is
 *   one of three states: VALID (four finite coordinates, min <= max), EMPTY
 *   (the canonical sentinel [Inf,Inf,-Inf,-Inf], a merge identity), or GARBAGE
 *   (NaN, mixed infinities, or inverted). The hot ops are TOTAL but only
 *   meaningful on valid boxes: geometry on a non-valid box returns whatever the
 *   arithmetic yields -- it never throws and never allocates. Gate at trust
 *   boundaries with `isValid`; recognize / build the empty box with `isEmpty` /
 *   `setEmpty`. Validation is never bolted into a hot op (the one carve-out is
 *   `overlapArea`, which stops laundering NaN -- measured cost in the record).
 *
 * Precision law (see decisions/0003-precision.md):
 *
 *   Float32 has a coordinate-dependent step (ULP). Once the requested `fatten`
 *   margin drops below that step, it rounds away and the box does not widen --
 *   silently, since `contains` still returns true (A-01). This is a property of
 *   f32, not a bug in `fatten`, so `fatten` is UNCHANGED: it never gains a
 *   branch and never bumps the result. Instead `marginFloor(a)` reports the
 *   smallest margin that provably widens the box at its coordinates, and the
 *   caller clamps: `fatten(out, a, Math.max(margin, marginFloor(a)))`. Same
 *   boundary-predicate shape as `isValid` -- detection lives at the door, the
 *   hot body stays branchless.
 */
export const aabb2 = Object.freeze({
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
        // Snapshot before writing: safe even when `out` is a shifted view of `a`.
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        out[0] = a0;
        out[1] = a1;
        out[2] = a2;
        out[3] = a3;
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
        // Snapshot both inputs before writing: safe under any aliasing of
        // `out`, `a`, `b`, including shifted/overlapping views of one buffer.
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = Math.min(a0, b0);
        out[1] = Math.min(a1, b1);
        out[2] = Math.max(a2, b2);
        out[3] = Math.max(a3, b3);
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
        // `out` is both source and destination. Snapshot both (out and b)
        // before writing so an overlapping-view `b` reads its pre-write values.
        const o0 = out[0], o1 = out[1], o2 = out[2], o3 = out[3];
        const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = Math.min(o0, b0);
        out[1] = Math.min(o1, b1);
        out[2] = Math.max(o2, b2);
        out[3] = Math.max(o3, b3);
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
        if (wx > 0 && wy > 0) return wx * wy;
        // NaN in -> NaN out (A-03): a NaN coordinate poisons wx/wy, and we
        // propagate it instead of laundering it to a clean 0. A genuine
        // non-overlap (finite, touching or disjoint) still returns 0.
        return wx !== wx || wy !== wy ? NaN : 0;
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
        // Snapshot before writing: safe when `out` is a shifted view of `a`.
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        out[0] = a0 - margin;
        out[1] = a1 - margin;
        out[2] = a2 + margin;
        out[3] = a3 + margin;
        return out;
    },

    // --- degenerate-value law (A2, see decisions/0002-degenerate-values.md) ---
    // Opt-in predicates + sentinel builder. These are NEW surface; they are how
    // a caller checks a box at a trust boundary. They are NOT guards bolted into
    // the twelve ops above -- those stay branchless (the sole exception is
    // overlapArea's NaN check).

    /**
     * True if `a` is a box you can safely do geometry with: all four
     * coordinates finite AND `min <= max` on both axes. False for NaN, for
     * mixed infinities, and for inverted boxes; true for zero-size boxes. The
     * canonical empty sentinel is NOT valid (it is non-finite by construction)
     * -- recognize it with `isEmpty`. Zero allocations.
     * @param {Float32Array} a
     * @returns {boolean}
     */
    isValid(a) {
        return Number.isFinite(a[0]) && Number.isFinite(a[1]) &&
               Number.isFinite(a[2]) && Number.isFinite(a[3]) &&
               a[0] <= a[2] && a[1] <= a[3];
    },

    /**
     * True if `a` is exactly the canonical empty box `[Inf, Inf, -Inf, -Inf]`.
     * That box is the identity of `merge`/`extend` (min/max collapse to the
     * other operand), so it is the correct seed for an accumulating reducer.
     * Zero allocations.
     * @param {Float32Array} a
     * @returns {boolean}
     */
    isEmpty(a) {
        return a[0] === Infinity && a[1] === Infinity &&
               a[2] === -Infinity && a[3] === -Infinity;
    },

    /**
     * Writes the canonical empty box `[Inf, Inf, -Inf, -Inf]` into `out` and
     * returns it. Use this as the seed for a `merge`/`extend` reduction instead
     * of hand-rolling the sentinel. Do NOT call `area`/`perimeter` on the empty
     * box (they are `+Infinity`/`-Infinity`); guard with `isValid` first.
     * Zero allocations.
     * @param {Float32Array} out
     * @returns {Float32Array} `out`
     */
    setEmpty(out) {
        out[0] = Infinity;
        out[1] = Infinity;
        out[2] = -Infinity;
        out[3] = -Infinity;
        return out;
    },

    /**
     * The smallest margin that PROVABLY widens `a` on all four sides at its
     * coordinates: the float32 ULP (gap to the next representable value) of the
     * largest-magnitude coordinate. Any `margin >= marginFloor(a)` is guaranteed
     * to move every side; a smaller margin may round away (finding A-01). Use it
     * to clamp: `fatten(out, a, Math.max(margin, marginFloor(a)))`.
     *
     * The upper ULP is returned deliberately -- it is the coarser of the two
     * steps around the coordinate, so it widens both the subtracted min sides
     * and the added max sides (e.g. at 2^24 the min side moves by 1.0 but the
     * max side needs 2.0). Defined on any box: it reads magnitudes, not order.
     *
     * Fail closed on non-finite input: a NaN coordinate yields NaN; an infinite
     * coordinate yields Infinity (no finite margin widens an infinite box). A
     * zero box yields the smallest subnormal, the true minimal step near zero.
     * Zero allocations (the ULP scratch is allocated once at module load).
     * @param {Float32Array} a
     * @returns {number}
     */
    marginFloor(a) {
        const m = Math.max(Math.abs(a[0]), Math.abs(a[1]),
                           Math.abs(a[2]), Math.abs(a[3]));
        // m is Infinity or NaN here iff a coordinate was non-finite.
        if (!(m < Infinity)) return m === m ? Infinity : NaN;
        _ulpF32[0] = m;      // round the magnitude to float32
        _ulpI32[0] += 1;     // bit pattern of the next float32 above m (m >= 0)
        return _ulpF32[0] - m;
    },

    // --- 2D op set (A4, see decisions/0004-2d-op-set.md) ---
    // Point containment, box-to-box squared distance, closest point on a box.
    // Pure, branchless, zero-alloc; they obey the touching-edge convention
    // (A-02), the aliasing rule (A1), and the degenerate law (A2) like every op
    // above. NEW surface only -- nothing pinned changes.

    /**
     * True if the point `(px, py)` lies inside `a`, edges and corners included
     * (the A-02 touching convention, same as `contains`). A point is equivalent
     * to a zero-size box here: `containsPoint(a, px, py)` agrees with
     * `contains(a, [px, py, px, py])`.
     *
     * Fails closed on NaN: a NaN in the point or the box makes a comparison
     * false, so the result is `false` -- never a spurious `true`. (Boolean
     * predicates fail closed; the numeric ops propagate NaN as a value.)
     * Zero allocations.
     * @param {Float32Array} a
     * @param {number} px
     * @param {number} py
     * @returns {boolean}
     */
    containsPoint(a, px, py) {
        return px >= a[0] && px <= a[2] && py >= a[1] && py <= a[3];
    },

    /**
     * Squared Euclidean distance between boxes `a` and `b`. `0` when they
     * overlap OR touch; the true squared gap when disjoint. Symmetric.
     *
     * Squared, not distance -- the caller takes one `Math.sqrt` if they need the
     * metric, and comparisons (`distanceSq(a, b) < r * r`) need no root at all.
     * NaN propagates (A2): a NaN coordinate yields NaN, never a laundered 0.
     * Zero allocations.
     * @param {Float32Array} a
     * @param {Float32Array} b
     * @returns {number}
     */
    distanceSq(a, b) {
        // Per axis: positive only when the intervals are strictly apart; 0 when
        // they overlap or touch. Math.max(0, NaN, x) is NaN, so NaN propagates.
        const dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
        const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
        return dx * dx + dy * dy;
    },

    /**
     * Closest point on box `a` to the query point `(px, py)`, written into
     * `out2`. Inside the box the point maps to itself; outside, to the nearest
     * edge or corner. Idempotent (the closest point of a closest point is
     * itself).
     *
     * IMPORTANT: `out2` is a LENGTH-2 `Float32Array` (a Vec2 `[x, y]`), NOT a
     * length-4 AABB. It is the only length-2 buffer in this package; passing a
     * length-4 box here (or this result to a box op) will read/write the wrong
     * slots without throwing. The `out2` name marks the arity at the call site.
     *
     * `out2` may safely alias `a` under any view relationship: `a`'s bounds are
     * snapshotted before the first write (aliasing law, A1). Zero allocations.
     * @param {Float32Array} out2 length 2
     * @param {Float32Array} a
     * @param {number} px
     * @param {number} py
     * @returns {Float32Array} `out2`
     */
    closestPoint(out2, a, px, py) {
        // Snapshot before writing: safe when out2 is a shifted view of a.
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        out2[0] = Math.min(Math.max(px, a0), a2);
        out2[1] = Math.min(Math.max(py, a1), a3);
        return out2;
    },

    // --- packed 4*N batch ops (X1, see decisions/0005-format-and-batch.md) ---
    // Operate over a packed Float32Array of N boxes (4*N floats, box i at slots
    // 4i..4i+3), so a broadphase feed fattens / unions / probes many boxes in one
    // call without a per-box view. `count` bounds every loop -- a count of 0,
    // negative, or NaN runs zero iterations (fail closed). The caller owns buffer
    // length (inPacked.length >= 4*count); an out-of-range read yields NaN, which
    // propagates. See FORMAT.md for the layout and the packed aliasing rules.

    /**
     * Fattens each of `count` boxes in `inPacked` by `margin` and writes them
     * into `outPacked`, box for box. Mirrors `fatten` exactly: subtract `margin`
     * from the mins, add to the maxes, no auto-clamp (the margin floor stays the
     * caller's job -- clamp per box with `marginFloor` if you need it). Returns
     * `outPacked`.
     *
     * Aliasing (A1, decisions/0005 D4): `outPacked === inPacked` (in place) is
     * safe, and a fully-disjoint `outPacked` is safe. A SHIFTED/overlapping view
     * of `inPacked` is NOT supported -- an element-wise write to box i would
     * clobber a neighbour's input. Use in-place or a disjoint buffer.
     * Zero allocations.
     * @param {Float32Array} outPacked length >= 4*count
     * @param {Float32Array} inPacked length >= 4*count
     * @param {number} margin
     * @param {number} count number of boxes
     * @returns {Float32Array} `outPacked`
     */
    fattenAll(outPacked, inPacked, margin, count) {
        for (let i = 0; i < count; i++) {
            const j = i << 2;
            // Snapshot the box's four slots before writing (in-place safe).
            const x0 = inPacked[j], y0 = inPacked[j + 1];
            const x1 = inPacked[j + 2], y1 = inPacked[j + 3];
            outPacked[j] = x0 - margin;
            outPacked[j + 1] = y0 - margin;
            outPacked[j + 2] = x1 + margin;
            outPacked[j + 3] = y1 + margin;
        }
        return outPacked;
    },

    /**
     * Unions `count` boxes from `inPacked` into the single box `out4`. Returns
     * `out4`. Seeded with the canonical empty box, so `count === 0` yields the
     * empty sentinel `[Inf, Inf, -Inf, -Inf]` (`isEmpty(out4)` is then true) --
     * the correct bounding box of zero boxes and a valid merge-reduction seed.
     *
     * All reads happen before the single terminal write, so `out4` may safely
     * alias ANYWHERE in `inPacked` (A1, decisions/0005 D4). Zero allocations.
     * @param {Float32Array} out4 length 4
     * @param {Float32Array} inPacked length >= 4*count
     * @param {number} count number of boxes
     * @returns {Float32Array} `out4`
     */
    mergeAll(out4, inPacked, count) {
        // Accumulate in registers; write out4 once at the end (alias-safe).
        // Math.min/max (not comparisons) so this folds EXACTLY like `merge`:
        // NaN propagates instead of being skipped, and the Inf/-Inf seed makes
        // count === 0 collapse to the empty sentinel.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < count; i++) {
            const j = i << 2;
            minX = Math.min(minX, inPacked[j]);
            minY = Math.min(minY, inPacked[j + 1]);
            maxX = Math.max(maxX, inPacked[j + 2]);
            maxY = Math.max(maxY, inPacked[j + 3]);
        }
        out4[0] = minX;
        out4[1] = minY;
        out4[2] = maxX;
        out4[3] = maxY;
        return out4;
    },

    /**
     * Returns the lowest index in `[0, count)` whose box in `inPacked`
     * intersects `b`, or `-1` if none do. Touching edges count as intersecting
     * (the A-02 convention, the same test as `intersects`). `count === 0`
     * returns `-1`. Read-only -- `b` may itself be a view into `inPacked`.
     * Zero allocations.
     * @param {Float32Array} inPacked length >= 4*count
     * @param {Float32Array} b length 4
     * @param {number} count number of boxes
     * @returns {number} first intersecting index, or -1
     */
    intersectsAny(inPacked, b, count) {
        const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        for (let i = 0; i < count; i++) {
            const j = i << 2;
            if (inPacked[j] <= b2 && inPacked[j + 2] >= b0 &&
                inPacked[j + 1] <= b3 && inPacked[j + 3] >= b1) {
                return i;
            }
        }
        return -1;
    }
});
