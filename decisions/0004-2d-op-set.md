# 0004 -- Rounding out the 2D op set: point containment, squared distance, closest point

- **Status:** accepted
- **Date:** 2026-07-29
- **Session:** A4 (v1.3.0)
- **Findings:** none (purely additive)
- **Depends on:** 0001 (aliasing) / 0002 (degenerate values) / 0003 (precision)
- **Blocks:** X1 (twin 2.0.0)

## Context

The namespace covers composition (`merge`/`extend`/`fatten`), measurement
(`area`/`perimeter`/`overlapArea`), and box-vs-box predicates
(`intersects`/`contains`). It misses the three ops callers keep hand-rolling
against a raw `Float32Array`:

- **point-in-box** -- picking, hit-testing, mouse-vs-sprite;
- **box-to-box squared distance** -- proximity culling, "is this near that",
  broadphase pre-filters;
- **closest point on a box to a query point** -- circle-vs-box, snapping,
  nearest-feature.

This is the "add API without touching an invariant" rep. Every new op must obey
the touching-edge convention (A-02, inclusive predicates), the aliasing rule as
settled in 0001 (snapshot inputs before the first write), and the degenerate law
from 0002 (NaN propagates, hot ops are total and branchless), and must add zero
bytes to the sixteen existing bodies. There is no finding to fix here and no
behaviour flips -- the whole point is that nothing pinned moves.

## Decision

Ship exactly three new ops, appended to the frozen `aabb2` namespace after
`marginFloor` (16 -> 19). No existing body changes (git diff is the proof). A
**minor** bump (1.3.0) is honest: purely additive surface.

```
containsPoint(a, px, py) -> boolean
distanceSq(a, b)         -> number
closestPoint(out2, a, px, py) -> out2   // out2 is a LENGTH-2 Float32Array (Vec2)
```

### containsPoint -- inclusive, fail-closed

```js
containsPoint(a, px, py) {
    return px >= a[0] && px <= a[2] && py >= a[1] && py <= a[3];
}
```

- **Inclusive** (`>=` / `<=`): a point exactly on an edge or corner is contained,
  matching `contains` / `intersects` (the A-02 convention). Pinned by a test:
  `containsPoint` on a degenerate zero-size box `[x,y,x,y]` at `(x,y)` returns
  `true`, and **agrees with `contains(a, degenerateBox(x,y))`** -- a point is the
  same thing as a zero-size box to the containment predicate.
