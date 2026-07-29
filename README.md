# @zakkster/lite-aabb

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-aabb.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-aabb)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Engine-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-aabb?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-aabb)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-aabb?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-aabb)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-aabb?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-aabb)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational?style=for-the-badge)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Zero-GC 2D axis-aligned bounding-box primitives.** Nineteen operations on a flat `Float32Array(4)` — `[minX, minY, maxX, maxY]`. Every op that returns a box writes into a caller-provided `out` buffer. No `new` in your hot loop. No object graphs. ~180 lines of code.

```js
import { aabb2 } from '@zakkster/lite-aabb';

// Allocate once at setup.
const playerBox = aabb2.create(0, 0, 32, 32);
const wall      = aabb2.create(40, 0, 48, 32);
const swept     = aabb2.create();      // scratch buffer for the hot path

// In the per-frame loop — zero allocations.
aabb2.set(playerBox, x, y, x + 32, y + 32);
aabb2.fatten(swept, playerBox, 4);        // proximity check radius

if (aabb2.intersects(swept, wall)) {
    // resolve collision...
}
```

---

## Contents

- [Why](#why) · [Install](#install) · [Quick start](#quick-start)
- [The flat-array convention](#the-flat-array-convention)
- [API reference](#api-reference)
- [Aliasing rules](#aliasing-rules)
- [Validity & degenerate values](#validity--degenerate-values)
- [Precision & the margin floor](#precision--the-margin-floor)
- [Compatibility with `@zakkster/lite-bvh`](#compatibility-with-zaksterlite-bvh)
- [Testing](#testing)
- [License](#license)

---

## Why

The first AABB API every JS dev writes looks like this:

```js
class AABB {
    constructor(minX, minY, maxX, maxY) { /* ... */ }
    intersects(other) { /* ... */ }
    union(other) { return new AABB(/* ... */); }
}
```

It's pleasant to use. And **at 10k bounding-box ops per frame, it allocates ~10k objects per frame**, every one of which gets handed to the garbage collector. Tilemap scrolling stutters. Particle systems hitch. Twitch extension overlays — which have a strict 60 fps budget and a 1 MB bundle cap — fail their cold-start review.

The fix isn't faster math; it's **no allocation at all**. Every operation here writes into a buffer you already own:

```js
// Per frame — every call is one indexed store loop. Zero allocations.
aabb2.set(out, x, y, x + w, y + h);
aabb2.fatten(out, out, margin);
const hit = aabb2.intersects(out, target);
```

Total cost: four `out[i] = …` writes per `set`, branchless `Math.min/max` for `merge`, four comparisons for `intersects`. That's it.

### What this is *not*

- **Not a collision resolver.** It tells you boxes touch; it doesn't compute MTV, contact points, or swept-AABB hits.
- **Not a spatial index.** For broadphase across many boxes, use [`@zakkster/lite-bvh`](https://www.npmjs.com/package/@zakkster/lite-bvh) — same flat-array format, plug-in compatible.
- **Not 3D.** This is `(minX, minY, maxX, maxY)`. A `lite-aabb3` would be a different package.

---

## Install

```bash
npm i @zakkster/lite-aabb
```

ESM only. Zero dependencies. Ships TypeScript definitions alongside the source.

```js
import { aabb2 } from '@zakkster/lite-aabb';
```

You can also drop `Aabb.js` into your project directly — it's one file with no imports.

---

## Quick start

```js
import { aabb2 } from '@zakkster/lite-aabb';

// ---- Setup phase: allocate everything you'll need ----
const box  = aabb2.create(0, 0, 10, 10);
const next = aabb2.create();                   // scratch for transformed bounds
const fat  = aabb2.create();                   // scratch for broadphase

// ---- Hot loop: zero allocations ----
function update(dx, dy) {
    aabb2.set(next, box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy);
    aabb2.fatten(fat, next, 1);                // 1-pixel slop for picking
    return aabb2.intersects(fat, worldBox);
}
```

### Common idioms

```js
// Initialize a "min bounds" reducer with the canonical empty box — it is the
// identity of merge/extend, so the first box merged in lands exactly.
const bounds = aabb2.setEmpty(aabb2.create());
for (const box of boxes) {
    aabb2.extend(bounds, box);
}
// Guard the result before trusting its geometry (e.g. before perimeter/area).
if (!aabb2.isValid(bounds)) { /* no boxes, or a NaN slipped in */ }

// Union N boxes into one (in-place reduction).
aabb2.copy(out, boxes[0]);
for (let i = 1; i < boxes.length; i++) {
    aabb2.extend(out, boxes[i]);
}

// Sweep test (cheap approximation of swept-AABB).
aabb2.merge(swept, prevPosBox, nextPosBox);
const candidates = bvh.query(swept, hitBuffer);
```

---

## The flat-array convention

An AABB is just a `Float32Array` of length 4 — no class wrapper, no prototype:

```
index:   0       1       2       3
value:   minX    minY    maxX    maxY
```

This format is chosen on purpose:

| Property | Why it matters |
|---|---|
| **Plain `Float32Array`** | V8 stores typed-array data off-heap; reads compile to a single load instruction. No hidden classes, no megamorphic property access. |
| **Contiguous layout** | Modern CPUs prefetch consecutive 16-byte chunks for free. Reading `min` and `max` is one cache line. |
| **No method lookup** | Module-level functions inline cleanly in V8/JSC's TurboFan. Class methods through `this` add an extra indirection. |
| **`Transferable`-safe** | An AABB can be sent through `postMessage` to a Worker by transferring its `.buffer`. |
| **Compatible with WebGL / WebGPU** | The same `Float32Array` can be fed directly to a uniform or storage buffer if you're packing bounds for the GPU. |

### `Float32` is not free

The trade-off: `Float32Array` has ~7 decimal digits of precision. For world-space bounds at typical game-engine scales (a few thousand units), this is fine. Past ~1e7 it stops being a free trade-off and starts eating your `fatten` margins — see [Precision & the margin floor](#precision--the-margin-floor), and use `marginFloor` to detect it. If your scene spans millions of units (planetary terrain, geographic mapping) and you need the range, note that every op except `create`/`clone` is element-type-agnostic — pass your own `Float64Array(4)` as the `out` buffer and pay the doubled memory cost. The floor still exists there, just out near ~1e15.

---

## API reference

All functions are static (no `this`), live on the `aabb2` namespace, and return `out` for chaining.

### Allocation — **don't call in a hot loop**

| Function | Returns | Description |
|---|---|---|
| `aabb2.create(minX?, minY?, maxX?, maxY?)` | `Float32Array(4)` | Allocates a new AABB. Defaults are zero. |
| `aabb2.clone(a)` | `Float32Array(4)` | Allocates a copy of `a`. |

### Assignment — zero allocation

| Function | Returns | Description |
|---|---|---|
| `aabb2.copy(out, a)` | `out` | `out ← a`. |
| `aabb2.set(out, minX, minY, maxX, maxY)` | `out` | Writes explicit bounds. |

### Composition — zero allocation

| Function | Returns | Description |
|---|---|---|
| `aabb2.merge(out, a, b)` | `out` | `out ← bounding box enclosing both a and b`. Safe when `out` aliases `a` or `b`. |
| `aabb2.extend(out, b)` | `out` | Enlarges `out` in place to include `b`. Equivalent to `merge(out, out, b)` with one fewer indirection. |
| `aabb2.fatten(out, a, margin)` | `out` | Expands `a` by `margin` on every side and writes into `out`. Negative margins shrink. Safe when `out === a`. |

### Measurement

| Function | Returns | Description |
|---|---|---|
| `aabb2.perimeter(a)` | `number` | `2 * (width + height)`. The Surface Area Heuristic cost in 2D BVHs. |
| `aabb2.area(a)` | `number` | `width * height`. |
| `aabb2.overlapArea(a, b)` | `number` | Area of the intersection. `0` if they don't overlap; touching edges produce `0`. Returns `NaN` if either box carries a `NaN` coordinate (v1.1.0+ — see [validity](#validity--degenerate-values)). |
| `aabb2.distanceSq(a, b)` | `number` | Squared Euclidean distance between the boxes. `0` if they overlap **or** touch; the true squared gap when disjoint. Symmetric; take one `Math.sqrt` if you need the metric. `NaN` propagates (v1.3.0+). |
| `aabb2.marginFloor(a)` | `number` | The smallest `fatten` margin that provably widens `a` at its coordinates — the float32 ULP of its largest-magnitude coordinate (v1.2.0+ — see [precision](#precision--the-margin-floor)). |

### Predicates

| Function | Returns | Description |
|---|---|---|
| `aabb2.intersects(a, b)` | `boolean` | True if `a` and `b` overlap. **Touching edges count as overlap** (`>=` comparison). |
| `aabb2.contains(a, b)` | `boolean` | True if `a` fully contains `b`. Touching edges count as contained. |
| `aabb2.containsPoint(a, px, py)` | `boolean` | True if the point `(px, py)` is in `a`, edges and corners included. Same as `contains(a, [px,py,px,py])`. Fails closed on `NaN` (v1.3.0+). |

### Validity & empties — zero allocation *(v1.1.0+)*

| Function | Returns | Description |
|---|---|---|
| `aabb2.isValid(a)` | `boolean` | True iff all four coordinates are finite **and** `min <= max` on both axes. The boundary check — false for NaN, mixed infinities, and inverted boxes; true for zero-size boxes. |
| `aabb2.isEmpty(a)` | `boolean` | True iff `a` is exactly the canonical empty sentinel `[Inf, Inf, -Inf, -Inf]`. |
| `aabb2.setEmpty(out)` | `out` | Writes the canonical empty box — the correct seed for a `merge`/`extend` reduction. |

### Closest point — zero allocation *(v1.3.0+)*

| Function | Returns | Description |
|---|---|---|
| `aabb2.closestPoint(out2, a, px, py)` | `out2` | The closest point on box `a` to `(px, py)`: the point itself when inside, the nearest edge or corner when outside. Idempotent. Writes into `out2`. |

> ⚠️ **`out2` is a LENGTH-2 buffer, not a length-4 AABB.** It is the only length-2 buffer in this package — a `Vec2` `[x, y]`. Allocate it as `new Float32Array(2)` (once, at setup). Passing a length-4 box here, or handing this length-2 result to a box op, will read or write the wrong slots **without throwing**. The parameter is named `out2` to flag the arity at every call site. It may safely alias `a` under any view (the bounds are snapshotted before the first write).

```js
const hit = new Float32Array(2);            // a Vec2, allocated once
aabb2.closestPoint(hit, box, mouseX, mouseY);
// distance from the cursor to the box, for a hover radius:
const dx = mouseX - hit[0], dy = mouseY - hit[1];
if (dx * dx + dy * dy <= r * r) { /* within r of the box */ }
```

---

## Aliasing rules

The `out` buffer can safely alias **any** input, under **any** view relationship — the identical view, a shifted or partially-overlapping `subarray` of one backing buffer, or a distinct buffer:

```js
// All correct and produce the right result:
aabb2.merge(a, a, b);          // a ← merge(a, b)   (out === a)
aabb2.merge(b, a, b);          // b ← merge(a, b)   (out === b)
aabb2.fatten(a, a, 2);         // grow a in place
aabb2.copy(a, a);              // no-op

// Also correct: out and a are OVERLAPPING views of one buffer.
const packed = new Float32Array(4 * n);        // n boxes, tightly packed
const a   = packed.subarray(0, 4);
const out = packed.subarray(1, 5);             // shifted by 1 — overlaps a
aabb2.merge(out, a, b);                        // right result, no corruption
```

This holds because every writer (`copy`, `merge`, `extend`, `fatten`) **snapshots all of its array inputs into locals before the first write to `out`** — so a write can never clobber a slot a later read still needs. The locals are register-resident in V8: the guarantee costs no allocation and no measurable time on the hot path (the A/B benchmark is recorded in `decisions/0001-aliasing.md` in the [source repository](https://github.com/PeshoVurtoleta/lite-aabb)).

> **Before v1.0.2** this was true only for the *identical* view or disjoint buffers; shifted/overlapping views silently corrupted the result (finding A-07). If you are on ≤ 1.0.1, upgrade — the packed-buffer pattern above was broken.

---

## Validity & degenerate values

*(v1.1.0+)* The geometry ops are **total and branchless** — they never throw and never validate. That keeps the hot path fast, but it means a broken box (a `NaN`, an infinity, an inverted `min > max`) produces a nonsense number rather than an error. The rule the library follows, and the rule you apply at your own trust boundaries:

**NaN propagates — it is never laundered.** A `NaN` coordinate yields `NaN` from every numeric op, `overlapArea` included (it used to launder `NaN` to `0`; that was the incoherence fixed in v1.1.0). Every box is one of three states:

| State | Test | Meaning |
|---|---|---|
| **Valid** | `isValid(a) === true` | Four finite coordinates, `min <= max`. Safe to do geometry with. |
| **Empty** | `isEmpty(a) === true` | The canonical sentinel `[Inf, Inf, -Inf, -Inf]` — the identity of `merge`/`extend`. Build it with `setEmpty`. |
| **Garbage** | both `false` | NaN, mixed infinities, or inverted. The caller's bug. |

```js
// Build a reducer seed, accumulate, then verify before trusting the result.
const bounds = aabb2.setEmpty(aabb2.create());
for (const b of boxes) aabb2.extend(bounds, b);

if (aabb2.isValid(bounds)) {
    const cost = aabb2.perimeter(bounds);   // safe: bounds is a real box
} else {
    // boxes was empty (still the sentinel), or one carried a NaN.
}
```

Two deliberate consequences worth knowing:

- **The empty sentinel is not `isValid`.** It is non-finite by construction, and its `perimeter`/`area` are `-Infinity`/`+Infinity`. `isValid` answers "safe to do geometry"; for the sentinel that is *no*. Use `isEmpty` to recognize it. Do not feed a never-merged sentinel to `perimeter` (e.g. as a BVH cost) without checking first — [`@zakkster/lite-bvh`](https://www.npmjs.com/package/@zakkster/lite-bvh) quarantines it for exactly this reason.
- **Inverted boxes are the caller's bug.** Negative margins are permitted (`fatten(out, a, -m)` shrinks), but shrinking past zero gives `min > max`, whose `area` is *positive* and which does *not* intersect itself. The library does not stop you; `isValid` is how you detect it.

The full law and the (zero) measured hot-path cost are in `decisions/0002-degenerate-values.md` in the [source repository](https://github.com/PeshoVurtoleta/lite-aabb).

---

## Precision & the margin floor

*(v1.2.0+)* `Float32` stores values with a coordinate-dependent step (its ULP). Once a `fatten` margin drops below that step, it rounds away and the box **does not widen** — silently, because `contains` still returns `true`:

```js
const a = aabb2.create(1e7, 1e7, 1e7 + 1, 1e7 + 1);
aabb2.fatten(a, a, 0.5);   // at 1e7 the ULP is 1.0, so 0.5 vanishes
// a is UNCHANGED — and aabb2.contains(a, a) is still true. Nothing warns you.
```

This bites hardest downstream: a BVH's fat bounds equal its tight bounds, and every motion update takes the slow path forever. `fatten` is deliberately **left alone** — it never branches or bumps its result, so it stays byte-for-byte the fast function it always was, and no existing behaviour changes. Instead the library gives you the *detector*, and you clamp:

```js
const floor = aabb2.marginFloor(a);                        // 1.0 at coordinate 1e7
aabb2.fatten(out, a, Math.max(desiredMargin, floor));      // guaranteed to widen
```

`marginFloor(a)` returns the smallest margin that provably widens `a` on **all four sides** — the ULP of the largest-magnitude coordinate (the upper ULP, since the growing max sides need the coarser of the two steps). It's the same shape as `isValid`: a boundary check you opt into, never a cost inside the hot op. It fails closed — a `NaN` coordinate yields `NaN`, an infinite one yields `Infinity`.

| coordinate scale | ULP (`marginFloor`) | a margin of 0.5 … |
|---|---|---|
| ~1e3 | 6.1e-5 | widens |
| ~1e6 | 0.0625 | widens |
| **~1e7** | **1.0** | **evaporates** |
| **~2²⁴** | **2.0** | **evaporates** |

Need a larger honest range? Every op except `create`/`clone` is element-type-agnostic — pass your own `Float64Array(4)` as `out` and the floor moves out to ~1e15 (it never disappears; that's the nature of finite floats). The decision, the measured evaporation table, and the proof that all fifteen prior hot bodies are unchanged are in `decisions/0003-precision.md` in the [source repository](https://github.com/PeshoVurtoleta/lite-aabb).

---

## Compatibility with `@zakkster/lite-bvh`

[`@zakkster/lite-bvh`](https://www.npmjs.com/package/@zakkster/lite-bvh) uses the **same `Float32Array(4)` AABB format** as the leaf input to `insertLeaf` / `updateLeaf` / `query`:

```js
import { aabb2 } from '@zakkster/lite-aabb';
import { DynamicBVH2D } from '@zakkster/lite-bvh';

const tree = new DynamicBVH2D(4096);
const tight = aabb2.create();
const fat   = aabb2.create();

// Insert entities with a fattening margin baked in.
aabb2.set(tight, x, y, x + w, y + h);
aabb2.fatten(fat, tight, 4);
const nodeId = tree.insertLeaf(fat, entityId);

// Move an entity. The BVH internally checks if the tight bounds still fit
// inside the fat bounds and only restructures the tree if they don't.
aabb2.set(tight, newX, newY, newX + w, newY + h);
tree.updateLeaf(nodeId, tight, 4);

// Query a viewport rectangle.
aabb2.set(fat, viewX, viewY, viewX + viewW, viewY + viewH);
const hits = tree.query(fat, hitBuffer);
```

There is **no runtime dependency** between the two packages — they just agree on the buffer format. Use either one alone or both together.

---

## Testing

```bash
npm test          # node --test (unit suite)
npm run torture   # node --expose-gc test/torture.mjs -> prints "ok"
npm run verify    # both, in sequence
```

The `node:test` unit suite covers:

| Group | What's tested |
|---|---|
| Construction + copy | defaults, explicit values, independence of clones, return-`out` contract |
| `merge` / `extend` | non-overlapping, overlapping, contained, negative coords, aliasing |
| `perimeter` / `area` | unit, rectangle, zero-size |
| `overlapArea` | identical, partial, disjoint, touching edges, containment, NaN propagation |
| `intersects` / `contains` | overlap, touching, disjoint, axis-separated, self-containment, symmetry |
| `fatten` | positive/zero/negative margins, aliasing |
| **Aliasing & contract** | frozen namespace, touching-edge triad, f32 boundary, shifted-view (A-07) |
| **Degenerate-value law** | `isValid`/`isEmpty`/`setEmpty` tri-state, empty as merge identity, NaN propagation, inverted-box detection |
| **Precision / margin floor** | exact `marginFloor` ULP values, the A-01 evaporation boundary, the clamp idiom, fail-closed edges |
| **2D op set** | `containsPoint` edges/agreement-with-`contains`, `distanceSq` touching/disjoint/symmetry, `closestPoint` clamp/idempotence/`out2` aliasing, degenerate-law compliance |
| **Zero-allocation guarantee** | mixed ops → heap growth budget under `--expose-gc`, plus per-op `measureAllocs` |

The zero-alloc tests require the `--expose-gc` flag — without it they skip (rather than fail), so CI runs without flags still go green. `npm test` sets the flag for you.

The authoritative zero-GC proof is the **torture gate** (`test/torture.mjs`): metamorphic laws (including the margin-floor law), the complete degenerate-value matrix, the aliasing matrix, a `maxMajor: 0` GC budget, a soak, and controls that prove every gate can fail. It prints exactly `ok` and exits `0` on pass; `TORTURE_CONTROL=alloc` makes it exit non-zero on demand.

---

## License

MIT © Zahary Shinikchiev
