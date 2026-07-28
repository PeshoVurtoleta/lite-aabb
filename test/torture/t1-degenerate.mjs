/**
 * Tier T1 -- degenerate values, answers PINNED as they are today.
 *
 * "Pinning 'this returns NaN' is a valid contract; leaving it unpinned is not."
 * Every assertion here documents the CURRENT (1.0.1) behaviour, including the
 * ugly ones the findings call out. When A1/A2/A3 change a behaviour, the
 * corresponding pin here flips deliberately and visibly -- that is the point.
 *
 * A1 owns the complete cross-product (T1 "complete"); A0 wires the load-bearing
 * pins for A-01, A-03, A-04, A-05 and A-10.
 */

import { aabb2 } from '../../Aabb.js';
import { assertEq, assertOk } from './harness.mjs';

const TIER = 'T1';

export function run() {
    const o = new Float32Array(4);

    // --- zero-size and inverted (A-05) ---------------------------------------
    assertEq(TIER, aabb2.area(aabb2.set(o, 5, 5, 5, 5)), 0, 'area(zero-size)');
    assertEq(TIER, aabb2.perimeter(aabb2.set(o, 5, 5, 5, 5)), 0, 'perimeter(zero-size)');

    // Inverted box has a POSITIVE area and does not intersect itself.
    const inv = aabb2.set(new Float32Array(4), 5, 5, 0, 0);
    assertEq(TIER, aabb2.area(inv), 25, 'area(inverted) is positive (A-05)');
    assertOk(TIER, aabb2.intersects(inv, inv) === false, 'inverted box intersects itself (A-05)');

    // Negative-margin inversion (A-05): fatten([0,0,2,2], -3) -> [3,3,-1,-1].
    const a2 = aabb2.set(new Float32Array(4), 0, 0, 2, 2);
    aabb2.fatten(o, a2, -3);
    assertEq(TIER, o[0], 3, 'fatten(-3)[0]');
    assertEq(TIER, o[2], -1, 'fatten(-3)[2]');
    assertEq(TIER, aabb2.area(o), 16, 'area of negative-margin box is +16 (A-05)');
    assertOk(TIER, aabb2.intersects(o, o) === false, 'inverted result does not self-intersect (A-05)');
    assertOk(TIER, aabb2.contains(a2, o) === true, 'source contains its own inverted fatten (A-05)');

    // --- NaN incoherence (A-03) ----------------------------------------------
    const good = aabb2.set(new Float32Array(4), 0, 0, 10, 10);
    const nan = aabb2.set(new Float32Array(4), NaN, NaN, NaN, NaN);

    aabb2.merge(o, good, nan);
    assertOk(TIER, Number.isNaN(o[0]) && Number.isNaN(o[1]) && Number.isNaN(o[2]) && Number.isNaN(o[3]),
        'merge poisons out with NaN (A-03)');

    // overlapArea LAUNDERS NaN into a clean 0; area does not.
    assertEq(TIER, aabb2.overlapArea(good, nan), 0, 'overlapArea(NaN) launders to 0 (A-03)');
    assertOk(TIER, Number.isNaN(aabb2.area(nan)), 'area(NaN) is NaN (A-03)');
    assertOk(TIER, aabb2.intersects(good, nan) === false, 'intersects(NaN) false (A-03)');
    assertOk(TIER, aabb2.contains(good, nan) === false, 'contains(NaN) false (A-03)');

    // --- empty sentinel + infinities (A-04) ----------------------------------
    const sentinel = aabb2.set(new Float32Array(4), Infinity, Infinity, -Infinity, -Infinity);
    assertEq(TIER, aabb2.perimeter(sentinel), -Infinity, 'perimeter(empty sentinel) is -Infinity (A-04)');
    assertEq(TIER, aabb2.area(sentinel), Infinity, 'area(empty sentinel) is +Infinity (A-04)');

    const allPos = aabb2.set(new Float32Array(4), Infinity, Infinity, Infinity, Infinity);
    assertOk(TIER, Number.isNaN(aabb2.area(allPos)), 'area(all +Inf) is NaN (A-04)');

    // The sentinel is already a merge identity (Inf/-Inf collapse to the operand).
    aabb2.merge(o, sentinel, good);
    assertOk(TIER, o[0] === 0 && o[1] === 0 && o[2] === 10 && o[3] === 10,
        'merge(sentinel, b) === b');

    // --- f32 integer boundary (A-10) -----------------------------------------
    aabb2.set(o, 0, 0, 16777217, 1);
    assertEq(TIER, o[2], 16777216, 'f32 integer boundary: 16777217 reads back as 16777216 (A-10)');

    // --- margin evaporation (A-01) -------------------------------------------
    const big = aabb2.set(new Float32Array(4), 1e7, 1e7, 1e7 + 1, 1e7 + 1);
    aabb2.fatten(o, big, 0.5);
    assertEq(TIER, o[0], 1e7, 'fatten margin evaporated on min-x at 1e7 (A-01)');
    assertEq(TIER, o[1], 1e7, 'fatten margin evaporated on min-y at 1e7 (A-01)');
    assertOk(TIER, aabb2.contains(o, big) === true, 'nothing detects the evaporation (A-01)');
}
