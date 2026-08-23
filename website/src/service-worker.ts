/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { base, build, files, prerendered, version } from '$service-worker';

// A hiker loses signal long before they lose interest in the map, so two
// separate caches: the app itself, replaced wholesale on every deploy, and the
// map data, which is expensive to fetch and worth keeping across deploys.
const APP_CACHE = `app-${version}`;
const TILE_CACHE = 'map-data';

// Roughly a few hundred megabytes of tiles at typical sizes. Browsers evict the
// whole origin when they run short of room, so the cap is about keeping the
// cache tidy rather than about respecting a hard quota.
const MAX_TILE_ENTRIES = 4000;

// Hosts serving map data that is worth keeping offline. Everything here is
// immutable enough that a stale copy beats no copy at all.
const TILE_HOSTS = [
    'tiles.openfreemap.org',
    'tile.happyman.idv.tw',
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

sw.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(APP_CACHE)
            // One bad asset should not fail the whole install, so they are added
            // one by one rather than through addAll.
            .then((cache) =>
                Promise.all(
                    APP_ASSETS.map((asset) => cache.add(asset).catch(() => undefined))
                )
            )
            .then(() => sw.skipWaiting())
    );
});

sw.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== APP_CACHE && key !== TILE_CACHE)
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => sw.clients.claim())
    );
});

async function trimTileCache() {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length <= MAX_TILE_ENTRIES) {
        return;
    }
    // Cache.keys() returns insertion order, so the front of the list is oldest.
    await Promise.all(keys.slice(0, keys.length - MAX_TILE_ENTRIES).map((key) => cache.delete(key)));
}

// Map data: serve the cached copy immediately when there is one, and only reach
// for the network otherwise. Tiles do not change often enough to justify paying
// the latency on every pan.
async function handleTile(request: Request): Promise<Response> {
    const cache = await caches.open(TILE_CACHE);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }

    const response = await fetch(request);
    if (response.ok) {
        await cache.put(request, response.clone());
        void trimTileCache();
    }
    return response;
}

// The app shell: the build output is content-hashed, so a hit is always current.
// Anything else is fetched first and falls back to the cache when offline.
async function handleAppAsset(request: Request, url: URL): Promise<Response> {
    const cache = await caches.open(APP_CACHE);
    const path = url.pathname;

    if (APP_ASSETS.includes(path) || APP_ASSETS.includes(path.replace(base, ''))) {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
    }

    try {
        const response = await fetch(request);
        if (response.ok && request.method === 'GET') {
            await cache.put(request, response.clone());
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

    if (TILE_HOSTS.includes(url.hostname)) {
        event.respondWith(handleTile(request));
        return;
    }

    if (url.origin === sw.location.origin) {
        event.respondWith(handleAppAsset(request, url));
    }
});
