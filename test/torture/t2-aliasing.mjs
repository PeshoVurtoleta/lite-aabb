/**
 * Tier T2 -- the aliasing matrix (A1: A-07).
 *
 * For every writer (copy, merge, extend, fatten) and every out/a/b view
 * relationship in section 3 of the roadmap, assert the aliased result equals a
 * non-aliased ORACLE. The oracle is computed from a snapshot of the inputs
 * taken BEFORE the call, so it is independent of any clobbering the aliasing
 * might cause -- exactly what v1.0.1 got wrong.
 *
 * Rows covered (per applicable writer):
 *   out distinct | out===a | out===b | a===b | out===a===b |
 *   out & a shifted views (offset 1,2,3) | out & b shifted |
 *   out & a disjoint views of one buffer | packed 4*N neighbouring box
 *
 * These are one-shot correctness checks, not a measured hot loop, so the
 * per-case snapshot arrays are fine -- the zero-alloc law governs hot bodies,
 * which these exercise but do not benchmark (T6 owns that).
 */

import { aabb2 } from '../../Aabb.js';

const TIER = 'T2';

// Exact f32 comparison of an out view against a plain-array oracle.
function eq(out, ref) {
    return out[0] === ref[0] && out[1] === ref[1] && out[2] === ref[2] && out[3] === ref[3];
}

