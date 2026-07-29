# Changelog

All notable changes to `@zakkster/lite-aabb` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-07-29

The precision law. Float32 has a coordinate-dependent step, so `fatten` silently
stops widening once the margin drops below it (A-01). This release makes that
limit **detectable** without touching the hot path. No behaviour changes.
Decision recorded in `decisions/0003-precision.md`.

### Added

- **`marginFloor(a)`** -- the smallest margin that provably widens `a` on all
  four sides at its coordinates: the float32 ULP (gap to the next representable
  value) of the largest-magnitude coordinate. Clamp with it:
  `fatten(out, a, Math.max(margin, marginFloor(a)))`. Returns `NaN` for a NaN
  coordinate and `Infinity` for an infinite one (fail closed); a zero box yields
  the smallest subnormal. Zero allocations. This is the precision analogue of
  `isValid` -- a boundary predicate, not a guard inside a hot op.

### Fixed (at the API layer -- hot bodies unchanged)

- **A-01** (S1) -- margin evaporation is now **detectable**. `fatten`'s
  arithmetic is deliberately **unchanged** (a margin below the ULP still rounds
  away -- that is a property of float32, and adding a branch or a `nextafter`
  bump to the hottest function was rejected to keep it byte-for-byte identical
  and non-breaking). `marginFloor` reports the true step so callers and
  `@zakkster/lite-bvh` can clamp fat-bounds margins and stop the fast path from
  silently dying at world scale. `git diff` proves all fifteen prior bodies are
  unchanged. Measured evaporation table (coordinate scale x margin -> widened)
  is in the decision record.

### Changed

- Torture **T0**'s fatten round-trip law is upgraded from a pinned bug to a
  passing law keyed on `marginFloor` (at/above the floor every side widens;
  just below it the max-magnitude side provably does not, across five scales).
  **T1**'s A-01 pin flips from "nothing detects the evaporation" to
  "`marginFloor` detects it, and the clamp fixes it", and adds `marginFloor` to
  the degenerate cross-product (16 ops x 19 cases) against an independent
  DataView oracle. **T9** gains a control proving the floor gate is falsifiable.

## [1.1.0] - 2026-07-29

The degenerate-value law. One coherent answer to "what does a broken box mean",
plus the tools to apply it. The one behaviour change is a **bug fix**:
`overlapArea` stops laundering `NaN` into `0`. Decision recorded in
`decisions/0002-degenerate-values.md`.

### Added

- **`isValid(a)`** -- true iff all four coordinates are finite AND `min <= max`
  on both axes. The opt-in check for a trust boundary. False for NaN, mixed
  infinities, and inverted boxes; true for zero-size boxes. Zero allocations.
- **`isEmpty(a)`** -- true iff `a` is exactly the canonical empty sentinel
  `[Inf, Inf, -Inf, -Inf]`, which is the identity of `merge`/`extend`. Zero
  allocations.
- **`setEmpty(out)`** -- writes the canonical empty box into `out`; the correct
  seed for a `merge`/`extend` reduction. Replaces the README's old advice to
  hand-roll `create(Inf, Inf, -Inf, -Inf)`. Zero allocations.

  The law: **NaN propagates, never launders**; every box is **VALID**, **EMPTY**,
  or **GARBAGE**, distinguished by these predicates. Geometry on a non-valid box
  is total but only meaningful on valid boxes -- validation lives at boundaries,
  never inside a hot op.

### Changed

- **A-03** (S1) -- `overlapArea` now **propagates `NaN`** instead of laundering
  it to `0`. A box carrying a `NaN` coordinate yields `NaN`; a genuine finite
  non-overlap still returns `0`, and finite overlap is unchanged. This makes the
  NaN policy consistent with `area`/`merge`/`extend` (which already propagate).
  The fast (overlapping) path is byte-for-byte identical; the added compares are
  on the cold path only, at no measurable hot-path cost (numbers in the decision
  record). This is the only pinned answer that flips in this release.

### Fixed (at the API layer -- hot bodies unchanged)

