import { get, writable } from 'svelte/store';
import { map } from '$lib/components/map/map';
import { gpxStatistics } from '$lib/logic/statistics';
import { TILE_CACHE } from '$lib/offline-limits';

/**
 * Tiles are cached as they are fetched, one file per zoom level, so a route
 * looked at from far away is offline only from far away: zoom in on the hill
 * and the contour lines are in tiles that were never asked for. This walks the
 * route and asks for them in advance.
 */

export type TilePlan = {
    urls: string[];
    /** Rough, at the 25 kB a raster tile of a topographic map tends to weigh. */
    megabytes: number;
};

const TILE_BYTES = 25 * 1024;

function tileX(lon: number, zoom: number): number {
    return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function tileY(lat: number, zoom: number): number {
    const radians = (lat * Math.PI) / 180;
    return Math.floor(
        ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
            Math.pow(2, zoom)
    );
}

/**
 * The raster tile templates the map is drawing with right now — the basemap,
 * whatever overlays are switched on, and the elevation tiles the terrain and
 * the climb figures are read from. Vector sources are left alone: they are one
 * file for the world and the browser has it already.
 */
export function activeTemplates(): string[] {
    const instance = get(map);
    if (!instance) {
        return [];
    }
    const templates: string[] = [];
    const sources = instance.getStyle()?.sources ?? {};
    for (const source of Object.values(sources) as any[]) {
        if ((source?.type === 'raster' || source?.type === 'raster-dem') && source.tiles) {
            templates.push(...source.tiles);
        }
    }
    return templates;
}

/**
 * Every tile the route passes through, plus a ring around each one so that the
 * map has something to show either side of the line rather than a corridor
 * exactly one tile wide.
 */
export function planTiles(zooms: number[], templates = activeTemplates()): TilePlan {
    const statistics = get(gpxStatistics);
    if (!statistics?.forEachTrackPoint || templates.length === 0) {
        return { urls: [], megabytes: 0 };
    }

    const wanted = new Set<string>();
    for (const zoom of zooms) {
        const scale = Math.pow(2, zoom);
        statistics.forEachTrackPoint((point) => {
            const coordinates = point.getCoordinates();
            const x = tileX(coordinates.lon, zoom);
            const y = tileY(coordinates.lat, zoom);
            for (let dx = -1; dx <= 1; dx += 1) {
                for (let dy = -1; dy <= 1; dy += 1) {
                    const tx = x + dx;
                    const ty = y + dy;
                    if (tx < 0 || ty < 0 || tx >= scale || ty >= scale) {
                        continue;
                    }
                    wanted.add(`${zoom}/${tx}/${ty}`);
                }
            }
        });
    }

    const urls: string[] = [];
    for (const key of wanted) {
        const [z, x, y] = key.split('/');
        for (const template of templates) {
            urls.push(
                template
                    .replace('{z}', z)
                    .replace('{x}', x)
                    .replace('{y}', y)
                    .replace('{ratio}', '')
                    .replace('{s}', 'a')
            );
        }
    }

    return { urls, megabytes: (urls.length * TILE_BYTES) / (1024 * 1024) };
}

/**
 * The ones not already stored. Asking the cache is better than remembering
 * what was fetched: it survives a reload, it knows about tiles the map itself
 * happened to draw, and it is the same question the worker will ask when the
 * request goes out anyway.
 */
export async function missingTiles(urls: string[]): Promise<string[]> {
    if (typeof caches === 'undefined') {
        return urls;
    }
    try {
        const cache = await caches.open(TILE_CACHE);
        const missing: string[] = [];
        for (const url of urls) {
            if (!(await cache.match(url))) {
                missing.push(url);
            }
        }
        return missing;
    } catch {
        // No cache to consult is the same as nothing being in it.
        return urls;
    }
}

export type Progress = { done: number; total: number; failed: number };

/**
 * What is being fetched right now, wherever it was started from, so that one
 * place on the screen can say so. Cleared a moment after it finishes: a bar
 * that stays at 100% is a bar nobody reads again.
 */
export const tileProgress = writable<Progress | undefined>(undefined);
const LINGER_MS = 4000;
let clearTimer: ReturnType<typeof setTimeout> | undefined = undefined;

/**
 * Ask for them all. Nothing is stored here: the service worker is already
 * watching these hosts and files them as they arrive, which is the same path a
 * tile takes when the map draws it, so nothing can be cached in a form the map
 * will not find later.
 */
export async function fetchTiles(
    urls: string[],
    onProgress: (progress: Progress) => void,
    signal?: AbortSignal
): Promise<Progress> {
    const progress: Progress = { done: 0, total: urls.length, failed: 0 };
    if (clearTimer !== undefined) {
        clearTimeout(clearTimer);
    }
    tileProgress.set({ ...progress });
    // Enough to keep the connection busy, few enough to leave the tile server
    // able to serve anyone else.
    const WORKERS = 6;
    let next = 0;

    const worker = async () => {
        while (next < urls.length) {
            if (signal?.aborted) {
                return;
            }
            const url = urls[next++];
            try {
                const response = await fetch(url, { signal });
                if (!response.ok) {
                    progress.failed += 1;
                }
            } catch (error) {
                if (signal?.aborted) {
                    return;
                }
                progress.failed += 1;
            }
            progress.done += 1;
            tileProgress.set({ ...progress });
            onProgress({ ...progress });
        }
    };

    await Promise.all(Array.from({ length: WORKERS }, worker));
    clearTimer = setTimeout(() => tileProgress.set(undefined), LINGER_MS);
    return progress;
}
