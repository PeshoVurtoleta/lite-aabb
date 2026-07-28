# 0002 — The degenerate-value law: predicates + sentinel, NaN propagates

- **Status:** accepted
- **Date:** 2026-07-29
- **Session:** A2 (v1.1.0)
- **Findings:** A-03 (S1), A-04 (S2), A-05 (S1)
- **Depends on:** 0001 (aliasing) / A1
- **Blocks:** B2 (lite-bvh poison quarantine + `validate()`)

## Context

On v1.0.x, "what does a broken box mean?" is answered differently by every
function:

- `overlapArea(a, NaNbox)` launders NaN into a clean-looking `0`.
- `area(NaNbox)` returns `NaN`; `merge`/`extend` propagate NaN into `out`.
- An inverted box (`min > max`) has a **positive** `area` and does **not**
  `intersect` itself.
- The README's own recommended empty sentinel `create(Inf, Inf, -Inf, -Inf)`
  has `perimeter() === -Infinity` and `area() === +Infinity`. lite-bvh uses
  `perimeter` as its SAH descent cost, so a never-merged sentinel injects a
  `-Infinity` cost into a live tree (the A-04 -> B-03 chain).

The incoherence is the bug. The values themselves are mostly a natural
consequence of doing f32 arithmetic without validation; what is missing is a
single law and the tools to apply it.

## The law

1. **NaN propagates. It is never laundered.** A `NaN` coordinate anywhere
   yields `NaN` out of every numeric op, including `overlapArea`. This is the
   only behaviour change in A2.
2. **Every box is one of three states**, and callers distinguish them with new,
   opt-in predicates:
   - **VALID** — four finite coordinates AND `min <= max` on both axes.
     `isValid(a) === true`.
   - **EMPTY** — exactly the canonical sentinel `[Inf, Inf, -Inf, -Inf]`.
     `isEmpty(a) === true`. This box is the identity of `merge`/`extend`.
   - **GARBAGE** — anything else: NaN, mixed infinities, inverted boxes.
3. **The hot ops are TOTAL but only meaningful on valid boxes.** Geometry on a
   non-valid box returns whatever the arithmetic yields — it never throws,
   never allocates, never branches to "handle" the degenerate case. Validation
   lives at trust boundaries (`isValid`), never inside a hot op.
4. **Fail closed.** A caller that has not checked `isValid` is holding an
   unverified box; the sentinel is unverified-*for-geometry* by construction.

## Options (from the roadmap)

- **A — PERMISSIVE + PINNED.** Freeze today's behaviour, document every ugly
  answer with a named test. Zero code. But it ships nothing lite-bvh can use to
  quarantine poison, and leaves the README's hand-rolled sentinel as a footgun.
- **B — PROPAGATE CONSISTENTLY.** NaN in, NaN out, everywhere. One branch in
  `overlapArea` (drop the laundering). Makes the surface coherent.
- **C — PREDICATE + SENTINEL API.** Keep hot ops permissive; ship `isValid`,
  `isEmpty`, `setEmpty`; give lite-bvh something to check against.

## Decision

**C, with B's `overlapArea` fix folded in.** C is what the companion package
actually needs in B2, and it removes a documented footgun (the hand-rolled
sentinel) rather than adding surface. B's one-line fix is what makes the NaN
story coherent — without it, `overlapArea` would still be the lone launderer.
A alone is insufficient: pinning incoherence as contract does not unblock B2.

Three new zero-allocation functions join the frozen namespace (12 -> 15):

```
isValid(a)   -> Number.isFinite x4 AND a[0] <= a[2] AND a[1] <= a[3]
isEmpty(a)   -> a === [Inf, Inf, -Inf, -Inf] exactly
setEmpty(out)-> writes [Inf, Inf, -Inf, -Inf], returns out
```

### Two tensions the roadmap left open, resolved here

**1. "Make `perimeter(empty) === 0`" vs. "the twelve hot bodies must not gain a
branch."** These are mutually exclusive, and provably so: a `merge`-identity
empty box requires `min > max` (so `Math.min`/`Math.max` select the operand),
which makes width and height negative — its perimeter/area *cannot* also be `0`
without a runtime branch. No single unbranched box satisfies both.

Resolution: **keep the sentinel a pure merge-identity and do NOT branch
`perimeter`/`area`.** A-04 is closed at the API/documentation layer, not by
mutating a hot op:
- `setEmpty` means users stop hand-rolling the sentinel (the actual source of
  the footgun — the README told them to);
