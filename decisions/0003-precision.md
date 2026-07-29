# 0003 -- The precision law: a detectable margin floor, f32 hot path unchanged

- **Status:** accepted
- **Date:** 2026-07-29
- **Session:** A3 (v1.2.0)
- **Findings:** A-01 (S1)
- **Depends on:** 0002 (degenerate values) / A2
- **Blocks:** X1 (twin 2.0.0), and the lite-bvh fat-bounds consumer

## Context

`fatten` silently fails to widen a box once the requested margin drops below the
float32 step (ULP) at the box's coordinates:

```
fatten(out, create(1e7, 1e7, 1e7 + 1, 1e7 + 1), 0.5)  ->  out[0] === 1e7
```

At coordinate 1e7 the f32 ULP is 1.0, so a 0.5 margin rounds away. Nothing
detects it: `contains(out, a)` still returns `true`. Downstream, lite-bvh's fat
bounds equal its tight bounds and every `updateLeaf` takes the slow path
forever -- the O(1) fast path that is the entire reason the dynamic tree is fast
under motion is gone. The bvh README recommends margins of 0.1-4; above 2^24 the
ULP is 2.0 and everything under it evaporates.

This is not a bug *in* `fatten`. `fatten` computes `a +/- margin` and rounds to
f32 correctly. The bug is that the package offered no way to know the margin was
too small for the scale. The question A3 answers is therefore not "should the
element type be configurable" but "what does the package do when the requested
margin is smaller than the representable step at that coordinate."

## Options (with size + test-matrix costs)

- **A -- DOCUMENT THE FLOOR.** Ship `marginFloor(a)`: the smallest margin that
  provably widens the box at its coordinates. One new zero-alloc function; no
  existing code path changes; no test-matrix doubling. Callers and lite-bvh
  clamp against it. Does not silently fix the arithmetic -- it makes the limit
  *detectable*, which is the honest thing an f32 library can do.
- **B -- FATTEN AT LEAST ONE ULP.** `fatten` bumps its result to `nextafter`
  when the requested margin rounds away. A branch in the hottest function; a
  silent no-op becomes a 1-ulp widen, so it is arguably a breaking behaviour
  change. Fixes the bvh fast path at the source.
- **C -- FACTORY.** `createAabbNamespace(ArrayType)` bound to Float32Array or
  Float64Array. A second code path, a doubled test matrix (every op x aliasing
  matrix x both types), a doc section. Default f32 path byte-identical.
- **D -- DUAL EXPORT.** Ship `aabb2` (f32) and `aabb2f64` (f64) as two frozen
  namespaces. Simplest for callers, largest source, doubled maintenance.

A/B (the floor question) and C/D (the element type) are orthogonal. f64 pushes
the floor out to ~1e15 but does not remove it: even option D needs A or B to be
honest.

## Decision

**A, and only A. No f64 path (C and D rejected). `fatten` unchanged (B
rejected).**

This is the precision analogue of A2's degenerate-value law, and the consistency
is the whole argument:

- A2 established the law that **the hot ops are total and branchless; a caller
  checks state with an opt-in predicate at a trust boundary** (`isValid`), never
  with a guard bolted into a hot op. `marginFloor` is exactly that shape for
  precision: detection at the door, `fatten` stays branchless. Option B would
  contradict the law we shipped 1.1.0 to establish -- it puts a branch and a
  behaviour flip in the single hottest function.
- The suite law is **"bytes in a hot body, not instructions."** A keeps all
  fifteen prior bodies byte-for-byte identical (git diff is the proof, `fatten`
  included). B does not.
- A is purely additive (one new frozen function), so a **minor** bump (1.2.0) is
  honest. B changes existing semantics.
- The f32 floor is inherent to *any* finite float type; f64 only relocates it to
  ~1e15. Shipping a whole parallel namespace to "solve" A-01 is invented
  surface. A caller who genuinely needs a larger honest range can already pass a
  `Float64Array` to the out-parameter ops -- every op reads and writes `a[0..3]`
  and is element-type-agnostic; only `create`/`clone` hardcode `Float32Array`.
  The README's old "swap the type yourself" line is rewritten to say exactly
  that, and to point at `marginFloor` for detection.
