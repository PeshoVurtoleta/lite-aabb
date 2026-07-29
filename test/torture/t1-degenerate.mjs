/**
 * Tier T1 -- degenerate values, answers PINNED.
 *
 * "Pinning 'this returns NaN' is a valid contract; leaving it unpinned is not."
 *
 * Two layers:
 *
 *   1. LOAD-BEARING NAMED PINS (findings). Human-eyeballed expected values for
 *      the exact cases A-01/A-03/A-04/A-05 call out, each tagged with its
 *      finding. When a session changes a behaviour, the matching pin flips
 *      deliberately and visibly -- that is the point. A2 flips one: overlapArea
 *      no longer launders NaN into 0 (A-03), and adds the isValid / isEmpty /
 *      setEmpty pins for the degenerate-value law (decisions/0002).
 *
 *   2. COMPLETE CROSS-PRODUCT (A2 makes T1 "complete"). Every op is crossed with
 *      every degenerate value in section 3 of the roadmap and asserted against
 *      an INDEPENDENT float64 oracle. The oracle re-derives the answer from a
 *      pre-read snapshot of the f32 slots, so it is frozen test code: if any op
 *      body changes a degenerate answer, the oracle stays put and the gate
 *      trips. This layer is a regression net (internal-consistency pin), not a
 *      correctness proof -- correctness of the ugly answers is what layer 1
 *      documents by hand, and what T0/T2/fuzz check differentially.
 */

import { aabb2 } from '../../Aabb.js';
import { assertEq, assertOk, fail } from './harness.mjs';

const TIER = 'T1';

