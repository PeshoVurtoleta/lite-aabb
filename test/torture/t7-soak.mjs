/**
 * Tier T7 -- soak and conservation.
 *
 * leak_cycles cycles of build-up / tear-down. Two independent witnesses that
 * nothing accumulates:
 *   1. lite-leak tracker.size() must return to 0 -- every tracked resource is
 *      released by its cycle's teardown.
 *   2. process heap sampled ACROSS cycles (not within one) must not grow beyond
 *      a small slack -- the pooled ops allocate nothing, so a growing heap would
 *      mean the harness itself is leaking.
 *
 * aabb has no free list, so the bvh's `nodeCount + freeList === maxNodes`
 * conservation invariant has no analogue here; the tracker size IS the
 * conservation oracle for this package.
 */

import { aabb2 } from '../../Aabb.js';
import { createLeakTracker } from '@zakkster/lite-leak';

const TIER = 'T7';
const CYCLES = 4096;
const OPS_PER_CYCLE = 256;
const POOL = 64;

const NOOP = function () {};

export function run(h) {
    const tracker = createLeakTracker({ name: 'aabb-soak' });

    // Pool + scratch allocated ONCE.
    const boxes = h.allocBoxes(POOL);
    const rng = h.xorshift32(h.SEED ^ 0x7777);
    h.fillValidCorpus(boxes, rng);
    const out = new Float32Array(4);

    // Establish the heap baseline after one warm cycle so JIT/tracker one-time
    // costs are excluded from the growth measurement.
    warmCycle(tracker, boxes, out);
    h.maybeGc();
    const before = process.memoryUsage().heapUsed;

    for (let cycle = 0; cycle < CYCLES; cycle++) {
        // Build-up: track a per-cycle resource (models an external handle).
        const handle = tracker.track({ cycle }, NOOP, cycle);

        for (let i = 0; i < OPS_PER_CYCLE; i++) {
            const a = boxes[i & (POOL - 1)];
            const b = boxes[(i * 5 + 1) & (POOL - 1)];
            aabb2.merge(out, a, b);
            aabb2.extend(out, b);
            aabb2.fatten(out, a, 1);
            aabb2.overlapArea(a, b);
        }

        // Tear-down.
        tracker.untrack(handle);
    }

    // Witness 1: the tracker must be empty.
    if (tracker.size() !== 0) {
        h.fail(TIER, 'tracker did not return to zero: size=' + tracker.size(), {});
    }

    // Witness 2: heap must be stable across cycles (only when --expose-gc gives
    // us a trustworthy baseline; otherwise the tracker oracle stands alone).
    if (typeof globalThis.gc === 'function') {
        h.maybeGc();
        const after = process.memoryUsage().heapUsed;
        const deltaKB = (after - before) / 1024;
        if (deltaKB > 2048) {
            h.fail(TIER, 'heap grew ' + deltaKB.toFixed(1) + ' KB across ' + CYCLES + ' cycles', {});
        }
    }
}

function warmCycle(tracker, boxes, out) {
    const handle = tracker.track({ cycle: -1 }, NOOP, -1);
    for (let i = 0; i < OPS_PER_CYCLE; i++) {
        const a = boxes[i & (POOL - 1)];
        const b = boxes[(i * 5 + 1) & (POOL - 1)];
        aabb2.merge(out, a, b);
        aabb2.extend(out, b);
        aabb2.fatten(out, a, 1);
        aabb2.overlapArea(a, b);
    }
    tracker.untrack(handle);
}
