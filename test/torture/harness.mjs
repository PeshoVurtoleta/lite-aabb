/**
 * @zakkster/lite-aabb -- torture harness.
 *
 * Shared machinery for the tiers: a seeded PRNG, a pre-allocated box corpus,
 * zero-allocation assertion helpers, and a manual lite-gc-profiler gate that
 * mirrors @zakkster/lite-arena's proven measurement shape (start -> await
 * settle -> read summary -> stop, one measurement at a time).
 *
 * HARNESS LAWS (section 3 of the roadmap):
 *   - All scratch is allocated ONCE, outside every loop. Tiers reuse it.
 *   - Assertions in hot loops compare into pre-allocated scratch and only build
 *     a message string ON FAILURE. A template literal per iteration is an
 *     allocation and would fail our own gate.
 *   - Seeded xorshift32. On any failure we print the seed and the op index so a
 *     case replays with one env var: TORTURE_SEED=... node --expose-gc ...
 *   - One measurement at a time. Tiers run sequentially, never nested.
 *
 * Peers are devDependencies, never runtime deps: Aabb.js has zero deps.
 *
 * @license MIT
 */

import { GcProfiler, checkNoGc } from '@zakkster/lite-gc-profiler';

// --- configuration -----------------------------------------------------------

export const SEED = (process.env.TORTURE_SEED
    ? (parseInt(process.env.TORTURE_SEED, 10) >>> 0)
    : 0x9e3779b9) >>> 0;

// Deliberately-broken control selector. See t9-controls.mjs and the file header
// of torture.mjs. TORTURE_CONTROL=alloc makes the T6 hot loop allocate, which
// must flip the gate red and exit non-zero -- the proof the gate can fail.
export const CONTROL = process.env.TORTURE_CONTROL || '';

// The zero-GC rules shared by every measured tier. Frontmatter: gc_maxMajor:0,
// gc_maxPauseMs:4. These are the exact keys the checkNoGc lane implements;
// passing a key it does not implement throws (profiler v1.10.0+), so this
// object is deliberately minimal.
export const RULES = { maxMajor: 0, maxPauseMs: 4 };

// --- PRNG --------------------------------------------------------------------

/**
 * xorshift32. Returns a `next()` yielding a uint32. Deterministic per seed.
 * @param {number} seed
 * @returns {() => number}
 */
export function xorshift32(seed) {
    let s = seed >>> 0;
    if (s === 0) s = 0x1a2b3c4d;
    return function next() {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s >>> 0;
    };
}

/** uint32 -> float in [0, 1). */
export function unit(u32) {
    return (u32 >>> 0) / 4294967296;
}

// --- failure -----------------------------------------------------------------

/**
 * Throw a replayable failure. The message string is built HERE, on the failure
 * path only -- never per iteration in a hot loop.
 * @param {string} tier
 * @param {string} msg
 * @param {{op?: number}} [ctx]
 */
export function fail(tier, msg, ctx) {
    let out = 'torture: FAIL [' + tier + '] ' + msg + ' | seed=' + SEED;
    if (ctx && ctx.op !== undefined) out += ' | op=' + ctx.op;
    throw new Error(out);
}

// --- box helpers -------------------------------------------------------------

/** Component-wise near-equality of two AABBs within `eps` (0 for exact f32). */
export function boxEq(a, b, eps) {
    return Math.abs(a[0] - b[0]) <= eps
        && Math.abs(a[1] - b[1]) <= eps
        && Math.abs(a[2] - b[2]) <= eps
        && Math.abs(a[3] - b[3]) <= eps;
}

/** Assert two boxes equal within eps; throws (with the op index) on mismatch. */
export function assertBoxEq(tier, got, exp, eps, op) {
    if (!boxEq(got, exp, eps)) {
        fail(tier,
            'box mismatch: got [' + got[0] + ',' + got[1] + ',' + got[2] + ',' + got[3] +
            '] expected [' + exp[0] + ',' + exp[1] + ',' + exp[2] + ',' + exp[3] + '] (eps ' + eps + ')',
            { op });
    }
}

/** Assert `got === exp` (strict); throws on mismatch. */
export function assertEq(tier, got, exp, what, op) {
    if (got !== exp) {
        fail(tier, (what || 'value') + ': got ' + got + ' expected ' + exp, { op });
    }
}

/** Assert `cond` is truthy; throws on false. */
export function assertOk(tier, cond, what, op) {
    if (!cond) fail(tier, (what || 'assertion') + ' failed', { op });
}

// --- corpus ------------------------------------------------------------------

/**
 * Allocate an array of `n` AABBs ONCE. Tiers fill and reuse them; never call
 * this inside a loop.
 * @param {number} n
 * @returns {Float32Array[]}
 */
export function allocBoxes(n) {
    const boxes = new Array(n);
    for (let i = 0; i < n; i++) boxes[i] = new Float32Array(4);
    return boxes;
}

/**
 * Fill a pre-allocated box array with valid (min <= max) random boxes at modest
 * coordinates, so f32 rounding stays well below the tiers' epsilons.
 * @param {Float32Array[]} boxes
 * @param {() => number} rng
 */
export function fillValidCorpus(boxes, rng) {
    for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const cx = unit(rng()) * 2000 - 1000;
        const cy = unit(rng()) * 2000 - 1000;
        const hw = unit(rng()) * 100;
        const hh = unit(rng()) * 100;
        b[0] = cx - hw;
        b[1] = cy - hh;
        b[2] = cx + hw;
        b[3] = cy + hh;
    }
}

// --- gc gate -----------------------------------------------------------------

/** Force a collection when --expose-gc is present; a no-op otherwise. */
export function maybeGc() {
    if (typeof globalThis.gc === 'function') globalThis.gc();
}

/**
 * Run `hotFn` inside a single lite-gc-profiler window and return the gate
 * verdict. The summary is read only AFTER an awaited settle tick, so the gate
 * never passes on an empty observation window.
 * @param {() => void} hotFn
 * @param {object} rules
 * @returns {Promise<{report: any, summary: any}>}
 */
export async function gcGate(hotFn, rules) {
    const gc = new GcProfiler(256, { heap: true }).start();
    hotFn();
    await gc.settle();
    const summary = gc.summary();
    gc.stop();
    return { report: checkNoGc(summary, rules), summary };
}
