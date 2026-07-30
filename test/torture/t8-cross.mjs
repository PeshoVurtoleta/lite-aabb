/**
 * Tier T8 -- cross-package conformance.
 *
 * The full round-trip (build boxes with aabb2, feed the packed buffer to
 * @zakkster/lite-bvh's insertLeaves, query, assert the hit set) lands in X1-B,
 * which adds the bvh bulk entry point. This session (X1-A) fills the aabb SIDE
 * of the FORMAT contract (decisions/0005): the length-4 layout constants and the
 * FORMAT_VERSION that both packages must agree on for equality. The A-01
 * detector and the A-03/B-03 poison chain remain owned by the bvh sessions.
 */

import { aabb2, FORMAT_VERSION } from '../../Aabb.js';

const TIER = 'T8';

export function run(h) {
    // FORMAT_VERSION is the shared contract id: an integer both packages export
    // and compare for equality. lite-bvh (X1-B) exports the identical value.
    if (typeof FORMAT_VERSION !== 'number' || !Number.isInteger(FORMAT_VERSION)) {
        h.fail(TIER, 'FORMAT_VERSION must be an integer, got ' + FORMAT_VERSION, {});
    }
    if (FORMAT_VERSION !== 1) {
        h.fail(TIER, 'FORMAT_VERSION drifted from the contract value 1: ' + FORMAT_VERSION, {});
    }

    // Layout conformance: the four index constants both packages rely on. A box
    // is a length-4 Float32Array [minX, minY, maxX, maxY]; set() must place each
    // coordinate at its contracted slot.
    const b = aabb2.set(new Float32Array(4), 11, 22, 33, 44);
    if (b.length !== 4) h.fail(TIER, 'box length is not 4: ' + b.length, {});
    if (b[0] !== 11) h.fail(TIER, 'slot 0 is not minX', {});
    if (b[1] !== 22) h.fail(TIER, 'slot 1 is not minY', {});
    if (b[2] !== 33) h.fail(TIER, 'slot 2 is not maxX', {});
    if (b[3] !== 44) h.fail(TIER, 'slot 3 is not maxY', {});

    // Packed stride conformance: box i occupies slots 4i..4i+3. mergeAll reading
    // the packed buffer must see exactly those windows -- a union of two boxes at
    // stride 4 recovers the enclosing box.
    const packed = new Float32Array(8);
    aabb2.set(packed.subarray(0, 4), 0, 0, 5, 5);
    aabb2.set(packed.subarray(4, 8), 10, 10, 20, 20);
    const u = aabb2.mergeAll(new Float32Array(4), packed, 2);
    if (!(u[0] === 0 && u[1] === 0 && u[2] === 20 && u[3] === 20)) {
        h.fail(TIER, 'packed stride-4 union is wrong: [' + u[0] + ',' + u[1] + ',' + u[2] + ',' + u[3] + ']', {});
    }
}