- **A-04** (S2) -- the empty-sentinel footgun is closed by shipping `setEmpty`
  (so users stop hand-rolling it) and `isEmpty`/`isValid` (so `@zakkster/lite-bvh`
  can quarantine it before it reaches `perimeter` as an SAH cost). The raw
  `perimeter`/`area` of the sentinel are deliberately **unchanged** (`-Infinity`
  /`+Infinity`): making them `0` would require a branch in a hot op, which the
  law forbids. The sentinel is now a recognized value, not a silent trap.

### Documented (behaviour unchanged, now with a detector)

- **A-05** (S1) -- inverted-box policy is explicit: negative margins are
  permitted, an inverted result (`min > max`) is the CALLER's bug, and `isValid`
  is how they detect it. `area` of an inverted box stays positive; the
  arithmetic is not changed. Pinned in torture T1.
- Torture tier **T1** is now **complete**: every op crossed with every
  degenerate value (both infinities, the sentinel, NaN in one and all slots,
  subnormals, f32 max, the integer boundary, one-ulp-apart, zero-size,
  single-axis-degenerate, inverted on one and both axes, zero-straddling)
  against an independent float64 oracle. T9 gains a control proving the
  `isValid` gate is falsifiable.

### Still known (fixed in later releases)

- **A-01** (S1, A3) -- margin evaporation below a float32 ULP. Unchanged here;
  pinned in torture T1. **Addressed in 1.2.0** via `marginFloor`.

## [1.0.2] - 2026-07-28

Aliasing truth + contract pinning. The one behaviour change is a **bug fix**:
shifted/overlapping `out` views now produce correct results. Callers relying on
the identical-view or disjoint-buffer cases are unaffected. Decision recorded in
`decisions/0001-aliasing.md`.

### Fixed

- **A-07** (S1) — the headline aliasing guarantee is now **true unconditionally**.
  `out` may alias any input under any view relationship, including shifted and
  partially-overlapping `subarray` views of one backing buffer. The four writers
  (`copy`, `merge`, `extend`, `fatten`) snapshot every array input into locals
  before the first write, so a write can no longer clobber a slot a later read
  needs. On ≤ 1.0.1, `merge`/`fatten`/`copy` over a shifted view silently
  corrupted the result (e.g. a packed `4*N` buffer where `out` and its neighbour
  overlap). Measured hot-path cost: zero (register-resident locals, 0 bytes/op;
  numbers in the decision record). This unblocks the planned 2.0.0 packed batch
  ops, which are built from exactly this buffer shape.

### Changed

- **A-06** (S3) — `aabb2` is now **frozen** (`Object.freeze`). Runtime
  monkey-patching of an operation throws in strict mode instead of succeeding.
  The namespace is a contract, not a mutable bag.

### Pinned (behaviour unchanged, now locked by a named test)

- **A-02** (S3) — the touching-edge convention is pinned in one named test on a
  single pair: `intersects` → true, `contains` → true, `overlapArea` → `0`. The
  three-way split (inclusive predicates, zero-area overlap) is deliberate; a
  touching pair genuinely shares zero area.
- **A-10** (S3) — the float32 integer boundary (`set(o,0,0,16777217,1)` reads
  back `16777216`) is pinned by a named test.
- Torture tier **T2** (previously an empty placeholder) now carries the complete
  out/a/b aliasing matrix — distinct, identical, shifted views at offsets 1–3 in
  BOTH overlap directions, disjoint views, and packed-`4*N` neighbour — each
  verified against a non-aliased oracle (44 cases).

### Still known (fixed in later releases)

- **A-01** (S1, A3), **A-03** (S1, A2), **A-04** (S2, A2), **A-05** (S1, A2) —
  margin evaporation, NaN incoherence, empty-sentinel infinities, and inverted-box
  nonsense remain pinned-as-is in torture T1. Unchanged here.

## [1.0.1] - 2026-07-28

Harness release. **No runtime behaviour changed** — every one of the twelve
operations is byte-for-byte identical to 1.0.0. This release exists to make the
package's guarantees testable and to record, on the record, the defects that the
1.x line will fix in order.

