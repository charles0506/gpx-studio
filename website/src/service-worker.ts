/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { base, build, files, prerendered, version } from '$service-worker';
import { formerTileUrl, MAX_TILE_ENTRIES, TILE_CACHE } from '$lib/offline-limits';

// A hiker loses signal long before they lose interest in the map, so two
// separate caches: the app itself, replaced wholesale on every deploy, and the
// map data, which is expensive to fetch and worth keeping across deploys.
const APP_CACHE = `app-${version}`;

// The ceiling lives in $lib so that the dialog planning a fetch and the worker
// trimming the cache cannot disagree about it. Browsers evict the whole origin
// when they run short of room, so this is about keeping the cache tidy rather
// than about respecting a hard quota.

// Hosts serving map data that is worth keeping offline. Everything here is
// immutable enough that a stale copy beats no copy at all.
const TILE_HOSTS = [
    'tiles.openfreemap.org',
    'tile.happyman.idv.tw',
    'gpx-studio2.pages.dev',
    'tiles.mapterhorn.com',
    'tile.openstreetmap.org',
    'a.tile.openstreetmap.org',
    'b.tile.openstreetmap.org',
    'c.tile.openstreetmap.org',
    'tile.opentopomap.org',
    'tile.waymarkedtrails.org',
    'tiles.openrailwaymap.org',
    'services.arcgisonline.com',
    'a.tile-cyclosm.openstreetmap.fr',
    'b.tile-cyclosm.openstreetmap.fr',
    'c.tile-cyclosm.openstreetmap.fr',
];

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_ASSETS = [...build, ...files, ...prerendered];

// What is worth fetching ahead of being asked for. Everything was, once: 1200
// files and 36 MB on every deploy, over whatever connection the phone had, for
// the pages of thirteen languages nobody here reads, the pictures in the guide
// and a 6 MB sitemap. Anything left out still works online, and is kept once it
// has been fetched.
function worthPrecaching(asset: string): boolean {
    const path = asset.replace(base, '');
    if (path.endsWith('.xml') || /\/immutable\/assets\/.*\.(png|jpe?g|webp|gif|avif|mp4)$/.test(path)) {
        return false;
    }
    if (prerendered.includes(asset)) {
        return (path === '/' || path.startsWith('/zh-TW')) && !path.includes('/help');
    }
    return true;
}

// Files named for their contents are the same file in every version, and most of
// them do not change from one deploy to the next. Copied across rather than
// fetched again.
async function precache(cache: Cache, asset: string) {
    try {
        const kept = asset.includes('/_app/immutable/') ? await caches.match(asset) : undefined;
        if (kept) {
            await cache.put(asset, kept);
        } else {
            await cache.add(asset);
        }
    } catch {
        // One bad asset should not fail the whole install.
    }
}

sw.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(APP_CACHE)
            .then(async (cache) => {
                const wanted = APP_ASSETS.filter(worthPrecaching);
                // A few at a time: a thousand requests at once is how a phone on
                // one bar of signal comes to fail all of them.
                let next = 0;
                const worker = async () => {
                    while (next < wanted.length) {
                        await precache(cache, wanted[next++]);
                    }
                };
                await Promise.all(Array.from({ length: 8 }, worker));
            })
            .then(() => sw.skipWaiting())
    );
});

sw.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                // The version before this one stays. A page opened from the
                // cache is still that version when this runs, partway through
                // loading its scripts, and those have gone from the server.
                Promise.all(
                    keys
                        .filter((key) => key !== APP_CACHE && key !== TILE_CACHE)
                        .slice(0, -1)
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => sw.clients.claim())
    );
});

// Listing the cache is itself expensive, so this runs once in a while rather
// than after every tile.
const TRIM_EVERY = 100;
let putsSinceTrim = 0;

async function trimTileCache(force = false) {
    if (!force && ++putsSinceTrim < TRIM_EVERY) {
        return;
    }
    putsSinceTrim = 0;

    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    // Forced means a put has just failed for want of room, so trimming to the
    // ceiling is not enough: take a tenth off it as well.
    const ceiling = force ? Math.floor(MAX_TILE_ENTRIES * 0.9) : MAX_TILE_ENTRIES;
    if (keys.length <= ceiling) {
        return;
    }
    // Cache.keys() returns insertion order, so the front of the list is oldest.
    await Promise.all(keys.slice(0, keys.length - ceiling).map((key) => cache.delete(key)));
}

/**
 * Storing a tile must never cost the tile. The cache fills up sooner or later
 * — twenty thousand of them is the better part of a gigabyte — and a put that
 * throws would take the whole handler down with it, which the browser reports
 * as a network error and the map as a tile that would not load. So: make room
 * and try once more, and if it still will not fit, the map keeps its tile.
 */
