/**
 * Tier T9 -- controls. "A pass means something only if the gate can fail."
 *
 * Shared law #7: every gate ships with a deliberately-broken variant that must
 * exit non-zero. This tier proves it TWO ways:
 *
 *   1. Deterministic self-check (runs every time). For each gate family we run a
 *      broken variant IN PROCESS and assert the gate machinery detects it. If a
 *      control is NOT detected, this tier throws and torture exits non-zero.
 *      These controls have zero GC dependence, so the normal "ok" path stays
 *      fully deterministic.
 *
 *   2. The GC gate (T6) is falsifiable via TORTURE_CONTROL=alloc, which injects
 *      a real allocation into the measured hot loop:
 *
 *          TORTURE_CONTROL=alloc node --expose-gc test/torture.mjs   -> exit 1
 *
 *      That path is human/CI-invoked rather than run here, so a nondeterministic
 *      GC observation can never flake the green path.
 */

import { aabb2 } from '../../Aabb.js';
import { createLeakTracker } from '@zakkster/lite-leak';

const TIER = 'T9';

/** Assert `fn` throws; if it returns normally the control is decorative. */
function expectThrows(h, fn, label) {
    let threw = false;
    try {
        fn();
    } catch (_e) {
        threw = true;
    }
    if (!threw) h.fail(TIER, 'control did not fire: ' + label, {});
}

export function run(h) {
    // Control A -- the box-equality assertion must reject a genuine mismatch.
    expectThrows(h, () => {
        const x = aabb2.set(new Float32Array(4), 0, 0, 1, 1);
        const y = aabb2.set(new Float32Array(4), 0, 0, 2, 2);
        h.assertBoxEq('control', x, y, 0, 0);
    }, 'assertBoxEq accepts unequal boxes');

    // Control B -- a wrong scalar pin must be rejected (T1's detection path).
    expectThrows(h, () => {
        h.assertEq('control', aabb2.area(aabb2.set(new Float32Array(4), 0, 0, 2, 2)), 999, 'bogus area');
    }, 'assertEq accepts a wrong pin');

    // Control C -- a broken metamorphic law must be caught: contains(small, big)
    // is false, so asserting it true must throw.
    expectThrows(h, () => {
        const small = aabb2.set(new Float32Array(4), 0, 0, 1, 1);
        const big = aabb2.set(new Float32Array(4), -5, -5, 5, 5);
        h.assertOk('control', aabb2.contains(small, big), 'small contains big (false)');
    }, 'assertOk accepts a false law');

    // Control E -- the A2 degenerate-law predicate gate must be falsifiable: a
    // claim that a NaN box isValid (it is not) must be rejected. Proves T1's new
    // isValid/isEmpty pins can actually fail.
    expectThrows(h, () => {
        const nan = aabb2.set(new Float32Array(4), NaN, NaN, NaN, NaN);
        h.assertOk('control', aabb2.isValid(nan), 'isValid(NaN) is true (false)');
    }, 'assertOk accepts isValid(NaN)===true');

    // Control D -- the T7 conservation oracle must notice a leaked resource.
    expectThrows(h, () => {
        const tracker = createLeakTracker({ name: 'control-leak' });
        tracker.track({}, function () {}, 0); // tracked, never untracked.
        if (tracker.size() !== 0) throw new Error('leak detected (expected)');
    }, 'tracker.size() blind to a leak');

    // Control F -- the A3 precision-floor gate must be falsifiable. If
    // marginFloor under-reported (returned 0), clamping with it would NOT widen
    // the box at 1e7, so the T0/T1 "widens all sides" assertion must fire.
    expectThrows(h, () => {
        const brokenFloor = 0; // a marginFloor that fails to detect the ULP
        const big = aabb2.set(new Float32Array(4), 1e7, 1e7, 1e7 + 1, 1e7 + 1);
        const out = aabb2.fatten(new Float32Array(4), big, Math.max(0.5, brokenFloor));
        h.assertOk('control', out[0] < big[0], 'clamp with a 0 floor widened min-x (it did not)');
    }, 'assertOk accepts a marginFloor that fails to widen');

    // Control G -- the A4 closestPoint idempotence law must be falsifiable. A
    // broken "closest point" that halves the clamped x has no non-zero fixed
    // point (10 -> 5 -> 2.5 -> ...), so it is NOT idempotent and the T0
    // idempotence assertion must fire.
    expectThrows(h, () => {
        const a = aabb2.set(new Float32Array(4), 0, 0, 10, 10);
        const brokenClosest = (out2, box, px, py) => {
            out2[0] = Math.min(Math.max(px, box[0]), box[2]) * 0.5; // shrinks each pass
            out2[1] = Math.min(Math.max(py, box[1]), box[3]);
            return out2;
        };
        const p1 = brokenClosest(new Float32Array(2), a, 20, 5); // clamp 20->10, *0.5 = 5
        const p2 = brokenClosest(new Float32Array(2), a, p1[0], p1[1]); // clamp 5, *0.5 = 2.5
        h.assertOk('control', p2[0] === p1[0] && p2[1] === p1[1],
            'broken closestPoint reported as idempotent (it is not)');
    }, 'assertOk accepts a non-idempotent closestPoint');

    // Control H -- the X1 batch fold-equality law must be falsifiable. A broken
    // mergeAll that drops the LAST box (folds only count-1 boxes) yields a union
    // that misses part of the input, so the T0 "mergeAll === merge fold"
    // assertion must fire.
    expectThrows(h, () => {
        const packed = new Float32Array(8);
        aabb2.set(packed.subarray(0, 4), 0, 0, 4, 4);
        aabb2.set(packed.subarray(4, 8), 10, 10, 20, 20);
        const brokenMergeAll = (out4, inPacked, count) => {
            let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
            for (let i = 0; i < count - 1; i++) { // BUG: drops the last box
                const j = i << 2;
                mnX = Math.min(mnX, inPacked[j]); mnY = Math.min(mnY, inPacked[j + 1]);
                mxX = Math.max(mxX, inPacked[j + 2]); mxY = Math.max(mxY, inPacked[j + 3]);
            }
            out4[0] = mnX; out4[1] = mnY; out4[2] = mxX; out4[3] = mxY;
            return out4;
        };
        // True union is [0,0,20,20]; the broken op returns [0,0,4,4].
        const got = brokenMergeAll(new Float32Array(4), packed, 2);
        const ref = aabb2.setEmpty(new Float32Array(4));
        aabb2.merge(ref, ref, aabb2.set(new Float32Array(4), 0, 0, 4, 4));
        aabb2.merge(ref, ref, aabb2.set(new Float32Array(4), 10, 10, 20, 20));
        h.assertOk('control', got[0] === ref[0] && got[1] === ref[1] && got[2] === ref[2] && got[3] === ref[3],
            'broken mergeAll reported as equal to the merge fold (it drops a box)');
    }, 'assertOk accepts a mergeAll that drops a box');
}
