import { get } from 'svelte/store';

import { selection } from '$lib/logic/selection';
import { gpxStatistics } from '$lib/logic/statistics';
import { settings } from '$lib/logic/settings';
import { fetchTiles, missingTiles, planTiles } from '$lib/offline';
import { MAX_TILE_ENTRIES } from '$lib/offline-limits';

/**
 * Fetching the tiles for a route the moment it is picked, so that choosing the
 * route is the whole of the preparation.
 *
 * Held back by rather a lot, because the cost of getting this wrong is someone
 * else's tile server and your data allowance: it is off unless asked for, it
 * waits for the picking to settle, it does not fetch the same route twice, it
 * stands down when the browser is offline or the phone has asked for less data,
 * and picking another route abandons the one in flight.
 */

// Long enough for a few keystrokes through the file list to settle into one
// choice rather than four.
const SETTLE_MS = 1500;
// Beyond what the cache holds, a fetch would evict its own beginning. The
// dialog says so and lets you decide; unattended, it simply stands down.

let timer: ReturnType<typeof setTimeout> | undefined = undefined;
let controller: AbortController | undefined = undefined;

function zooms(): number[] {
    const [from, to] = get(settings.offlineZoomRange);
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

async function run() {
    if (!get(settings.offlineAutoDownload)) {
        return;
    }
    if (typeof navigator !== 'undefined') {
        if (navigator.onLine === false) {
            return;
        }
        // The phone is on a metered connection and has said so.
        if ((navigator as any).connection?.saveData) {
            return;
        }
    }

    const plan = planTiles(zooms());
    if (plan.urls.length === 0 || plan.urls.length > MAX_TILE_ENTRIES) {
        return;
    }

    // Whatever is already stored is not fetched again — which is most of it on
    // a route that has been picked before, and all of it on one that has been
    // picked and not changed since.
    const missing = await missingTiles(plan.urls);
    if (missing.length === 0) {
        return;
    }

    controller?.abort();
    controller = new AbortController();
    await fetchTiles(missing, () => {}, controller.signal);
}

function schedule() {
    if (!get(settings.offlineAutoDownload)) {
        return;
    }
    if (timer !== undefined) {
        clearTimeout(timer);
    }
    timer = setTimeout(run, SETTLE_MS);
}

// The statistics are what the plan is read from, and they arrive after the
// selection that caused them.
selection.subscribe(schedule);
gpxStatistics.subscribe(schedule);