export function run(h) {
    let checks = 0;

    function report(label, out, ref) {
        if (!eq(out, ref)) {
            h.fail(TIER, label + ': got [' + out[0] + ',' + out[1] + ',' + out[2] + ',' + out[3] +
                '] expected [' + ref[0] + ',' + ref[1] + ',' + ref[2] + ',' + ref[3] + ']', {});
        }
        checks++;
    }

    // --- oracles (from pre-call snapshots) ------------------------------------
    function vCopy(label, out, a) {
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        aabb2.copy(out, a);
        report(label, out, [a0, a1, a2, a3]);
    }
    function vMerge(label, out, a, b) {
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        aabb2.merge(out, a, b);
        report(label, out, [Math.min(a0, b0), Math.min(a1, b1), Math.max(a2, b2), Math.max(a3, b3)]);
    }
    function vFatten(label, out, a, m) {
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        aabb2.fatten(out, a, m);
        report(label, out, [a0 - m, a1 - m, a2 + m, a3 + m]);
    }
    function vExtend(label, out, b) {
        const o0 = out[0], o1 = out[1], o2 = out[2], o3 = out[3];
        const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        aabb2.extend(out, b);
        report(label, out, [Math.min(o0, b0), Math.min(o1, b1), Math.max(o2, b2), Math.max(o3, b3)]);
    }

    const A = [-5, -5, 10, 10];
    const B = [-8, -3, 5, 20];

    // Build a standalone box from values.
    const box = (v) => aabb2.set(new Float32Array(4), v[0], v[1], v[2], v[3]);

    // --- distinct buffers -----------------------------------------------------
    vCopy('copy: out distinct', new Float32Array(4), box(A));
    vMerge('merge: out distinct', new Float32Array(4), box(A), box(B));
    vFatten('fatten: out distinct', new Float32Array(4), box(A), 1);
    { const o = box(A); vExtend('extend: out distinct', o, box(B)); }

    // --- out === a (and out === b, a === b, out===a===b) ----------------------
    { const s = box(A); vCopy('copy: out === a', s, s); }
    { const s = box(A); vFatten('fatten: out === a', s, s, 2); }
    { const s = box(A); vMerge('merge: out === a', s, s, box(B)); }
    { const s = box(B); vMerge('merge: out === b', s, box(A), s); }
    { const a = box(A); const o = new Float32Array(4); vMerge('merge: a === b', o, a, a); }
    { const s = box(A); vMerge('merge: out === a === b', s, s, s); }
    { const s = box(A); vExtend('extend: out === b (self)', s, s); }

    // --- shifted / overlapping views of ONE buffer (the A-07 rows) ------------
    for (let off = 1; off <= 3; off++) {
        // out and a share a buffer, out shifted by `off` (overlaps a).
        {
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[i] = A[i];
            const a = buf.subarray(0, 4);
            const out = buf.subarray(off, off + 4);
            vCopy('copy: out & a shifted +' + off, out, a);
        }
        {
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[i] = A[i];
            const a = buf.subarray(0, 4);
            const out = buf.subarray(off, off + 4);
            vFatten('fatten: out & a shifted +' + off, out, a, 1);
        }
        {
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[i] = A[i];
            const a = buf.subarray(0, 4);
            const out = buf.subarray(off, off + 4);
            vMerge('merge: out & a shifted +' + off, out, a, box(B));
        }
        {
            // out and b share a buffer, out shifted by `off`.
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[i] = B[i];
            const b = buf.subarray(0, 4);
            const out = buf.subarray(off, off + 4);
            vMerge('merge: out & b shifted +' + off, out, box(A), b);
        }
        {
            // extend: out and b overlap (b shifted ahead of out).
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[i] = A[i];
            for (let i = 0; i < 4; i++) buf[off + i] = B[i];
            const out = buf.subarray(0, 4);
            const b = buf.subarray(off, off + 4);
            vExtend('extend: out & b shifted +' + off, out, b);
        }

        // Reverse overlap direction: `out` sits BEFORE its input (input shifted
        // ahead of out). Snapshot-first makes this equivalent to the forward
        // rows by construction; asserting both makes the gate exhaustive, not
        // representative.
        {
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[off + i] = A[i];
            const out = buf.subarray(0, 4);
            const a = buf.subarray(off, off + 4);
            vCopy('copy: out before a (+' + off + ')', out, a);
        }
        {
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[off + i] = A[i];
            const out = buf.subarray(0, 4);
            const a = buf.subarray(off, off + 4);
            vFatten('fatten: out before a (+' + off + ')', out, a, 1);
        }
        {
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[off + i] = A[i];
            const out = buf.subarray(0, 4);
            const a = buf.subarray(off, off + 4);
            vMerge('merge: out before a (+' + off + ')', out, a, box(B));
        }
        {
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[off + i] = B[i];
            const out = buf.subarray(0, 4);
            const b = buf.subarray(off, off + 4);
            vMerge('merge: out before b (+' + off + ')', out, box(A), b);
        }
        {
            const buf = new Float32Array(4 + off + 4);
            for (let i = 0; i < 4; i++) buf[i] = B[i];
            for (let i = 0; i < 4; i++) buf[off + i] = A[i];
            const out = buf.subarray(off, off + 4);
            const b = buf.subarray(0, 4);
            vExtend('extend: b before out (+' + off + ')', out, b);
        }
    }

    // --- disjoint views of one buffer -----------------------------------------
    {
        const buf = new Float32Array(8);
        for (let i = 0; i < 4; i++) { buf[i] = A[i]; buf[4 + i] = B[i]; }
        vMerge('merge: out & a disjoint views', buf.subarray(4, 8), buf.subarray(0, 4), box(B));
    }

    // --- packed 4*N buffer: out is one window, a the neighbouring box ----------
    {
        const N = 4;
        const packed = new Float32Array(4 * N);
        for (let i = 0; i < 4; i++) packed[4 + i] = A[i]; // box 1 = a
        const a = packed.subarray(4, 8);
        const out = packed.subarray(8, 12);               // box 2 = out (neighbour)
        vFatten('fatten: packed 4N neighbour', out, a, 1);
        // and a merge into the neighbouring window
        for (let i = 0; i < 4; i++) packed[i] = B[i];     // box 0 = b
        vMerge('merge: packed 4N neighbour', packed.subarray(8, 12), packed.subarray(4, 8), packed.subarray(0, 4));
    }

    // Coverage floor: locks the current matrix (44 cases -- both overlap
    // directions at offsets 1-3) so a later edit that drops a row trips the
    // gate instead of silently shrinking coverage.
    if (checks < 44) h.fail(TIER, 'matrix under-covered: only ' + checks + ' cases ran', {});
}
