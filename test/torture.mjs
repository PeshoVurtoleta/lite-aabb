/**
 * @zakkster/lite-aabb -- torture gate.
 *
 * The suite DONE-WHEN is a single command:
 *
 *     node --expose-gc test/torture.mjs        -> prints "ok", exit 0
 *
 * Ten tiers share one shape across the lite-aabb / lite-bvh packages (section 3
 * of the roadmap). This is A0: the skeleton. Wired now --
 *
 *     T0  metamorphic laws
 *     T1  degenerate values (answers pinned as they are TODAY, bugs included)
 *     T6  zero-alloc GC budget (maxMajor:0 / maxPauseMs:4)
 *     T7  soak + conservation (4096 build/teardown cycles)
 *     T9  controls -- every gate has a broken variant that must exit non-zero
 *
 * Registered but empty, filled by later sessions --
 *
 *     T2  aliasing matrix        (A1: A-07)
 *     T5  differential fuzz      (later)
 *     T8  cross-package          (with lite-bvh)
 *
 * Tiers run STRICTLY SEQUENTIALLY: lite-gc-profiler allows one measurement at a
 * time and throws "already in flight" on nesting. Never run two tiers at once.
 *
 * The gate can fail -- and is proven to. T9 self-checks the deterministic gates
 * every run; the GC gate is falsifiable on demand:
 *
 *     TORTURE_CONTROL=alloc node --expose-gc test/torture.mjs   -> exit 1
 *
 * Replay any failure with its printed seed:
 *
 *     TORTURE_SEED=<seed> node --expose-gc test/torture.mjs
 *
 * Peers (lite-gc-profiler, lite-leak) are devDependencies, never runtime deps:
 * Aabb.js has zero deps.
 *
 * @license MIT
 */

import * as h from './torture/harness.mjs';
import * as t0 from './torture/t0-laws.mjs';
import * as t1 from './torture/t1-degenerate.mjs';
import * as t2 from './torture/t2-aliasing.mjs';
import * as t5 from './torture/t5-fuzz.mjs';
import * as t6 from './torture/t6-alloc.mjs';
import * as t7 from './torture/t7-soak.mjs';
import * as t8 from './torture/t8-cross.mjs';
import * as t9 from './torture/t9-controls.mjs';

// Numeric tier order. Empty placeholders are listed so the sequence is fixed
// and a later session only has to fill a body, never touch this file.
const TIERS = [
    ['T0-laws', t0.run],
    ['T1-degenerate', t1.run],
    ['T2-aliasing', t2.run],
    ['T5-fuzz', t5.run],
    ['T6-alloc', t6.run],
    ['T7-soak', t7.run],
    ['T8-cross', t8.run],
    ['T9-controls', t9.run],
];

async function main() {
    for (let i = 0; i < TIERS.length; i++) {
        const name = TIERS[i][0];
        const run = TIERS[i][1];
        try {
            await run(h); // throws (or rejects) on failure.
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            process.stderr.write((msg.startsWith('torture:') ? msg : 'torture: FAIL [' + name + '] ' + msg) + '\n');
            process.exit(1);
        }
    }
    // stdout stays EXACTLY "ok" on pass -- nothing else writes to it.
    process.stdout.write('ok\n');
    process.exit(0);
}

main();