- A gives lite-bvh (and X1's packed batch ops) a single shared definition of
  "how much margin is real at this scale" to clamp against -- the precision
  parallel to how A2's `isValid` gave B2 something to quarantine against.

One new function joins the frozen namespace (15 -> 16):

```
marginFloor(a) -> ULP (gap to the next representable float32) of the
                  largest-magnitude coordinate; the smallest margin that
                  provably widens every side.
```

Caller idiom, documented in README/llms/d.ts:

```js
aabb2.fatten(out, a, Math.max(margin, aabb2.marginFloor(a)));
```

### Why the *upper* ULP, and why a bit-scratch

The two f32 steps around a coordinate differ just above a power of two: at 2^24
the step below is 1.0, the step above is 2.0. `fatten` moves the min sides down
(needs the lower step) and the max sides up (needs the upper step). Returning the
**upper** ULP is the conservative value that provably widens *both*; the
measured table below confirms `marginFloor(2^24 box) === 2` and that margin 1
fails to widen the max side there.

The ULP is computed exactly by incrementing the value's float32 bit pattern
(`_ulpI32[0] += 1`) through a module-private `Float32Array(1)` allocated once at
import. This is exact across the whole normal range; `Math.log2` was rejected
because it rounds at powers of two and would misreport the step for the exact
coordinates this finding is about. The scratch is init-time state with no
externally observable effect, so `sideEffects: false` still holds, and it adds
zero per-call allocation (verified by `measureAllocs`).

### Fail-closed edge policy (consistent with 0002)

- A **NaN** coordinate -> `marginFloor` returns `NaN` (the max propagates it).
- An **infinite** coordinate -> `Infinity`: no finite margin widens an infinite
  box.
- A **zero** box -> the smallest subnormal (`~1.4e-45`), the true minimal step
  near zero.

`marginFloor` is defined on any box, valid or not -- it reads coordinate
magnitudes, not min/max order.

## The measured evaporation table

`fatten(create(s, s, s+1, s+1), m)`, "widened" = all four sides moved. The
largest-magnitude coordinate is `s+1`, so its upper ULP is the floor.

| scale `s` | m=0.1 | m=0.5 | m=1 | m=4 | `marginFloor` |
| --------- | ----- | ----- | --- | --- | ------------- |
| 1         | YES   | YES   | YES | YES | 2.384e-7 (2^-22) |
| 1e3       | YES   | YES   | YES | YES | 6.104e-5      |
| 1e6       | YES   | YES   | YES | YES | 0.0625        |
| **1e7**   | **no**| **no**| YES | YES | **1**         |
| **2^24**  | **no**| **no**| **no** | YES | **2**      |

Every "no" cell is a margin strictly below `marginFloor`; every "YES" cell is a
margin `>= marginFloor`. The floor predicts the boundary exactly. Clamping with
`Math.max(m, marginFloor(a))` widens on every row (verified). A margin just below
the floor (`0.49 * floor`) provably fails to widen the max-magnitude side on
every row (verified) -- this is the metamorphic form of A-01, now a passing law
in torture T0 instead of a pinned bug.

## The exact A-01 case, resolved

```
box   = set(o, 1e7, 1e7, 1e7 + 1, 1e7 + 1)
marginFloor(box) === 1          // 0.5 < 1  -> the 0.5 margin was doomed
fatten(o, box, 0.5)   -> o[0] === 1e7     // unchanged: fatten is UNCHANGED
fatten(o, box, Math.max(0.5, 1)) -> o[0] === 9999999   // clamp widens
```

## Hot path

All fifteen prior bodies are byte-for-byte identical to v1.1.0 (`git diff`
proves it); `fatten` is deliberately untouched. `marginFloor` is a new function a
caller opts into at a boundary, never called from a hot loop. `measureAllocs`
reports 0 bytes/op for it.

## Consequences

- **New API:** `marginFloor` -- opt-in, zero-alloc, frozen into the namespace.
- **No behaviour change:** `fatten` and every other op are unchanged. A-01's
  arithmetic is *unchanged and re-pinned* (fatten below the floor still does not
  widen); what is new is that `marginFloor` **detects** it and the clamp fixes
  it. A-01 moves from "known issue" to "addressed at the API layer."
- **No f64:** rejected as orthogonal invented surface. Documented that callers
  may supply their own `Float64Array` out-buffer (floor still exists at ~1e15).
- **torture:** T0's fatten round-trip law is upgraded from a pinned bug to a
  passing law keyed on `marginFloor`; T1's A-01 pin flips from "nothing detects
  it" to "marginFloor detects it"; T9 gains a control proving the floor gate is
  falsifiable (a `marginFloor`-returns-0 stub must fail).
- **lite-bvh / X1:** consume `marginFloor` to clamp fat-bounds margins so the
  fast path cannot silently die at world scale. The cross-package A-01 detector
  (torture T8) lands with the bvh line.

This record is repo-only; it is not shipped in the npm tarball (`files[]`).
