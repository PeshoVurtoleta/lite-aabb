# 0005 -- the FORMAT contract + packed batch ops

- Status: accepted
- Date: 2026-07-30
- Session: X1-A (lite-aabb v2.0.0), the lite-aabb half of the twin 2.0.0
- Findings: A-07, A-01, B-11 (all pre-settled; this session consumes them, it
  does not re-fix them)
- Depends on: 0001 (aliasing / HARDEN), 0002 (degenerate-value law),
  0003 (precision / marginFloor), 0004 (2D op set)
- Blocks: X1-B (the lite-bvh half: `insertLeaves` + the cross-package round-trip
  conformance test)

## Context

Through v1.3.0 lite-aabb is nineteen single-box ops on a flat `Float32Array(4)`.
Two facts were left informal:

1. The `Float32Array(4)`, `[minX, minY, maxX, maxY]` layout is a **shared
   contract** with `@zakkster/lite-bvh` -- load-bearing in both packages -- but
   it lived only in prose scattered across two READMEs. Nothing versioned it and
   nothing asserted it.
2. Callers feeding a broadphase hand-roll the same loop: fatten N boxes, or union
   N boxes, or find the first of N that hits a probe. Each iteration indexes a
   packed `4*N` buffer by hand. That packed buffer is exactly the shifted-view
   shape A-07 corrupted before 0001 hardened the writers.

X1 formalizes both at once. Because the packed convention is a new buffer shape
that both packages and every caller must understand, and because formalizing the
shared format is a cross-package contract commitment, both packages take a major
bump together. This file records the lite-aabb half.

## Decisions

### D1 -- `FORMAT_VERSION = 1`, integer, top-level named export

A **contract** version, deliberately independent of the package's semver. Both
packages export the same symbol and compare it for equality to detect a format
skew (e.g. a future length-6 layout would bump it to `2`). It is:

- an **integer** (`1`), not a semver string -- it is compared for equality, not
  ordered;
- a **top-level** `export const FORMAT_VERSION = 1;` beside `VERSION` and
  `aabb2` -- one source of truth, not also mirrored inside the frozen namespace
  (two copies would drift);
- **not** synced to the 1.3.0 -> 2.0.0 semver bump. The package is at 2.0.0; the
  FORMAT contract is at version 1. These are different axes and the release
  checklist treats them separately.

lite-bvh exports a byte-identical `FORMAT_VERSION = 1` in X1-B; the round-trip
conformance test asserts the two are equal.

### D2 -- `FORMAT.md` ships in the npm tarball

The contract needs a durable home that a consumer can read. `FORMAT.md` carries:
element type, the length-4 layout and index meaning, the A-02 touching-edge triad
(inclusive `intersects`/`contains`, zero-area `overlapArea`), the A1 HARDEN
aliasing rule, the packed `4*N` stride/bounds rules (including the aliasing
restriction in D4), the A3 margin floor, and the `FORMAT_VERSION` constant.

Unlike `decisions/` (repo-only, excluded from the tarball), `FORMAT.md` is
consumer-facing and referenced from `llms.txt`, so it is added to
`package.json` `files[]`. The tarball goes from 7 files to 8; `npm pack
--dry-run` proves `test/` and `decisions/` still do not leak.

### D3 -- packed op semantics

Three ops, appended to the frozen `aabb2` namespace (19 -> 22 ops). Each writes
into caller buffers, is bounded by `count`, and allocates nothing.

- **`fattenAll(outPacked, inPacked, margin, count) -> outPacked`** -- box `i`
  fattened by `margin` into box `i` of `outPacked`. Mirrors single `fatten`
  EXACTLY: subtract `margin` from the mins, add to the maxes, no auto-clamp. The
  margin floor (A3) stays the caller's job -- a batch op does not silently apply
  a per-box policy the single op does not. `count` bounds the loop.

- **`mergeAll(out4, inPacked, count) -> out4`** -- the union of N boxes into one
  length-4 box. Accumulates min/max in four register locals across the whole
  scan and writes `out4` ONCE at the end (this single-write shape is what makes
  `out4` alias-safe against `inPacked`, D4). Seeded with the canonical empty
  sentinel `[Inf, Inf, -Inf, -Inf]` -- the merge identity -- so:
  - `count === 0` yields the **empty box** with no special-case branch. The
    union of zero boxes is the empty set's bounding box, which is exactly the
    identity. Fail-closed and composable: `isEmpty(mergeAll(o, p, 0)) === true`.

- **`intersectsAny(inPacked, b, count) -> index | -1`** -- the lowest index `i`
  in `[0, count)` whose box intersects `b` (the A-02 touching convention, the
  same test as `intersects`), or `-1` if none do. Read-only; no writes.
  `count === 0` yields `-1` (fail closed -- nothing hit because nothing was
  scanned).

Fail-closed `count`: every loop bound is `i < count`, so a `count` of `0`,
negative, or `NaN` runs zero iterations (`0 < NaN` is `false`). No guard needed.

### D4 -- the packed aliasing contract (extends the T2 matrix)

