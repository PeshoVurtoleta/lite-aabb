/**
 * Tier T6 -- the zero-alloc gate.
 *
 * Pre-allocate every box OUTSIDE the loop, run the ten hot ops N times inside
 * a single lite-gc-profiler window, and gate at maxMajor:0 / maxPauseMs:4. The
 * summary is read only after an awaited settle tick (see harness.gcGate).
 *
 * CONTROL: with TORTURE_CONTROL=alloc the loop allocates and RETAINS a fresh
 * box each iteration. That forces real major collections, the gate goes red,
 * and this tier throws -- the executable proof that the gate can fail. (aabb's
 * hot ops allocate no ArrayBuffer backing stores, so the B-08-class
 * maxArrayBuffersGrowth gate is a lite-bvh concern, not one this tier needs.)
 */

import { aabb2 } from '../../Aabb.js';

const TIER = 'T6';
const N = 300000;

export async function run(h) {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    const out = aabb2.create();
    const out2 = new Float32Array(2); // A4: closestPoint's length-2 out buffer

    const alloc = h.CONTROL === 'alloc';
    const sink = alloc ? [] : null;

    function hot() {
        for (let i = 0; i < N; i++) {
            aabb2.merge(out, a, b);
            aabb2.extend(out, b);
            aabb2.fatten(out, a, 1);
            aabb2.intersects(a, b);
            aabb2.overlapArea(a, b);
            aabb2.perimeter(out);
            aabb2.area(out);
            aabb2.containsPoint(a, 5, 5);   // A4
            aabb2.distanceSq(a, b);          // A4
            aabb2.closestPoint(out2, a, 20, -5); // A4
            if (alloc) sink.push(aabb2.create()); // control: allocate + retain.
        }
    }

    // Warm the call sites so V8 inlines them, then clear the young generation
    // BEFORE the measured window opens.
    for (let i = 0; i < 5000; i++) {
        aabb2.merge(out, a, b);
        aabb2.extend(out, b);
        aabb2.fatten(out, a, 1);
        aabb2.intersects(a, b);
        aabb2.overlapArea(a, b);
    }
    h.maybeGc();

    const { report, summary } = await h.gcGate(hot, h.RULES);
    if (!report.ok) {
        h.fail(TIER,
            'hot ops allocated: verdict=' + report.verdict + ' source=' + summary.source +
            ' major=' + summary.gc.major + ' maxMs=' + summary.gc.maxMs.toFixed(3) +
            (alloc ? ' (alloc control -- expected)' : ''),
            {});
    }
}
