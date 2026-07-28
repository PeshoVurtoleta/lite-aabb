/**
 * Tier T0 -- metamorphic laws.
 *
 * Properties that must hold for ANY input, checked over the fuzz corpus with
 * zero per-iteration allocation: every result is written into pre-allocated
 * scratch and compared in place.
 *
 * The fatten round-trip law carries the A-01 assertion in BOTH directions:
 * above the ULP floor a positive margin round-trips exactly; below it (large
 * coordinates, tiny margin) fatten provably does NOT widen the box. A0 pins
 * that as current behaviour; A3 owns the fix.
 */

import { aabb2 } from '../../Aabb.js';
import { allocBoxes, fillValidCorpus, xorshift32, assertBoxEq, assertOk, fail } from './harness.mjs';

const TIER = 'T0';
const N = 4096; // corpus size

export function run(h) {
    const rng = xorshift32(h.SEED ^ 0x0000);
    const corpus = allocBoxes(N);
    fillValidCorpus(corpus, rng);

    // Scratch -- allocated once.
    const s1 = new Float32Array(4);
    const s2 = new Float32Array(4);
    const s3 = new Float32Array(4);
    const s4 = new Float32Array(4);

    for (let i = 0; i < N; i++) {
        const a = corpus[i];
        const b = corpus[(i * 7 + 1) % N];
        const c = corpus[(i * 13 + 3) % N];

        // merge commutative (exact in f32: min/max are order-independent).
        aabb2.merge(s1, a, b);
        aabb2.merge(s2, b, a);
        assertBoxEq(TIER, s1, s2, 0, i);

        // merge idempotent.
        aabb2.merge(s2, a, a);
        assertBoxEq(TIER, s2, a, 0, i);

        // merge associative.
        aabb2.merge(s2, a, b);
        aabb2.merge(s3, s2, c);        // (a merge b) merge c
        aabb2.merge(s2, b, c);
        aabb2.merge(s4, a, s2);        // a merge (b merge c)
        assertBoxEq(TIER, s3, s4, 0, i);

        // merge encloses both operands.
        assertOk(TIER, aabb2.contains(s1, a), 'merge does not contain a', i);
        assertOk(TIER, aabb2.contains(s1, b), 'merge does not contain b', i);

        // extend(copy(o,a), b) === merge(o,a,b), bit-for-bit.
        aabb2.copy(s2, a);
        aabb2.extend(s2, b);
        assertBoxEq(TIER, s2, s1, 0, i);

        // predicate symmetry + reflexivity.
        assertOk(TIER, aabb2.contains(a, a), 'contains(a,a) false', i);
        assertOk(TIER, aabb2.intersects(a, b) === aabb2.intersects(b, a), 'intersects asymmetric', i);
        assertOk(TIER, aabb2.overlapArea(a, b) === aabb2.overlapArea(b, a), 'overlapArea asymmetric', i);

        // contains implies intersects.
        if (aabb2.contains(a, b)) {
            assertOk(TIER, aabb2.intersects(a, b), 'contains without intersects', i);
        }

        // overlapArea <= min(area(a), area(b)).
        const ov = aabb2.overlapArea(a, b);
        const minArea = Math.min(aabb2.area(a), aabb2.area(b));
        assertOk(TIER, ov <= minArea + 1e-2, 'overlapArea exceeds min area', i);

        // perimeter monotone under merge.
        const pm = aabb2.perimeter(s1);
        assertOk(TIER, pm >= aabb2.perimeter(a) - 1e-2 && pm >= aabb2.perimeter(b) - 1e-2,
            'perimeter not monotone under merge', i);
    }

    // fatten round-trip ABOVE the floor (small coordinates, margin 2).
    const small = aabb2.set(s1, -3, -3, 5, 5);
    aabb2.fatten(s2, small, 2);
    aabb2.fatten(s2, s2, -2);
    assertBoxEq(TIER, s2, small, 1e-4, -1);

    // A-01 as a law: BELOW the floor, fatten provably does not widen. At 1e7 the
    // f32 ULP is 1.0, so margin 0.5 rounds away on the min sides.
    const big = aabb2.set(s3, 1e7, 1e7, 1e7 + 1, 1e7 + 1);
    aabb2.fatten(s4, big, 0.5);
    if (s4[0] !== big[0] || s4[1] !== big[1]) {
        fail(TIER, 'A-01 regressed: fatten widened below the ULP floor -- expected min sides unchanged '
            + '(this pin belongs to A3, not A0)', { op: -1 });
    }
}
