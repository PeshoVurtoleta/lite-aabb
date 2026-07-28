# Changelog

All notable changes to `@zakkster/lite-aabb` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to
[Semantic Versioning](https://semver.org/).

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

[1.0.1]: https://github.com/PeshoVurtoleta/lite-aabb/releases/tag/v1.0.1
[1.0.0]: https://github.com/PeshoVurtoleta/lite-aabb/releases/tag/v1.0.0
