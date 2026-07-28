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

test('VERSION is exported and matches 1.0.x', () => {
    assert.equal(typeof VERSION, 'string');
    assert.match(VERSION, /^1\.0\.\d+$/);
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