### Added

- Ported the test suite to `node:test` (`node --test test/*.test.js`), replacing
  the bespoke assert runner. All previous assertions are retained; a `VERSION`
  surface test is added.
- `VERSION` const exported from `Aabb.js` (and declared in `Aabb.d.ts`), giving a
  three-place version sync — `package.json`, `Aabb.js`, this changelog — from
  this release forward.
- `test/torture.mjs` zero-GC / metamorphic gate (`npm run torture`), built on
  `@zakkster/lite-gc-profiler` and `@zakkster/lite-leak` as dev-only peers. It
  prints exactly `ok` and exits 0 on pass. Tiers wired now: **T0** metamorphic
  laws, **T1** degenerate values (answers *pinned as they are today*, bugs
  included), **T6** zero-alloc GC budget, **T7** soak, **T9** controls (every
  gate has a deliberately-broken variant that must exit non-zero). Tiers **T2**
  (aliasing matrix), **T5** (differential fuzz) and **T8** (cross-package) are
  registered as empty placeholders for later sessions.
- `CHANGELOG.md` added to the published `files[]`.

### Changed

- `engines.node` raised from `>=14` to `>=18`. The prior floor was incorrect —
  `node --test` does not exist on Node 14.

### Fixed

- The test file previously imported `aabb2` from `../Aabb.d.ts` (a type-only
  declaration with no runtime value), so the suite could not execute at all. It
  now imports from `../Aabb.js`.

### Known issues (tracked, fixed in later releases)

These are documented and pinned by test in this release; the current (often
wrong) answers are locked so later fixes are deliberate, reviewable flips. None
are fixed here.

- **A-01** (S1) — `fatten()`'s margin silently evaporates once it drops below
  half a float32 ULP (e.g. `fatten(o, [1e7,1e7,1e7+1,1e7+1], 0.5)` leaves the box
  unchanged). Voids `@zakkster/lite-bvh`'s fat-bounds fast path at world scale.
  *Owned by A3.*
- **A-02** (S3) — touching-edge convention is split three ways and unpinned:
  `intersects` true, `contains` true, `overlapArea` `0`. *Pinned by A1.*
- **A-03** (S1) — NaN policy is incoherent: `overlapArea` launders NaN to `0`,
  `area` returns NaN, `merge`/`extend` poison `out` permanently. *Owned by A2.*
- **A-04** (S2) — the README's recommended empty sentinel
  `create(Inf,Inf,-Inf,-Inf)` has `perimeter() === -Infinity` and
  `area() === Infinity`. *Owned by A2.*
- **A-05** (S1) — negative-margin inversion is silent nonsense: an inverted box
  has positive `area` and does not `intersect` itself. *Owned by A2.*
- **A-06** (S3) — `aabb2` is not frozen; runtime monkey-patching succeeds.
  *Owned by A1.*
- **A-07** (S1) — the "`out` may alias the input" guarantee is **false for
  shifted views** of one buffer (`merge`/`fatten` corrupt the result). This is
  the exact buffer shape 2.0.0's packed batch ops are built from. *Owned by A1.*
- **A-10** (S3) — the float32 integer boundary (`16777217` reads back as
  `16777216`) is folk knowledge, not a test. *Pinned by A1.*

## [1.0.0] - 2025-05-15

- Initial release: twelve zero-allocation 2D AABB operations on a flat
  `Float32Array(4)` `[minX, minY, maxX, maxY]`.

[1.2.0]: https://github.com/PeshoVurtoleta/lite-aabb/releases/tag/v1.2.0
[1.1.0]: https://github.com/PeshoVurtoleta/lite-aabb/releases/tag/v1.1.0
[1.0.2]: https://github.com/PeshoVurtoleta/lite-aabb/releases/tag/v1.0.2
[1.0.1]: https://github.com/PeshoVurtoleta/lite-aabb/releases/tag/v1.0.1
[1.0.0]: https://github.com/PeshoVurtoleta/lite-aabb/releases/tag/v1.0.0
