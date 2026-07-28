# @zakkster/lite-aabb

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-aabb.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-aabb)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Engine-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-aabb?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-aabb)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-aabb?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-aabb)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational?style=for-the-badge)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Zero-GC 2D axis-aligned bounding-box primitives.** Twelve operations on a flat `Float32Array(4)` — `[minX, minY, maxX, maxY]`. Every op that returns a box writes into a caller-provided `out` buffer. No `new` in your hot loop. No object graphs. ~120 lines of code.

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
// Initialize a "min bounds" reducer (a box that will be merged into).
const bounds = aabb2.create(Infinity, Infinity, -Infinity, -Infinity);
for (const point of points) {
    bounds[0] = Math.min(bounds[0], point.x);
    bounds[1] = Math.min(bounds[1], point.y);
    bounds[2] = Math.max(bounds[2], point.x);
    bounds[3] = Math.max(bounds[3], point.y);
}

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

The trade-off: `Float32Array` has ~7 decimal digits of precision. For world-space bounds at typical game-engine scales (a few thousand units), this is fine. If your scene spans millions of units (planetary terrain, geographic mapping), use `Float64Array` and pay the doubled memory cost — but you'll need to swap the type yourself in `Aabb.js`.

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
| `aabb2.overlapArea(a, b)` | `number` | Area of the intersection. `0` if they don't overlap. Touching edges produce `0`. |

### Predicates

| Function | Returns | Description |
|---|---|---|
| `aabb2.intersects(a, b)` | `boolean` | True if `a` and `b` overlap. **Touching edges count as overlap** (`>=` comparison). |
| `aabb2.contains(a, b)` | `boolean` | True if `a` fully contains `b`. Touching edges count as contained. |

---

## Aliasing rules

The `out` buffer can safely alias the input buffer in every function that takes both:

```js
// All of these are correct and produce the right result:
aabb2.merge(a, a, b);          // a ← merge(a, b)
aabb2.merge(b, a, b);          // b ← merge(a, b)
aabb2.fatten(a, a, 2);         // grow a in place
aabb2.copy(a, a);              // no-op
```

This works because every operation reads each input slot exactly once before writing the corresponding output slot. For four-element arrays this is trivially safe in any order.

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
npm test
# or: node --expose-gc Aabb.test.js
```

Runs 37 deterministic assertions covering:

| Group | What's tested |
|---|---|
| Construction + copy | defaults, explicit values, independence of clones, return-`out` contract |
| `merge` / `extend` | non-overlapping, overlapping, contained, negative coords, aliasing |
| `perimeter` / `area` | unit, rectangle, zero-size |
| `overlapArea` | identical, partial, disjoint, touching edges, containment |
| `intersects` / `contains` | overlap, touching, disjoint, axis-separated, self-containment, symmetry |
| `fatten` | positive/zero/negative margins, aliasing |
| **Zero-allocation guarantee** | 500 000 mixed ops → heap growth < 256 KB under `--expose-gc` |

The zero-alloc test requires the `--expose-gc` flag — without it the test is skipped (with a yellow warning) rather than failing, so CI runs without flags still go green.

A clean run ends with `37 passed, 0 failed` and exit code `0`. Any failure prints the assertion plus the expected/actual values.

---

## License

MIT © Zahary Shinikchiev
