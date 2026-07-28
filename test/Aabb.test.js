/**
 * @zakkster/lite-aabb — unit tests
 *
 * Plain Node. Run with:
 *   node --expose-gc Aabb.test.js
 *
 * The `--expose-gc` flag is only needed for the zero-allocation guarantee
 * test at the bottom; everything else runs fine without it.
 */

import { aabb2 } from '../Aabb.d.ts';

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`\x1b[32m✓\x1b[0m ${name}`);
    } catch (e) {
        failed++;
        failures.push({ name, message: e.message });
        console.error(`\x1b[31m✗\x1b[0m ${name}\n    ${e.message}`);
    }
}

function assert(cond, msg = 'assertion failed') {
    if (!cond) throw new Error(msg);
}

function assertEq(a, b, msg) {
    if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${a}, expected ${b}`);
}

function assertNear(a, b, eps = 1e-5, msg) {
    if (Math.abs(a - b) > eps) {
        throw new Error(`${msg || 'expected near'}: got ${a}, expected ${b} (eps ${eps})`);
    }
}

function assertAABB(box, [minX, minY, maxX, maxY], msg = 'aabb mismatch') {
    assertNear(box[0], minX, 1e-6, `${msg} [minX]`);
    assertNear(box[1], minY, 1e-6, `${msg} [minY]`);
    assertNear(box[2], maxX, 1e-6, `${msg} [maxX]`);
    assertNear(box[3], maxY, 1e-6, `${msg} [maxY]`);
}

// =============================================================================
// CREATION + COPY
// =============================================================================

test('create() with no args -> zero box', () => {
    const a = aabb2.create();
    assert(a instanceof Float32Array, 'must be Float32Array');
    assertEq(a.length, 4, 'length');
    assertAABB(a, [0, 0, 0, 0]);
});

test('create() with explicit values', () => {
    const a = aabb2.create(1, 2, 3, 4);
    assertAABB(a, [1, 2, 3, 4]);
});

test('clone() produces independent copy', () => {
    const a = aabb2.create(1, 2, 3, 4);
    const b = aabb2.clone(a);
    assert(a !== b, 'must be a different reference');
    assertAABB(b, [1, 2, 3, 4]);
    b[0] = 99;
    assertEq(a[0], 1, 'mutating clone must not affect original');
});

test('copy() writes into out, returns out', () => {
    const a = aabb2.create(1, 2, 3, 4);
    const out = aabb2.create();
    const r = aabb2.copy(out, a);
    assert(r === out, 'returns out');
    assertAABB(out, [1, 2, 3, 4]);
});

test('set() writes explicit bounds, returns out', () => {
    const out = aabb2.create();
    const r = aabb2.set(out, 10, 20, 30, 40);
    assert(r === out, 'returns out');
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
    assert(aabb2.intersects(a, b));
});

test('intersects() true for touching edges', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(10, 0, 20, 10);
    assert(aabb2.intersects(a, b), 'touching should count');
});

test('intersects() false for disjoint', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(20, 20, 30, 30);
    assert(!aabb2.intersects(a, b));
});

test('intersects() false for separated on Y only', () => {
    const a = aabb2.create(0, 0, 100, 10);
    const b = aabb2.create(0, 20, 100, 30);
    assert(!aabb2.intersects(a, b));
});

test('intersects() is symmetric', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    assertEq(aabb2.intersects(a, b), aabb2.intersects(b, a));
});

test('contains() true for inner box', () => {
    const a = aabb2.create(0, 0, 100, 100);
    const b = aabb2.create(10, 10, 20, 20);
    assert(aabb2.contains(a, b));
});

test('contains() true for self', () => {
    const a = aabb2.create(0, 0, 10, 10);
    assert(aabb2.contains(a, a));
});

test('contains() false for partial overlap', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(5, 5, 15, 15);
    assert(!aabb2.contains(a, b));
});

test('contains() touching edges count as contained', () => {
    const a = aabb2.create(0, 0, 10, 10);
    const b = aabb2.create(0, 0, 10, 5);
    assert(aabb2.contains(a, b));
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
// ZERO-ALLOCATION GUARANTEE
// =============================================================================

test('hot-loop ops do not allocate (requires --expose-gc)', () => {
    if (typeof globalThis.gc !== 'function') {
        console.log('    \x1b[33m⚠ skipped: run with --expose-gc to enable\x1b[0m');
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

    console.log(`    heap delta over ${N.toLocaleString()} iterations: ${(delta / 1024).toFixed(1)} KB`);
    assert(delta < 256 * 1024, `expected < 256 KB heap growth, got ${(delta / 1024).toFixed(1)} KB`);
});

// =============================================================================
// REPORT
// =============================================================================

console.log('');
console.log('━'.repeat(60));
if (failed === 0) {
    console.log(`\x1b[32m${passed} passed, 0 failed\x1b[0m`);
    process.exit(0);
} else {
    console.log(`\x1b[31m${passed} passed, ${failed} failed\x1b[0m`);
    process.exit(1);
}