- **NaN fails closed**: any comparison against a `NaN` coordinate (in the box or
  the point) is `false`, so a poisoned input yields `false`, never a spurious
  `true`. This matches the boolean predicates (`intersects`/`contains`), which
  also return `false` on NaN. (The *numeric* ops propagate NaN as a value; the
  boolean ops cannot, so they fail closed instead. Both are "NaN never launders
  into a good answer.")
- Branchless, four indexed reads, no allocation.

### distanceSq -- squared, zero on touch, symmetric, NaN-propagating

```js
distanceSq(a, b) {
    const dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
    const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
    return dx * dx + dy * dy;
}
```

- Per axis, the gap is `max(0, aMin - bMax, bMin - aMax)`: positive only when the
  intervals are strictly apart, `0` when they overlap **or touch**. So
  `distanceSq` is **`0` for overlapping and for edge-touching** boxes, and equals
  the hand-computed Euclidean-squared gap for a disjoint pair.
- **Squared, not distance.** No `Math.hypot`, no `Math.sqrt` -- both are slower
  and the caller who wants the metric distance takes one `sqrt` at the end. This
  also keeps the op exact-friendly for comparisons (`dSq < r*r`). HOT PATH law:
  no `Math.hypot`.
- **Symmetric** by construction: swapping `a` and `b` swaps the two inner terms
  of each `Math.max`, which is order-independent. Pinned.
- **NaN propagates** (0002): a NaN coordinate makes its `Math.max(0, NaN, x)`
  NaN, so the result is NaN -- never laundered to 0. This is the numeric-op side
  of the law, consistent with `area` / `overlapArea`.
- Reads only; no `out`; no aliasing concern; no allocation.

### closestPoint -- the length-2 out buffer (the deliberate footgun)

```js
closestPoint(out2, a, px, py) {
    // Snapshot a's bounds before the first write: safe even when out2 is a
    // shifted/overlapping subarray of a's backing buffer (aliasing law, 0001).
    const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
    out2[0] = Math.min(Math.max(px, a0), a2);
    out2[1] = Math.min(Math.max(py, a1), a3);
    return out2;
}
```

- Clamp the point into the box on each axis: `min(max(p, lo), hi)`. Inside the
  box the clamp is the identity, so **an interior point maps to itself**; outside,
  it maps to the nearest edge or corner. **Idempotent**: the closest point of a
  closest point is itself (a clamp is idempotent). Pinned.
- **`out2` is a LENGTH-2 `Float32Array` (a `Vec2`), not a length-4 AABB.** This is
  the one footgun this release introduces: every other buffer in the package is
  length 4, and passing a length-4 box here (or a length-2 buffer to a box op)
  will not throw -- it will silently read/write the wrong slots. It is named
  loudly in the doc comment, gets its own `type Vec2 = Float32Array` in the `.d.ts`
  for clarity, and is called out in `llms.txt` and a dedicated README note. The
  parameter is named `out2` (not `out`) so the arity is visible at every call
  site.
- **Aliasing:** the four bounds are snapshotted into locals before the first
  write, so `out2` may alias `a` under any view relationship -- the same buffer, a
  shifted `subarray`, a packed neighbour -- exactly like the length-4 writers. The
  A1 shifted-view case is in the aliasing tests for it. (Snapshotting is not
  strictly required given we write index 0 then 1, but it makes correctness
  independent of write order and matches every other writer; the locals are
  register-resident, 0 bytes/op.)
- `px` / `py` on an inside point are returned bit-exact (clamp is a no-op, not an
  arithmetic round-trip).

## Why not more

Non-goals, restated so a later reader does not "finish the set":

- **No MTV / penetration vector, no contact points, no normals.** That is a
  collision *resolver*; this package is bounds only and the README says so.
- **No swept-AABB / TOI.** Use a CCD library.
- **No `distance` (un-squared).** `sqrt` is the caller's, at the caller's chosen
  moment; shipping both doubles surface for a `Math.sqrt`.
- **No `closestPoint` between two boxes.** `distanceSq` answers the proximity
  question; the closest *feature* between two boxes is a resolver concern.
- **No 3D. No spatial index** (that is lite-bvh).

## Hot path

All three are hot and written like it: indexed reads, `Math.min`/`Math.max` only
(branchless), write to the caller's `out2` where applicable, no closures, no
`Math.hypot`, no allocation. `measureAllocs` reports 0 bytes/op for each. The
sixteen prior bodies are byte-for-byte identical to v1.2.0 (`git diff` proves it;
the only edit inside an existing line is the VERSION string).

## Consequences

- **New API:** `containsPoint`, `distanceSq`, `closestPoint` -- opt-in,
  zero-alloc, frozen into the namespace (16 -> 19 ops).
- **`Vec2` type:** `type Vec2 = Float32Array` added to `Aabb.d.ts`; the length-2
  `out2` contract is documented in the `.d.ts`, `llms.txt`, and a README note.
- **No behaviour change:** nothing pinned moves. A-02 (touching), 0001 (aliasing),
  0002 (degenerate law) all extend to the new ops unchanged.
- **torture:** T0 gains three metamorphic laws (`distanceSq` symmetry,
  `closestPoint` idempotence, `containsPoint` <-> `contains`-of-degenerate-box);
  T1 adds the three ops to the degenerate cross-product against the float64
  oracle (16 -> 19 ops); T6 adds all three to the zero-alloc budget; T9 gains a
  control proving one new law (idempotence) is falsifiable.
- **X1:** the twin 2.0.0 packed batch ops build `containsPointAll` /
  `distanceSqAll` / `closestPointAll` from exactly these bodies; settling the
  scalar semantics here is the prerequisite.

This record is repo-only; it is not shipped in the npm tarball (`files[]`).