The single-box HARDEN (0001) snapshots a box's four slots before writing. For
packed ops the hazard is different: a WRITE to box `i` can clobber box `i+1`'s
INPUT under forward iteration. Per-box snapshotting fixes the same-box slots but
cannot fix a cross-box clobber. So the contract is decided per op:

- **`mergeAll`**: `out4` may alias ANYWHERE in `inPacked`. All reads happen
  before the single terminal write, so nothing is clobbered. Safe, no
  restriction.
- **`intersectsAny`**: read-only. `b` may even be a view into `inPacked`. Safe,
  no restriction.
- **`fattenAll`**: two aliasing relationships are SAFE and one is FORBIDDEN:
  - `outPacked === inPacked` (identical base and offset, in-place): SAFE. Each
    box's read region is its own write region; neighbours are untouched. This is
    the important case -- in-place batch fatten.
  - `outPacked` fully DISJOINT from `inPacked`: SAFE.
  - `outPacked` a SHIFTED / partially-overlapping view of `inPacked` (offset by
    1..3 floats): **FORBIDDEN**. Writing box `i` lands in slots that box `i+1`
    (or `i-1`) still needs as input, and no per-box snapshot can prevent that
    under a single iteration direction. Making it safe would require choosing
    iteration direction from the sign of the overlap -- a branch in a hot batch
    loop, for a buffer shape the packed contract never produces. Rejected.

  This restriction is documented in `FORMAT.md` and `Aabb.d.ts`, and T2 asserts
  the two safe `fattenAll` rows pass (in-place and disjoint) while naming the
  shifted row as out-of-contract.

Note the asymmetry from the single-box ops: there, EVERY shifted view is safe
(0001). Here, only `mergeAll`/`intersectsAny` inherit that; `fattenAll`'s
element-wise write makes shifted overlap a genuinely different, unsupported case.
This is called out because a caller who internalized "out may always alias in
lite-aabb" would otherwise assume `fattenAll` shares the property.

### D5 -- 2.0.0 is a coordination major, not a runtime break

Nothing in lite-aabb's v1 surface changes behaviour. All nineteen single-box
bodies are byte-for-byte identical (git diff = the `VERSION` string plus the new
`FORMAT_VERSION` export and the three appended ops). The full v1 test suite is
green unchanged.

The major is reserved for the **cross-package FORMAT contract** and the new
packed `4*N` buffer convention, bumped in lockstep with lite-bvh so the two
packages advertise the same contract version at the same semver. The CHANGELOG
`[2.0.0]` entry states this explicitly under a Breaking heading: the break is a
*contract* commitment (a versioned format both packages now promise to honour),
not an API signature or behaviour change. A pure-v1 consumer upgrading 1.3.0 ->
2.0.0 sees no behavioural difference.

### D6 -- no bounds guard in the hot batch loop

Consistent with every existing op, which trusts the caller's `Float32Array(4)`
and never validates length: the packed ops trust `inPacked.length >= 4*count`
and `outPacked.length >= 4*count`, stated in `FORMAT.md` as the caller's
contract. An out-of-range read on a too-short typed array yields `undefined ->
NaN`, which PROPAGATES (never a silently-wrong finite answer) -- the same
fail-forward shape as the degenerate-value law. This keeps the batch body
branch-free.

## Consequences

- `aabb2` grows from 19 to 22 ops; a new top-level `FORMAT_VERSION` export; a new
  shipped `FORMAT.md`; `Packed` type alias in `Aabb.d.ts`.
- Torture: T0 gains fold-equality laws (`mergeAll` == left-fold of `merge` from
  `setEmpty`; `fattenAll[i]` == single `fatten`; `intersectsAny` == first-hit
  scan; the count=0 identities). T1 gains a packed degenerate sub-matrix. T2
  gains the packed aliasing rows of D4. T6 adds the three ops to the hot loop
  (ten -> thirteen). T8 (still a placeholder for the bvh round-trip) gains the
  aabb-side layout-constant and `FORMAT_VERSION` assertions. T9 gains a control
  proving a batch law is falsifiable.
- X1-B (lite-bvh) consumes this: it exports the same `FORMAT_VERSION`, adds
  `insertLeaves(packed, data, count)` walking the same buffer, and hosts the
  cross-package round-trip conformance test that this session's T8 stubs out on
  the aabb side.

## Rejected

- **Making shifted `fattenAll` safe** (see D4). Direction-aware iteration is a
  hot-loop branch for a buffer shape the contract never needs. Forbid instead.
- **`FORMAT_VERSION` as a semver string, or synced to 2.0.0.** It is an
  equality-compared contract id on a separate axis; coupling it to package semver
  would force a format "change" on every unrelated minor.
- **Bounds-checking `count` against buffer length in the hot loop** (D6). A
  branch the rest of the package does not pay; NaN propagation already fails
  forward.
- **Per-box `subarray` inside the batch loop.** That is an allocation per box and
  the exact thing these ops exist to avoid -- it would fail the T6 gate.
