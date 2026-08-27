import { get } from 'svelte/store';
import { toast } from 'svelte-sonner';
import { selection } from '$lib/logic/selection';
import { gpxStatistics } from '$lib/logic/statistics';
import { settings } from '$lib/logic/settings';
import { i18n } from '$lib/i18n.svelte';
import { fetchTiles, planTiles } from '$lib/offline';

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
const CACHE_LIMIT = 4000;

let timer: ReturnType<typeof setTimeout> | undefined = undefined;
let controller: AbortController | undefined = undefined;
let lastPlanned: string | undefined = undefined;

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
    if (plan.urls.length === 0 || plan.urls.length > CACHE_LIMIT) {
        return;
    }

    // Same route, same layers, same zooms: it is already in the cache, and the
    // service worker would serve every one of these from there anyway.
    const signature = `${plan.urls.length}|${plan.urls[0]}|${plan.urls[plan.urls.length - 1]}`;
    if (signature === lastPlanned) {
        return;
    }
    lastPlanned = signature;

    controller?.abort();
    controller = new AbortController();
    const mine = controller;

    const result = await fetchTiles(plan.urls, () => {}, mine.signal);
    if (mine.signal.aborted) {
        return;
    }
    toast.success(i18n._('offline.fetched').replace('{n}', String(result.done - result.failed)));
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