async function store(cache: Cache, request: Request, response: Response): Promise<void> {
    try {
        await cache.put(request, response.clone());
        void trimTileCache();
    } catch {
        await trimTileCache(true);
        try {
            await cache.put(request, response.clone());
        } catch {
            // Out of room even after trimming. Not worth the tile.
        }
    }
}

// Map data: serve the cached copy immediately when there is one, and only reach
// for the network otherwise. Tiles do not change often enough to justify paying
// the latency on every pan.
//
// A handler that rejects reaches the page as a network error, so this one does
// not: with no network and nothing cached there is nothing to show, and saying
// so quietly beats an exception for every tile on the screen.
async function handleTile(request: Request): Promise<Response> {
    let cache: Cache | undefined = undefined;
    try {
        cache = await caches.open(TILE_CACHE);
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
        const former = formerTileUrl(request.url);
        if (former) {
            const kept = await cache.match(former);
            if (kept) {
                return kept;
            }
        }
    } catch {
        // No cache to read from; the network is the only hope.
    }

    try {
        const response = await fetch(request);
        if (response.ok && cache) {
            await store(cache, request, response);
        }
        if (response.ok) {
            return response;
        }
        // This site's own address has a daily allowance, and past it every
        // tile is refused. The usual server can still be asked directly.
        const former = formerTileUrl(request.url);
        if (former) {
            const direct = await fetch(former).catch(() => undefined);
            if (direct?.ok) {
                if (cache) {
                    await store(cache, request, direct);
                }
                return direct;
            }
        }
        return response;
    } catch {
        return new Response('', { status: 504, statusText: 'offline' });
    }
}

// The page itself, as opposed to the things it loads.
//
// The cached copy first. Asking the network first meant that on one bar of
// signal, the page waited on the network before anything could start — every
// time, since a phone discards a page it is not looking at — only to be told
// what the cache already knew. A new version is noticed on the same visit, by
// the browser checking this worker, and is what the next visit opens.
//
// Scripts from the version opened this way can vanish from the server while it
// loads, if a deploy happened since: handleAppAsset looks for them in every
// cache, and activation leaves the previous version's in place.
//
// A page carrying a query is the same page, and the app reads the query from
// the address bar. It is not cached in its own right: every shared link would
// otherwise leave its own copy of the whole page behind.
async function handlePage(request: Request, url: URL): Promise<Response> {
    const cache = await caches.open(APP_CACHE);
    const ready = await cache.match(url.pathname);
    if (ready) {
        return ready;
    }
    try {
        const response = await fetch(request);
        if (response.ok && url.search === '') {
            try {
                await cache.put(request, response.clone());
            } catch {
                // Out of room. The response itself is still good.
            }
        }
        return response;
    } catch (error) {
        const cached =
            (await cache.match(request)) ??
            // Offline on a shared link: the page without its query is the same
            // page, and the app reads the query from the address bar anyway.
            (url.search === '' ? undefined : await cache.match(url.pathname));
        if (cached) {
            return cached;
        }
        throw error;
    }
}

// The app shell: the build output is content-hashed, so a hit is always current.
// Anything else is fetched first and falls back to the cache when offline.
async function handleAppAsset(request: Request, url: URL): Promise<Response> {
    const cache = await caches.open(APP_CACHE);
    const path = url.pathname;

    // Named for their contents, so a copy from any version is the right one.
    if (path.includes('/_app/immutable/')) {
        const kept = await caches.match(request);
        if (kept) {
            return kept;
        }
    }

    if (APP_ASSETS.includes(path) || APP_ASSETS.includes(path.replace(base, ''))) {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
    }

    try {
        const response = await fetch(request);
        if (response.ok && request.method === 'GET') {
            try {
                await cache.put(request, response.clone());
            } catch {
                // Out of room. The response itself is still good.
            }
        }
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
        throw error;
    }
}

sw.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);

    // This site's own hostname is in that list for the sake of a page served
    // from somewhere else — a development server — asking it for tiles. On
    // the site itself only the tiles are map data; the rest is the app.
    const ownTile = url.pathname.startsWith('/tiles/');
    if (
        url.origin === sw.location.origin
            ? ownTile
            : TILE_HOSTS.includes(url.hostname) &&
              (url.hostname !== 'gpx-studio2.pages.dev' || ownTile)
    ) {
        event.respondWith(handleTile(request));
        return;
    }

    if (url.origin === sw.location.origin) {
        // The Functions are live data: a cached forecast is wrong, a cached
        // workspace hands back what another device has already replaced, and
        // the radar's cache-buster would fill the cache with a fresh two
        // megabytes every ninety seconds, never to be evicted.
        if (url.pathname.startsWith('/api/')) {
            return;
        }
        if (request.mode === 'navigate') {
            event.respondWith(handlePage(request, url));
            return;
        }
        event.respondWith(handleAppAsset(request, url));
    }
});
