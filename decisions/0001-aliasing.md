# 0001 — Aliasing: HARDEN the writers so `out` may alias any input

- **Status:** accepted
- **Date:** 2026-07-28
- **Session:** A1 (v1.0.2)
- **Findings:** A-07 (S1)
- **Supersedes:** the v1.0.x implicit "identical-view only" behaviour

## Context

The README's headline guarantee is:

> the `out` buffer can safely alias the input buffer in **every** function.

This was **false** for shifted / partially-overlapping views of a single
backing buffer (finding A-07). The writers wrote `out[0]` before reading
`a[1]`, so when `out` and `a` were offset views of one buffer, an early write
clobbered a slot a later line still needed.

Reproduced on v1.0.1, `a = buf.subarray(0,4)`, `out = buf.subarray(1,5)`,
`b = [-5,-5,5,5]`, `a = [-5,-5,10,10]`:

```
merge(out, a, b)   -> [-5,-5, 5, 5]     (correct: [-5,-5,10,10])
fatten(out, a, 1)  -> [-6,-7,-6,-5]     (correct: [-6,-6,11,11])
```

This is not a corner case to wave away: **the planned 2.0.0 packed batch ops
are built from exactly this buffer shape** — `out` and its neighbours are
`subarray` windows into one `4*N` buffer. A guarantee that is false for
shifted views is a guarantee the batch API cannot stand on. Deciding this now,
before anything is built on top, is why A1 blocks X1.

## Options

**A — HARDEN.** Snapshot every array input into locals before the first write
to `out`, in the four writers (`copy`, `merge`, `extend`, `fatten`). All reads
happen before all writes, so a write can never destroy a slot still needed.
The README sentence becomes true unconditionally; packed batch ops are safe by
construction.

**B — RESTRICT.** Keep the code, narrow the contract to "identical view or
disjoint buffers", document it in README + d.ts + llms.txt, and add a torture
case asserting the restriction. Cost: 2.0.0's batch ops must then never hand a
caller a partially-overlapping view — a constraint on an API that does not
exist yet, defined in the negative.

## Decision

**Option A.** The measured cost is zero (below), it removes an entire category
of future bug, and it keeps the promise the README already makes rather than
walking it back. B would trade a one-line-per-function fix for a permanent
constraint on a future API — the wrong direction.

## Hot-path cost (measured)

`node --expose-gc`, lite-gc-profiler `measureOps`, `source:'gc'`, 2,000,000
ops x 200,000 warmup, best-of-6, results **observed** (an input is varied and
`out` is summed into an escaping sink so V8 cannot dead-code-eliminate the
writes — an early naive bench did exactly that and reported a bogus 4x
"regression").

| writer  | v1.0.1 (interleaved) | v1.0.2 (snapshot) | delta        | bytes/op |
| ------- | -------------------- | ----------------- | ------------ | -------- |
| merge   | 96.5 Mops/s          | 103.7 Mops/s      | +7.5% (noise)| ~0.0004  |
| fatten  | 234.7 Mops/s         | 235.5 Mops/s      | +0.3%        | ~0.0003  |
| copy    | 246.1 Mops/s         | 246.0 Mops/s      | -0.1%        | ~0.0003  |

The snapshot locals are register-resident in V8 — they add no allocation
(`bytes/op` is at the measurement floor for all three) and no measurable time.
The same slots are read as before; they are only hoisted ahead of the writes.
The `bytes/op ~ 0` figure is re-asserted in the test suite
(`measureAllocs`, `maxBytesPerCall: 0`) and by torture tier T6.

## Consequences

- `copy`, `merge`, `extend`, `fatten` read all array inputs into locals first.
- `set` (scalar inputs), `create`/`clone` (fresh buffer) and the read-only
  predicates are unchanged — they have no read-after-write aliasing hazard.
- The contract is now: **`out` may alias any input under any view relationship,
  including shifted and partially-overlapping views.** `extend`/`merge` with an
  overlapping-view input compute against the pre-write snapshot of both inputs,
  which is the only well-defined meaning.
- Torture tier T2 pins the full aliasing matrix (section 3 of the roadmap),
  including the shifted-view rows that failed on v1.0.1.
- X1's packed batch ops are unblocked: any `subarray` window into a `4*N`
  buffer is a legal `out` or input.

This record is repo-only; it is not shipped in the npm tarball (`files[]`).