- `isEmpty`/`isValid` let lite-bvh (B2) quarantine the sentinel *before* it ever
  reaches `perimeter` as an SAH cost;
- `perimeter(sentinel) === -Infinity` stays pinned in torture T1 — now a
  recognized, guardable value rather than a silent trap.

This keeps all eleven non-`overlapArea` hot bodies byte-for-byte identical
(git diff proves it), honouring HOT PATH and the "twelve unchanged" assertion.

**2. Is the empty sentinel `isValid`?** **No, and this is deliberate.**
`isValid` answers "is this box safe to do geometry with and trust the number?"
For the sentinel the honest answer is no — its `perimeter` is `-Infinity`. It is
non-finite by construction, so it fails the finiteness test. `isEmpty` is its
separate recognizer. The result is a clean, mutually-exclusive tri-state
(valid | empty | garbage). Callers seed a reduction with `setEmpty`, accumulate
with `merge`/`extend`, and check `isValid` on the result.

## The one hot-body change: `overlapArea` (measured)

```js
// before (launders NaN to 0):
return wx > 0 && wy > 0 ? wx * wy : 0;

// after (propagates NaN; finite non-overlap still 0):
if (wx > 0 && wy > 0) return wx * wy;
return wx !== wx || wy !== wy ? NaN : 0;
```

The **fast path is byte-for-byte identical**: when the boxes overlap (`wx > 0 &&
wy > 0`, the case the SAH-adjacent hot loop actually hits), both variants
compute and return `wx * wy`. The only added instructions are two compares
(`wx !== wx || wy !== wy`) on the **cold** path — a genuine non-overlap or a NaN
input — which is off the hot loop.

Measured with lite-gc-profiler `measureOps`, `source:'gc'`, 2,000,000 ops x
200,000 warmup, best-of-8, results observed into an escaping sink (the same
DCE-safe shape as 0001). The overlapping-input microbench:

| trial | old (launder) | new (propagate) | delta   |
| ----- | ------------- | --------------- | ------- |
| 1     | 100.5 Mops/s  | 93.9 Mops/s     | -6.6%   |
| 2     |  86.4 Mops/s  | 91.4 Mops/s     | +5.7%   |
| 3     |  84.3 Mops/s  | 90.0 Mops/s     | +6.8%   |
| 4     |  74.2 Mops/s  | 74.8 Mops/s     | +0.8%   |

The delta **swings +/-7% and changes sign between trials** — old and new trade
places. That is measurement noise on an identical fast path, not a regression:
there is no measurable cost on the overlapping (hot) path, and `bytesPerOp` is
`0.0000` for both. The added branch is confined to the degenerate path, which is
exactly where the roadmap's HOT PATH carve-out permits it.

## Consequences

- **New API:** `isValid`, `isEmpty`, `setEmpty` — opt-in, zero-alloc, added to
  the frozen namespace. Not guards inside the hot ops.
- **Behaviour change (minor, a bug fix):** `overlapArea` returns `NaN` for a
  box carrying a NaN coordinate instead of `0`. Finite overlap and finite
  non-overlap are unchanged. This is the only pin in torture T1 that flips in
  A2 (it expected `0` on 1.0.x).
- **Unchanged and re-pinned as-is:** `area`/`perimeter` of the sentinel
  (`+Inf`/`-Inf`), `area` of an inverted box (positive), an inverted box not
  self-intersecting, `merge`/`extend` NaN propagation. `isValid` is now the
  documented detector for A-05's inversions.
- **Inverted-box policy (A-05):** negative margins are permitted; an inverted
  result is the CALLER's bug; `isValid` is how they detect it. The arithmetic is
  not changed.
- **torture T1 is now complete:** every op crossed with every degenerate value
  (zeros, both infinities, the sentinel, NaN in one and all slots, subnormals,
  f32 max, the integer boundary, one-ulp-apart, zero-size, single-axis
  degenerate, inverted on one and both axes, zero-straddling) against an
  independent float64 oracle, plus the human-eyeballed finding pins. T9 gains a
  control proving the `isValid` gate is falsifiable.
- **B2 is unblocked:** lite-bvh can define "poison" as `!isValid` and quarantine
  the empty sentinel with `isEmpty`, using this package as the single source of
  truth for both.

This record is repo-only; it is not shipped in the npm tarball (`files[]`).
