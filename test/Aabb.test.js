/**
 * @zakkster/lite-aabb -- unit tests (node:test)
 *
 * Run with:
 *   node --test test/*.test.js
 *
 * The zero-allocation guarantee test at the bottom needs `--expose-gc`; it
 * skips (does not fail) when the flag is absent. The torture gate
 * (test/torture.mjs) is the authoritative zero-GC proof.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureAllocs } from '@zakkster/lite-gc-profiler';
import { aabb2, VERSION } from '../Aabb.js';

// Near-equality helpers. Float32 round-trips lose precision, so exact === on
// stored coordinates is wrong; compare within an epsilon instead.
function assertNear(a, b, eps = 1e-5, msg) {
    assert.ok(
        Math.abs(a - b) <= eps,
        `${msg || 'expected near'}: got ${a}, expected ${b} (eps ${eps})`
    );
}

function assertAABB(box, [minX, minY, maxX, maxY], msg = 'aabb mismatch') {
    assertNear(box[0], minX, 1e-6, `${msg} [minX]`);
    assertNear(box[1], minY, 1e-6, `${msg} [minY]`);
    assertNear(box[2], maxX, 1e-6, `${msg} [maxX]`);
    assertNear(box[3], maxY, 1e-6, `${msg} [maxY]`);
}

// =============================================================================
// PACKAGE SURFACE
// =============================================================================

test('VERSION is exported and is a 1.x semver', () => {
    assert.equal(typeof VERSION, 'string');
    assert.match(VERSION, /^1\.\d+\.\d+$/);
});

// =============================================================================
// CREATION + COPY
// =============================================================================

test('create() with no args -> zero box', () => {
    const a = aabb2.create();
    assert.ok(a instanceof Float32Array, 'must be Float32Array');
    assert.equal(a.length, 4, 'length');
    assertAABB(a, [0, 0, 0, 0]);
});

test('create() with explicit values', () => {
    const a = aabb2.create(1, 2, 3, 4);
    assertAABB(a, [1, 2, 3, 4]);
});

test('clone() produces independent copy', () => {
    const a = aabb2.create(1, 2, 3, 4);
    const b = aabb2.clone(a);
    assert.ok(a !== b, 'must be a different reference');
    assertAABB(b, [1, 2, 3, 4]);
    b[0] = 99;
    assert.equal(a[0], 1, 'mutating clone must not affect original');
});

test('copy() writes into out, returns out', () => {
    const a = aabb2.create(1, 2, 3, 4);
    const out = aabb2.create();
    const r = aabb2.copy(out, a);
    assert.ok(r === out, 'returns out');
    assertAABB(out, [1, 2, 3, 4]);
});

test('set() writes explicit bounds, returns out', () => {
    const out = aabb2.create();
    const r = aabb2.set(out, 10, 20, 30, 40);
    assert.ok(r === out, 'returns out');
    assertAABB(out, [10, 20, 30, 40]);
});

// =============================================================================
// MERGE + EXTEND
// =============================================================================

test('merge() non-overlapping boxes', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(20, 20, 30, 30);
    const out = aabb2.create();
    aabb2.merge(out, a, b);
    assertAABB(out, [0, 0, 30, 30]);
});

test('merge() overlapping boxes', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    const out = aabb2.create();
    aabb2.merge(out, a, b);
    assertAABB(out, [0, 0, 15, 15]);
});

test('merge() contained box -> outer box', () => {
    const a = aabb2.create(0, 0, 100, 100);
    const b = aabb2.create(10, 10, 20, 20);
    const out = aabb2.create();
    aabb2.merge(out, a, b);
    assertAABB(out, [0, 0, 100, 100]);
});

test('merge() with negative coords', () => {
    const a = aabb2.create(-5, -5, 0, 0);
    const b = aabb2.create(-10, 2, 5, 7);
    const out = aabb2.create();
    aabb2.merge(out, a, b);
    assertAABB(out, [-10, -5, 5, 7]);
});

test('merge() with out === a (aliasing)', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 20, 20);
    aabb2.merge(a, a, b);
    assertAABB(a, [0, 0, 20, 20], 'merge must be safe when out === a');
});

test('extend() enlarges in place', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, -3, 20, 8);
    aabb2.extend(a, b);
    assertAABB(a, [0, -3, 20, 10]);
});

test('extend() with fully contained b does nothing', () => {
    const a = aabb2.create(0, 0, 100, 100);
    const b = aabb2.create(40, 40, 60, 60);
    aabb2.extend(a, b);
    assertAABB(a, [0, 0, 100, 100]);
});

// =============================================================================
// PERIMETER + AREA
// =============================================================================

test('perimeter() of unit box', () => {
    const a = aabb2.create(0, 0, 1, 1);
    assertNear(aabb2.perimeter(a), 4);
});

test('perimeter() of rectangle', () => {
    const a = aabb2.create(0, 0, 10, 5);
    assertNear(aabb2.perimeter(a), 30);
});

test('perimeter() of zero-size box', () => {
    const a = aabb2.create(5, 5, 5, 5);
    assertNear(aabb2.perimeter(a), 0);
});

test('area() of unit box', () => {
    const a = aabb2.create(0, 0, 1, 1);
    assertNear(aabb2.area(a), 1);
});

test('area() of rectangle', () => {
    const a = aabb2.create(0, 0, 10, 5);
    assertNear(aabb2.area(a), 50);
});

test('area() of zero-size box', () => {
    assertNear(aabb2.area(aabb2.create(5, 5, 5, 5)), 0);
});

// =============================================================================
// OVERLAP
// =============================================================================

test('overlapArea() identical boxes', () => {
    const a = aabb2.create(0, 0, 10, 10);
    assertNear(aabb2.overlapArea(a, a), 100);
});

test('overlapArea() partial overlap', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    assertNear(aabb2.overlapArea(a, b), 25);
});

test('overlapArea() disjoint -> 0', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(20, 20, 30, 30);
    assertNear(aabb2.overlapArea(a, b), 0);
});

test('overlapArea() touching edges -> 0 (zero-width overlap)', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(10, 0, 20, 10);
    assertNear(aabb2.overlapArea(a, b), 0);
});

test('overlapArea() containment -> inner area', () => {
    const outer = aabb2.create(0, 0, 100, 100);
    const inner = aabb2.create(10, 10, 30, 30);
    assertNear(aabb2.overlapArea(outer, inner), 400);
});

// =============================================================================
// INTERSECTS + CONTAINS
// =============================================================================

test('intersects() true for overlap', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    assert.ok(aabb2.intersects(a, b));
});

test('intersects() true for touching edges', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(10, 0, 20, 10);
    assert.ok(aabb2.intersects(a, b), 'touching should count');
});

test('intersects() false for disjoint', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(20, 20, 30, 30);
    assert.ok(!aabb2.intersects(a, b));
});

test('intersects() false for separated on Y only', () => {
    const a = aabb2.create(0, 0, 100, 10);
    const b = aabb2.create(0, 20, 100, 30);
    assert.ok(!aabb2.intersects(a, b));
});

test('intersects() is symmetric', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    assert.equal(aabb2.intersects(a, b), aabb2.intersects(b, a));
});

test('contains() true for inner box', () => {
    const a = aabb2.create(0, 0, 100, 100);
    const b = aabb2.create(10, 10, 20, 20);
    assert.ok(aabb2.contains(a, b));
});

test('contains() true for self', () => {
    const a = aabb2.create(0, 0, 10, 10);
    assert.ok(aabb2.contains(a, a));
});

test('contains() false for partial overlap', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    assert.ok(!aabb2.contains(a, b));
});

test('contains() touching edges count as contained', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(0, 0, 10, 5);
    assert.ok(aabb2.contains(a, b));
});

// =============================================================================
// FATTEN
// =============================================================================

test('fatten() with positive margin grows on all sides', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const out = aabb2.create();
    aabb2.fatten(out, a, 2);
    assertAABB(out, [-2, -2, 12, 12]);
});

test('fatten() with zero margin is a copy', () => {
    const a = aabb2.create(1, 2, 3, 4);
    const out = aabb2.create();
    aabb2.fatten(out, a, 0);
    assertAABB(out, [1, 2, 3, 4]);
});

test('fatten() with negative margin shrinks', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const out = aabb2.create();
    aabb2.fatten(out, a, -2);
    assertAABB(out, [2, 2, 8, 8]);
});

test('fatten() with out === a (aliasing)', () => {
    const a = aabb2.create(0, 0, 10, 10);
    aabb2.fatten(a, a, 1);
    assertAABB(a, [-1, -1, 11, 11], 'fatten must be safe when out === a');
});

// =============================================================================
// ALIASING + CONTRACT (A1: A-02, A-06, A-07, A-10)
// =============================================================================

test('aabb2 namespace is frozen (A-06)', () => {
    assert.equal(Object.isFrozen(aabb2), true, 'aabb2 must be frozen');
    // ESM modules are strict, so reassigning a method throws rather than
    // silently no-op'ing.
    assert.throws(() => { aabb2.intersects = () => true; }, TypeError);
    // The original method is intact after the failed reassignment.
    assert.equal(typeof aabb2.intersects, 'function');
});

test('touching-edge convention triad, one pair (A-02)', () => {
    // A single pair where the shared edge is the boundary case for all three
    // predicates: `b` is a zero-width box lying exactly on `a`'s right edge.
    // The three-way split is DELIBERATE (shared law #3):
    //   - intersects: touching counts as overlap  -> true  (inclusive `>=`)
    //   - contains:   touching counts as contained -> true  (inclusive `>=`)
    //   - overlapArea: a zero-width intersection has zero AREA -> 0
    // overlapArea returning 0 while intersects returns true is not a bug; a
    // touching pair genuinely shares zero area. Pinned so a refactor can't
    // quietly flip any one of the three.
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(10, 0, 10, 10); // zero width, on a's right edge
    assert.equal(aabb2.intersects(a, b), true, 'intersects: touching counts');
    assert.equal(aabb2.contains(a, b), true, 'contains: touching counts');
    assert.equal(aabb2.overlapArea(a, b), 0, 'overlapArea: zero-width -> 0');
});

test('f32 integer boundary: 16777217 reads back as 16777216 (A-10)', () => {
    const o = aabb2.create();
    aabb2.set(o, 0, 0, 16777217, 1);
    assert.equal(o[2], 16777216, '2**24 + 1 is not representable in float32');
});

// A-07 regression: `out` may alias any input, including shifted / overlapping
// views of one buffer. Each writer snapshots its inputs before the first write.
test('merge is safe when out is a shifted view of a (A-07)', () => {
    const buf = new Float32Array(8);
    buf.set([-5, -5, 10, 10, 0, 0, 0, 0]);
    const a = buf.subarray(0, 4);
    const out = buf.subarray(1, 5); // overlaps a on slots 1..3
    const b = aabb2.create(-5, -5, 5, 5);
    aabb2.merge(out, a, b);
    assertAABB(out, [-5, -5, 10, 10], 'merge under shifted-view aliasing');
});

test('fatten is safe when out is a shifted view of a (A-07)', () => {
    const buf = new Float32Array(8);
    buf.set([-5, -5, 10, 10, 0, 0, 0, 0]);
    const a = buf.subarray(0, 4);
    const out = buf.subarray(1, 5);
    aabb2.fatten(out, a, 1);
    assertAABB(out, [-6, -6, 11, 11], 'fatten under shifted-view aliasing');
});

test('copy is safe when out is a shifted view of a (A-07)', () => {
    const buf = new Float32Array(8);
    buf.set([-5, -5, 10, 10, 0, 0, 0, 0]);
    const a = buf.subarray(0, 4);
    const out = buf.subarray(1, 5);
    aabb2.copy(out, a);
    assertAABB(out, [-5, -5, 10, 10], 'copy under shifted-view aliasing');
});

test('extend is safe when b is a shifted view of out (A-07)', () => {
    // out and b overlap: extend must use the pre-write snapshot of both.
    const buf = new Float32Array(8);
    buf.set([0, 0, 10, 10, 5, 5, 20, 20], 0);
    const out = buf.subarray(0, 4); // [0,0,10,10]
    const b = buf.subarray(4, 8);   // [5,5,20,20], disjoint here
    aabb2.extend(out, b);
    assertAABB(out, [0, 0, 20, 20], 'extend with a neighbouring packed box');
});

test('hardened writers retain 0 bytes/call (requires --expose-gc)', (t) => {
    if (typeof globalThis.gc !== 'function') {
        t.skip('run with --expose-gc to enable');
        return;
    }
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 20, 20);
    const out = aabb2.create();
    const cases = [
        ['merge', () => aabb2.merge(out, a, b)],
        ['fatten', () => aabb2.fatten(out, a, 1)],
        ['copy', () => aabb2.copy(out, a)],
        ['extend', () => aabb2.extend(out, b)],
    ];
    for (const [name, fn] of cases) {
        const r = measureAllocs(fn, { iterations: 100_000, warmup: 10_000, batches: 8 });
        assert.ok(r.settled, `${name}: measurement did not settle`);
        // < 1 byte/call is the min-over-batches measurement floor; the hardened
        // bodies add only register-resident locals. torture T6 (maxMajor:0) is
        // the companion gate.
        assert.ok(r.bytesPerCall < 1, `${name} retained ${r.bytesPerCall} bytes/call`);
    }
});

// =============================================================================
// DEGENERATE-VALUE LAW (A2: A-03, A-04, A-05; decisions/0002)
// =============================================================================

// The law: NaN propagates (never laundered), and every box is one of three
// states -- VALID, EMPTY (the sentinel), or GARBAGE -- distinguished by the new
// opt-in predicates. The twelve hot ops stay branchless; the sole behaviour
// change is overlapArea, which stops laundering NaN.

test('isValid: valid boxes (incl. zero-size) are valid', () => {
    assert.equal(aabb2.isValid(aabb2.create(0, 0, 10, 10)), true, 'plain box');
    assert.equal(aabb2.isValid(aabb2.create(-5, -5, 5, 5)), true, 'zero-straddling');
    assert.equal(aabb2.isValid(aabb2.create(5, 5, 5, 5)), true, 'zero-size is valid');
    assert.equal(aabb2.isValid(aabb2.create(5, 5, 5, 10)), true, 'single-axis-degenerate is valid');
});

test('isValid: garbage boxes are not valid', () => {
    assert.equal(aabb2.isValid(aabb2.create(NaN, NaN, NaN, NaN)), false, 'NaN (A-03)');
    assert.equal(aabb2.isValid(aabb2.create(0, 0, NaN, 10)), false, 'one NaN slot');
    assert.equal(aabb2.isValid(aabb2.create(5, 5, 0, 0)), false, 'inverted (A-05)');
    assert.equal(aabb2.isValid(aabb2.create(5, 0, 0, 10)), false, 'inverted on one axis');
    assert.equal(aabb2.isValid(aabb2.create(0, 0, Infinity, 10)), false, 'infinity-mixed (A-04)');
});

test('isValid: the empty sentinel is NOT valid (documented)', () => {
    // The sentinel is non-finite by construction; isValid answers "safe to do
    // geometry", and the answer is no. isEmpty is its separate recognizer.
    const empty = aabb2.setEmpty(aabb2.create());
    assert.equal(aabb2.isValid(empty), false, 'sentinel is not valid');
    assert.equal(aabb2.isEmpty(empty), true, 'sentinel is empty');
});

test('isEmpty / setEmpty: the canonical empty box', () => {
    const e = aabb2.create();
    const r = aabb2.setEmpty(e);
    assert.ok(r === e, 'setEmpty returns out');
    assert.equal(e[0], Infinity);
    assert.equal(e[1], Infinity);
    assert.equal(e[2], -Infinity);
    assert.equal(e[3], -Infinity);
    assert.equal(aabb2.isEmpty(e), true, 'isEmpty of the sentinel');
    assert.equal(aabb2.isEmpty(aabb2.create(0, 0, 10, 10)), false, 'isEmpty of a real box');
    assert.equal(aabb2.isEmpty(aabb2.create(5, 5, 0, 0)), false, 'inverted is not empty');
});

test('empty box is the merge/extend identity: merge(out, empty, b) === copy', () => {
    const b = aabb2.create(-3, 7, 4, 9);
    const viaMerge = aabb2.merge(aabb2.create(), aabb2.setEmpty(aabb2.create()), b);
    const viaCopy = aabb2.copy(aabb2.create(), b);
    assert.deepEqual([...viaMerge], [...viaCopy], 'empty is the reducer identity');
    // and extend from an empty seed lands exactly on b
    const acc = aabb2.setEmpty(aabb2.create());
    aabb2.extend(acc, b);
    assert.deepEqual([...acc], [...viaCopy], 'extend from empty seed === b');
});

test('overlapArea propagates NaN instead of laundering to 0 (A-03, changed in A2)', () => {
    const good = aabb2.create(0, 0, 10, 10);
    const nan = aabb2.create(NaN, NaN, NaN, NaN);
    assert.ok(Number.isNaN(aabb2.overlapArea(good, nan)), 'NaN in -> NaN out');
    assert.ok(Number.isNaN(aabb2.overlapArea(good, aabb2.create(5, 5, NaN, 15))), 'one NaN slot poisons');
    // finite non-overlap and finite overlap are unchanged
    assert.equal(aabb2.overlapArea(good, aabb2.create(20, 20, 30, 30)), 0, 'finite disjoint still 0');
    assertNear(aabb2.overlapArea(good, aabb2.create(5, 5, 15, 15)), 25, 1e-5, 'finite overlap unchanged');
});

test('inverted-box policy: area stays positive, isValid is the detector (A-05)', () => {
    // A2 does not change the arithmetic; it ships the detector. Negative margins
    // are permitted; an inverted result is the caller's bug, found via isValid.
    const shrunk = aabb2.fatten(aabb2.create(), aabb2.create(0, 0, 2, 2), -3);
    assertAABB(shrunk, [3, 3, -1, -1], 'fatten(-3) inverts');
    assert.equal(aabb2.area(shrunk), 16, 'inverted area is still +16 (unchanged)');
    assert.equal(aabb2.isValid(shrunk), false, 'isValid detects the inversion');
});

test('new predicates/setEmpty retain 0 bytes/call (requires --expose-gc)', (t) => {
    if (typeof globalThis.gc !== 'function') {
        t.skip('run with --expose-gc to enable');
        return;
    }
    const a = aabb2.create(0, 0, 10, 10);
    const out = aabb2.create();
    const cases = [
        ['isValid', () => aabb2.isValid(a)],
        ['isEmpty', () => aabb2.isEmpty(a)],
        ['setEmpty', () => aabb2.setEmpty(out)],
    ];
    for (const [name, fn] of cases) {
        const r = measureAllocs(fn, { iterations: 100_000, warmup: 10_000, batches: 8 });
        assert.ok(r.settled, `${name}: measurement did not settle`);
        assert.ok(r.bytesPerCall < 1, `${name} retained ${r.bytesPerCall} bytes/call`);
    }
});

// =============================================================================
// PRECISION / MARGIN FLOOR (A-01, A3)
// =============================================================================

test('marginFloor returns the exact f32 ULP of the largest-magnitude coordinate', () => {
    assert.equal(aabb2.marginFloor(aabb2.create(0, 0, 2, 2)), 2 ** -22, 'ulp at 2');
    assert.equal(aabb2.marginFloor(aabb2.create(0, 0, 1000, 1000)), 2 ** -14, 'ulp at 1000');
    assert.equal(aabb2.marginFloor(aabb2.create(1e6, 1e6, 1e6, 1e6)), 0.0625, 'ulp at 1e6');
    const at1e7 = aabb2.set(aabb2.create(), 1e7, 1e7, 1e7 + 1, 1e7 + 1);
    assert.equal(aabb2.marginFloor(at1e7), 1, 'ulp at 1e7 is 1.0 -- the A-01 coordinate');
    const at2p24 = aabb2.set(aabb2.create(), 16777216, 16777216, 16777216, 16777216);
    assert.equal(aabb2.marginFloor(at2p24), 2, 'upper ulp at 2^24 is 2.0 (the max side needs it)');
});

test('the A-01 evaporation boundary: fatten widens iff margin >= marginFloor', () => {
    // The named boundary. For each margin the bvh README recommends, at every
    // scale, `fatten` widens all four sides EXACTLY when the margin reaches the
    // floor -- so marginFloor is the precise detector of the silent no-op.
    const widensAll = (b, m) => {
        const o = aabb2.fatten(aabb2.create(), b, m);
        return o[0] < b[0] && o[1] < b[1] && o[2] > b[2] && o[3] > b[3];
    };
    const scales = [1, 1e3, 1e6, 1e7, 16777216];
    for (const M of [0.1, 0.5, 1, 4]) {
        for (const s of scales) {
            const b = aabb2.set(aabb2.create(), s, s, s + 1, s + 1);
            const floor = aabb2.marginFloor(b);
            assert.equal(
                widensAll(b, M), M >= floor,
                `scale ${s}, margin ${M}: widen=${widensAll(b, M)} but floor=${floor}`
            );
        }
    }
});

test('the clamp idiom fatten(a, max(m, marginFloor(a))) always strictly widens', () => {
    for (const s of [1, 1e3, 1e6, 1e7, 16777216, 3.4e38 / 4]) {
        const b = aabb2.set(aabb2.create(), s, s, s + 1, s + 1);
        const out = aabb2.fatten(aabb2.create(), b, Math.max(0.1, aabb2.marginFloor(b)));
        assert.ok(out[0] < b[0] && out[1] < b[1] && out[2] > b[2] && out[3] > b[3],
            `clamp failed to widen at scale ${s}`);
        assert.equal(aabb2.contains(out, b), true, 'the widened box contains the original');
    }
});

test('marginFloor fails closed on degenerate input', () => {
    assert.equal(aabb2.marginFloor(aabb2.create(0, 0, 0, 0)), 2 ** -149, 'zero box -> smallest subnormal');
    assert.ok(Number.isNaN(aabb2.marginFloor(aabb2.set(aabb2.create(), 0, 0, NaN, 5))), 'NaN coord -> NaN');
    assert.equal(aabb2.marginFloor(aabb2.set(aabb2.create(), 0, 0, Infinity, 5)), Infinity, 'Inf coord -> Infinity');
    assert.ok(Number.isFinite(aabb2.marginFloor(aabb2.create(3.4e38, 0, 3.4e38, 0))), 'f32max stays finite');
});

test('marginFloor retains 0 bytes/call (requires --expose-gc)', (t) => {
    if (typeof globalThis.gc !== 'function') {
        t.skip('run with --expose-gc to enable');
        return;
    }
    const a = aabb2.create(1e7, 1e7, 1e7 + 1, 1e7 + 1);
    const r = measureAllocs(() => aabb2.marginFloor(a), { iterations: 100_000, warmup: 10_000, batches: 8 });
    assert.ok(r.settled, 'measurement did not settle');
    assert.ok(r.bytesPerCall < 1, `marginFloor retained ${r.bytesPerCall} bytes/call`);
});

// =============================================================================
// 2D OP SET (A4: containsPoint, distanceSq, closestPoint; decisions/0004)
// =============================================================================

// Three new pure ops. Each obeys the touching-edge convention (A-02), the
// aliasing rule (A1), and the degenerate law (A2). Nothing pinned changes.

test('containsPoint: inclusive on edges and corners, false outside', () => {
    const a = aabb2.create(0, 0, 10, 10);
    assert.equal(aabb2.containsPoint(a, 5, 5), true, 'interior');
    assert.equal(aabb2.containsPoint(a, 0, 0), true, 'min corner (touching)');
    assert.equal(aabb2.containsPoint(a, 10, 10), true, 'max corner (touching)');
    assert.equal(aabb2.containsPoint(a, 0, 5), true, 'left edge');
    assert.equal(aabb2.containsPoint(a, 10, 5), true, 'right edge');
    assert.equal(aabb2.containsPoint(a, -0.0001, 5), false, 'just outside left');
    assert.equal(aabb2.containsPoint(a, 5, 10.0001), false, 'just outside top');
    assert.equal(aabb2.containsPoint(a, 20, 20), false, 'far outside');
});

test('containsPoint agrees with contains(a, degenerate box at the point)', () => {
    // A point is a zero-size box to the containment predicate. Pin the agreement
    // across interior, edge, corner, and outside cases.
    const a = aabb2.create(-3, 2, 8, 9);
    const pt = aabb2.create();
    for (const [px, py] of [[0, 5], [-3, 2], [8, 9], [-3, 5], [4, 9], [100, 0], [0, -100]]) {
        aabb2.set(pt, px, py, px, py);
        assert.equal(
            aabb2.containsPoint(a, px, py), aabb2.contains(a, pt),
            `disagreement at (${px}, ${py})`
        );
    }
});

test('containsPoint on a degenerate zero-size box: only the point itself', () => {
    const dot = aabb2.create(5, 5, 5, 5);
    assert.equal(aabb2.containsPoint(dot, 5, 5), true, 'the exact point');
    assert.equal(aabb2.containsPoint(dot, 5, 5.0001), false, 'anything else is out');
});

test('containsPoint fails closed on NaN (returns false, never a spurious true)', () => {
    const a = aabb2.create(0, 0, 10, 10);
    assert.equal(aabb2.containsPoint(a, NaN, 5), false, 'NaN point x');
    assert.equal(aabb2.containsPoint(a, 5, NaN), false, 'NaN point y');
    assert.equal(aabb2.containsPoint(aabb2.set(aabb2.create(), 0, 0, NaN, 10), 5, 5), false, 'NaN box coord');
});

test('distanceSq: 0 for overlapping and for edge-touching boxes', () => {
    const a = aabb2.create(0, 0, 10, 10);
    assert.equal(aabb2.distanceSq(a, aabb2.create(5, 5, 15, 15)), 0, 'overlapping');
    assert.equal(aabb2.distanceSq(a, a), 0, 'identical');
    assert.equal(aabb2.distanceSq(a, aabb2.create(10, 0, 20, 10)), 0, 'touching on the right edge');
    assert.equal(aabb2.distanceSq(a, aabb2.create(10, 10, 20, 20)), 0, 'touching at a corner');
    assert.equal(aabb2.distanceSq(a, aabb2.create(3, -5, 7, 0)), 0, 'touching on the bottom edge');
});

test('distanceSq: exact squared gap for a disjoint pair, on each axis and diagonally', () => {
    const a = aabb2.create(0, 0, 10, 10);
    // gap of 5 on x only -> 25
    assert.equal(aabb2.distanceSq(a, aabb2.create(15, 2, 20, 8)), 25, 'x gap 5');
    // gap of 3 on y only -> 9
    assert.equal(aabb2.distanceSq(a, aabb2.create(2, 13, 8, 20)), 9, 'y gap 3');
    // corner-to-corner: dx=3 (13-10), dy=4 (14-10) -> 9 + 16 = 25
    assert.equal(aabb2.distanceSq(a, aabb2.create(13, 14, 20, 20)), 25, 'diagonal 3-4-5');
});

test('distanceSq is symmetric', () => {
    const pairs = [
        [aabb2.create(0, 0, 10, 10), aabb2.create(13, 14, 20, 20)],
        [aabb2.create(-5, -5, -1, -1), aabb2.create(4, 6, 9, 9)],
        [aabb2.create(0, 0, 1, 1), aabb2.create(0, 0, 1, 1)],
    ];
    for (const [a, b] of pairs) {
        assert.equal(aabb2.distanceSq(a, b), aabb2.distanceSq(b, a), 'not symmetric');
    }
});

test('distanceSq propagates NaN (A2), never launders to 0', () => {
    const a = aabb2.create(0, 0, 10, 10);
    assert.ok(Number.isNaN(aabb2.distanceSq(a, aabb2.create(NaN, NaN, NaN, NaN))), 'NaN box -> NaN');
    assert.ok(Number.isNaN(aabb2.distanceSq(a, aabb2.set(aabb2.create(), 20, 20, NaN, 30))), 'one NaN slot -> NaN');
});

test('closestPoint: interior point maps to itself (bit-exact), out2 is length 2', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const out2 = new Float32Array(2);
    const r = aabb2.closestPoint(out2, a, 4, 7);
    assert.ok(r === out2, 'returns out2');
    assert.equal(out2.length, 2, 'out2 is a length-2 Vec2');
    assert.equal(out2[0], 4, 'x is the point itself');
    assert.equal(out2[1], 7, 'y is the point itself');
});

test('closestPoint: outside point clamps to the nearest edge or corner', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const out2 = new Float32Array(2);
    aabb2.closestPoint(out2, a, 20, 5);
    assert.deepEqual([...out2], [10, 5], 'right of the box -> right edge');
    aabb2.closestPoint(out2, a, -4, 20);
    assert.deepEqual([...out2], [0, 10], 'above-left -> top-left corner');
    aabb2.closestPoint(out2, a, 3, -8);
    assert.deepEqual([...out2], [3, 0], 'below -> bottom edge');
});

test('closestPoint is idempotent: closest of a closest point is itself', () => {
    const a = aabb2.create(-2, 3, 8, 12);
    const p = new Float32Array(2);
    const q = new Float32Array(2);
    for (const [px, py] of [[4, 7], [100, 100], [-50, 8], [4, -9], [8, 12]]) {
        aabb2.closestPoint(p, a, px, py);
        aabb2.closestPoint(q, a, p[0], p[1]);
        assert.deepEqual([...q], [...p], `not idempotent at (${px}, ${py})`);
    }
});

test('closestPoint propagates NaN in the box coordinate (A2)', () => {
    const out2 = new Float32Array(2);
    // A NaN x-bound poisons the x clamp (min(max(px, NaN), NaN) is NaN); y is clean.
    aabb2.closestPoint(out2, aabb2.set(aabb2.create(), NaN, 0, NaN, 10), 5, 5);
    assert.ok(Number.isNaN(out2[0]), 'NaN x-bound -> NaN x');
    assert.equal(out2[1], 5, 'clean y is unaffected');
});

test('closestPoint is safe when out2 is a shifted view of a (A-07 aliasing)', () => {
    // Pack a's bounds and out2 into one buffer so out2 overlaps a's storage:
    // buf = [a0, a1, a2, a3, _, _]; a = buf[0..4], out2 = buf[2..4] (overlaps a2,a3).
    const buf = new Float32Array(6);
    const a = buf.subarray(0, 4);
    aabb2.set(a, 0, 0, 10, 10);
    const out2 = buf.subarray(2, 4); // aliases a[2], a[3]
    aabb2.closestPoint(out2, a, 20, -5);
    // Correct answer: clamp (20,-5) into [0,0,10,10] -> (10, 0). Snapshotting a's
    // bounds before writing is what makes this correct despite the overlap.
    assert.deepEqual([...out2], [10, 0], 'shifted-view out2 got the right answer');
});

test('new 2D ops retain 0 bytes/call (requires --expose-gc)', (t) => {
    if (typeof globalThis.gc !== 'function') {
        t.skip('run with --expose-gc to enable');
        return;
    }
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(13, 14, 20, 20);
    const out2 = new Float32Array(2);
    const cases = [
        ['containsPoint', () => aabb2.containsPoint(a, 5, 5)],
        ['distanceSq', () => aabb2.distanceSq(a, b)],
        ['closestPoint', () => aabb2.closestPoint(out2, a, 20, -5)],
    ];
    for (const [name, fn] of cases) {
        const r = measureAllocs(fn, { iterations: 100_000, warmup: 10_000, batches: 8 });
        assert.ok(r.settled, `${name}: measurement did not settle`);
        assert.ok(r.bytesPerCall < 1, `${name} retained ${r.bytesPerCall} bytes/call`);
    }
});

// =============================================================================
// ZERO-ALLOCATION GUARANTEE (coarse; torture.mjs is authoritative)
// =============================================================================

test('hot-loop ops do not allocate (requires --expose-gc)', (t) => {
    if (typeof globalThis.gc !== 'function') {
        t.skip('run with --expose-gc to enable');
        return;
    }

    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    const out = aabb2.create();

    // Warmup so V8 inlines the call sites.
    for (let i = 0; i < 5000; i++) {
        aabb2.merge(out, a, b);
        aabb2.extend(out, b);
        aabb2.fatten(out, a, 1);
        aabb2.intersects(a, b);
        aabb2.overlapArea(a, b);
    }

    globalThis.gc();
    const before = process.memoryUsage().heapUsed;

    const N = 500_000;
    for (let i = 0; i < N; i++) {
        aabb2.merge(out, a, b);
        aabb2.extend(out, b);
        aabb2.fatten(out, a, 1);
        aabb2.intersects(a, b);
        aabb2.overlapArea(a, b);
        aabb2.perimeter(out);
        aabb2.area(out);
    }

    globalThis.gc();
    const after = process.memoryUsage().heapUsed;
    const delta = after - before;

    assert.ok(
        delta < 256 * 1024,
        `expected < 256 KB heap growth, got ${(delta / 1024).toFixed(1)} KB`
    );
});