export function run() {
    const o = new Float32Array(4);

    // =====================================================================
    // Layer 1 -- load-bearing named pins (findings)
    // =====================================================================

    // --- zero-size and inverted (A-05) ---------------------------------------
    assertEq(TIER, aabb2.area(aabb2.set(o, 5, 5, 5, 5)), 0, 'area(zero-size)');
    assertEq(TIER, aabb2.perimeter(aabb2.set(o, 5, 5, 5, 5)), 0, 'perimeter(zero-size)');

    // Inverted box has a POSITIVE area and does not intersect itself. Unchanged
    // in A2 -- the hot ops stay branchless; isValid is the detector (below).
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

    // --- NaN policy: now CONSISTENT propagation (A-03, changed in A2) ---------
    const good = aabb2.set(new Float32Array(4), 0, 0, 10, 10);
    const nan = aabb2.set(new Float32Array(4), NaN, NaN, NaN, NaN);

    // merge propagates NaN into out (unchanged) ...
    aabb2.merge(o, good, nan);
    assertOk(TIER, Number.isNaN(o[0]) && Number.isNaN(o[1]) && Number.isNaN(o[2]) && Number.isNaN(o[3]),
        'merge poisons out with NaN (A-03)');

    // ... and overlapArea now propagates it too, instead of laundering to 0.
    // THIS IS THE A2 FLIP: on 1.0.x this pin expected 0.
    assertOk(TIER, Number.isNaN(aabb2.overlapArea(good, nan)),
        'overlapArea(NaN) propagates NaN, no laundering (A-03 fixed in A2)');
    // A genuine (finite) non-overlap still returns a clean 0.
    assertEq(TIER, aabb2.overlapArea(good, aabb2.set(new Float32Array(4), 20, 20, 30, 30)), 0,
        'overlapArea(finite disjoint) is still 0');
    assertOk(TIER, Number.isNaN(aabb2.area(nan)), 'area(NaN) is NaN (A-03)');
    assertOk(TIER, aabb2.intersects(good, nan) === false, 'intersects(NaN) false (A-03)');
    assertOk(TIER, aabb2.contains(good, nan) === false, 'contains(NaN) false (A-03)');

    // --- empty sentinel + infinities (A-04) ----------------------------------
    // area/perimeter of the sentinel are UNCHANGED (still the ugly infinities):
    // A2 fixes A-04 at the API/doc level, not by branching a hot op. The
    // sentinel is now a recognized value (isEmpty) you build with setEmpty and
    // guard with isValid, so it never reaches perimeter as an SAH cost.
    const sentinel = aabb2.set(new Float32Array(4), Infinity, Infinity, -Infinity, -Infinity);
    assertEq(TIER, aabb2.perimeter(sentinel), -Infinity, 'perimeter(empty sentinel) is -Infinity (A-04)');
    assertEq(TIER, aabb2.area(sentinel), Infinity, 'area(empty sentinel) is +Infinity (A-04)');

    const allPos = aabb2.set(new Float32Array(4), Infinity, Infinity, Infinity, Infinity);
    assertOk(TIER, Number.isNaN(aabb2.area(allPos)), 'area(all +Inf) is NaN (A-04)');

    // The sentinel is already a merge identity (Inf/-Inf collapse to the operand).
    aabb2.merge(o, sentinel, good);
    assertOk(TIER, o[0] === 0 && o[1] === 0 && o[2] === 10 && o[3] === 10,
        'merge(sentinel, b) === b');

    // --- degenerate-value law: predicates (A2, new surface) ------------------
    assertOk(TIER, aabb2.isValid(good) === true, 'isValid(valid box) true');
    assertOk(TIER, aabb2.isValid(aabb2.set(new Float32Array(4), 5, 5, 5, 5)) === true,
        'isValid(zero-size) true');
    assertOk(TIER, aabb2.isValid(inv) === false, 'isValid(inverted) false -- the A-05 detector');
    assertOk(TIER, aabb2.isValid(nan) === false, 'isValid(NaN) false');
    assertOk(TIER, aabb2.isValid(aabb2.set(new Float32Array(4), 0, 0, Infinity, 10)) === false,
        'isValid(infinity-mixed) false');
    assertOk(TIER, aabb2.isValid(sentinel) === false,
        'isValid(empty sentinel) false -- non-finite by construction (A-04, documented)');
    assertOk(TIER, aabb2.isEmpty(sentinel) === true, 'isEmpty(sentinel) true');
    assertOk(TIER, aabb2.isEmpty(good) === false, 'isEmpty(non-empty box) false');
    assertOk(TIER, aabb2.isEmpty(inv) === false, 'isEmpty(inverted, non-sentinel) false');

    // setEmpty builds exactly the merge identity.
    const es = aabb2.setEmpty(new Float32Array(4));
    assertOk(TIER, es[0] === Infinity && es[1] === Infinity && es[2] === -Infinity && es[3] === -Infinity,
        'setEmpty writes the canonical sentinel');
    aabb2.merge(o, es, good);
    assertOk(TIER, o[0] === 0 && o[1] === 0 && o[2] === 10 && o[3] === 10,
        'merge(setEmpty(out), b) === b -- empty is the reducer identity');

    // --- f32 integer boundary (A-10) -----------------------------------------
    aabb2.set(o, 0, 0, 16777217, 1);
    assertEq(TIER, o[2], 16777216, 'f32 integer boundary: 16777217 reads back as 16777216 (A-10)');

    // --- margin evaporation (A-01) -------------------------------------------
    // fatten's arithmetic is UNCHANGED: below the f32 ULP the margin still
    // rounds away (at 1e7 the ULP is 1.0, so 0.5 vanishes). What A3 adds is that
    // marginFloor DETECTS the doomed margin and the clamp fixes it.
    const big = aabb2.set(new Float32Array(4), 1e7, 1e7, 1e7 + 1, 1e7 + 1);
    aabb2.fatten(o, big, 0.5);
    assertEq(TIER, o[0], 1e7, 'fatten margin still evaporates on min-x at 1e7 (A-01, unchanged)');
    assertEq(TIER, o[1], 1e7, 'fatten margin still evaporates on min-y at 1e7 (A-01, unchanged)');
    // The detector (A3): marginFloor reports the true step, and 0.5 is below it.
    assertEq(TIER, aabb2.marginFloor(big), 1, 'marginFloor detects the 1e7 ULP (A-01)');
    assertOk(TIER, 0.5 < aabb2.marginFloor(big), 'marginFloor flags the doomed 0.5 margin (A-01)');
    // The clamp idiom widens where the raw margin could not.
    aabb2.fatten(o, big, Math.max(0.5, aabb2.marginFloor(big)));
    assertOk(TIER, o[0] < big[0] && o[1] < big[1] && o[2] > big[2] && o[3] > big[3],
        'clamp(max(0.5,marginFloor)) widens all sides at 1e7 (A-01 fixed at the door)');
    // At 2^24 the max side needs the UPPER ulp (2.0); marginFloor returns it.
    const huge = aabb2.set(new Float32Array(4), 16777216, 16777216, 16777216, 16777216);
    assertEq(TIER, aabb2.marginFloor(huge), 2, 'marginFloor returns the upper ULP (2) at 2^24 (A-01)');

    // =====================================================================
    // Layer 2 -- complete cross-product (every op x every degenerate value)
    // =====================================================================

    let checks = 0;
    const F = Math.fround;
    const box = (x0, y0, x1, y1) => aabb2.set(new Float32Array(4), x0, y0, x1, y1);
    const snap = (b) => [b[0], b[1], b[2], b[3]];

    // NaN-aware numeric pin.
    function eqNum(label, got, exp) {
        checks++;
        if (exp !== exp) { if (got === got) fail(TIER, label + ': got ' + got + ' expected NaN', {}); return; }
        if (got !== exp) fail(TIER, label + ': got ' + got + ' expected ' + exp, {});
    }
    function eqBool(label, got, exp) {
        checks++;
        if (got !== exp) fail(TIER, label + ': got ' + got + ' expected ' + exp, {});
    }
    // NaN-aware per-slot box pin. `exp` is a plain array of f32-rounded values.
    function eqBox(label, got, exp) {
        checks++;
        for (let i = 0; i < 4; i++) {
            const g = got[i], e = exp[i];
            if (e !== e) { if (g === g) fail(TIER, label + '[' + i + ']: got ' + g + ' expected NaN', {}); }
            else if (g !== e) fail(TIER, label + '[' + i + ']: got ' + g + ' expected ' + e, {});
        }
    }

    // Independent float64 oracles over a snapshot (never call aabb2).
    const oArea = (a) => (a[2] - a[0]) * (a[3] - a[1]);
    const oPerim = (a) => 2 * ((a[2] - a[0]) + (a[3] - a[1]));
    const oValid = (a) => Number.isFinite(a[0]) && Number.isFinite(a[1]) &&
        Number.isFinite(a[2]) && Number.isFinite(a[3]) && a[0] <= a[2] && a[1] <= a[3];
    const oEmpty = (a) => a[0] === Infinity && a[1] === Infinity && a[2] === -Infinity && a[3] === -Infinity;
    const oIntersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    const oContains = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
    const oOverlap = (a, b) => {
        const mnX = Math.max(a[0], b[0]), mnY = Math.max(a[1], b[1]);
        const mxX = Math.min(a[2], b[2]), mxY = Math.min(a[3], b[3]);
        const wx = mxX - mnX, wy = mxY - mnY;
        if (wx > 0 && wy > 0) return wx * wy;
        return (wx !== wx || wy !== wy) ? NaN : 0;
    };
    // marginFloor oracle: upper f32 ULP of the largest-magnitude coordinate,
    // re-derived independently via DataView bit manipulation (a different code
    // path than the module's Int32Array-aliased scratch).
    const oDV = new DataView(new ArrayBuffer(4));
    const oFloor = (a) => {
        const m = Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3]));
        if (m !== m) return NaN;
        if (m === Infinity) return Infinity;
        oDV.setFloat32(0, m);
        oDV.setInt32(0, oDV.getInt32(0) + 1);
        return oDV.getFloat32(0) - m;
    };

    // The section-3 degenerate corpus: zeros/signed-zero, both infinities, the
    // empty sentinel, NaN (all four and one slot), subnormals, f32 max, the
    // integer boundary, one-ulp-apart, zero-size, single-axis-degenerate,
    // inverted (both axes and one axis), and a zero-straddling box.
    const REF = box(0, 0, 10, 10);          // a plain valid box, the binary partner
    const G = snap(REF);
    const CASES = [
        ['zero', box(0, 0, 0, 0)],
        ['negZero', box(-0, -0, -0, -0)],
        ['good', box(0, 0, 10, 10)],
        ['straddle', box(-5, -5, 5, 5)],
        ['zeroSize', box(5, 5, 5, 5)],
        ['degenX', box(5, 5, 5, 10)],          // zero width
        ['degenY', box(5, 5, 10, 5)],          // zero height
        ['inverted', box(5, 5, 0, 0)],           // inverted on both axes
        ['invX', box(5, 0, 0, 10)],           // inverted on x only
        ['subnormal', box(0, 0, 1e-45, 1e-45)],     // f32 subnormal
        ['f32max', box(0, 0, 3.4e38, 3.4e38)],
        ['intBoundary', box(0, 0, 16777217, 1)],       // stores 16777216
        ['oneUlp', box(1, 1, 1 + 2 ** -23, 1 + 2 ** -22)],
        ['posInf', box(Infinity, Infinity, Infinity, Infinity)],
        ['negInf', box(-Infinity, -Infinity, -Infinity, -Infinity)],
        ['sentinel', box(Infinity, Infinity, -Infinity, -Infinity)],
        ['nan4', box(NaN, NaN, NaN, NaN)],
        ['nanLo', box(NaN, 0, 10, 10)],
        ['nanHi', box(0, 0, NaN, 10)],
    ];

    const acc = new Float32Array(4);
    for (let i = 0; i < CASES.length; i++) {
        const name = CASES[i][0];
        const bx = CASES[i][1];
        const a = snap(bx);

        // unary numeric / predicate ops
        eqNum('area(' + name + ')', aabb2.area(bx), oArea(a));
        eqNum('perimeter(' + name + ')', aabb2.perimeter(bx), oPerim(a));
        eqBool('isValid(' + name + ')', aabb2.isValid(bx), oValid(a));
        eqBool('isEmpty(' + name + ')', aabb2.isEmpty(bx), oEmpty(a));
        eqNum('marginFloor(' + name + ')', aabb2.marginFloor(bx), oFloor(a));

        // writers over a degenerate input (distinct out; aliasing is T2's job)
        eqBox('copy(' + name + ')', aabb2.copy(acc, bx), [F(a[0]), F(a[1]), F(a[2]), F(a[3])]);
        eqBox('fatten(' + name + ',+1)', aabb2.fatten(acc, bx, 1),
            [F(a[0] - 1), F(a[1] - 1), F(a[2] + 1), F(a[3] + 1)]);
        eqBox('fatten(' + name + ',-1)', aabb2.fatten(acc, bx, -1),
            [F(a[0] + 1), F(a[1] + 1), F(a[2] - 1), F(a[3] - 1)]);
        eqBox('merge(good,' + name + ')', aabb2.merge(acc, REF, bx),
            [F(Math.min(G[0], a[0])), F(Math.min(G[1], a[1])), F(Math.max(G[2], a[2])), F(Math.max(G[3], a[3]))]);
        aabb2.copy(acc, REF);
        const be = snap(acc);
        eqBox('extend(good,' + name + ')', aabb2.extend(acc, bx),
            [F(Math.min(be[0], a[0])), F(Math.min(be[1], a[1])), F(Math.max(be[2], a[2])), F(Math.max(be[3], a[3]))]);

        // binary predicates: against a valid partner and against self
        eqBool('intersects(good,' + name + ')', aabb2.intersects(REF, bx), oIntersects(G, a));
        eqBool('intersects(' + name + ',self)', aabb2.intersects(bx, bx), oIntersects(a, a));
        eqBool('contains(good,' + name + ')', aabb2.contains(REF, bx), oContains(G, a));
        eqBool('contains(' + name + ',good)', aabb2.contains(bx, REF), oContains(a, G));
        eqNum('overlapArea(good,' + name + ')', aabb2.overlapArea(REF, bx), oOverlap(G, a));
        eqNum('overlapArea(' + name + ',self)', aabb2.overlapArea(bx, bx), oOverlap(a, a));
    }

    // Coverage floor: 19 cases x 16 crossed ops. Locks the matrix so a later
    // edit that drops a row or a case trips the gate instead of silently
    // shrinking coverage.
    if (checks < 19 * 16) fail(TIER, 'cross-product under-covered: only ' + checks + ' checks ran', {});
}
