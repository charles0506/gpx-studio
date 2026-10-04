/**
 * How many map tiles are kept for offline use. Beyond this the service worker
 * drops the oldest, so a fetch larger than it would evict its own beginning —
 * which is why the dialog warns and the automatic fetch stands down.
 *
 * Roughly 500 MB at the 25 kB a topographic raster tile tends to weigh, which
 * is around 1200 km of route over four zoom levels. Browsers allow far more
 * than that; this is a self-imposed ceiling, not a device limit.
 *
 * Its own file, with nothing imported into it, because the service worker
 * shares it and must not pull the map or the app's state in behind it.
 */
export const MAX_TILE_ENTRIES = 20000;

/** The cache the worker keeps map data in, across deploys. */
export const TILE_CACHE = 'map-data';

/**
 * 魯地圖 is asked for through this site, which answers from its own store of
 * tiles when it has them and passes the request on when it does not.
 */
export const OWN_RUDY_TILES = 'https://gpx-studio2.pages.dev/tiles/rudy/';

/** Where the same tiles used to be asked for, and are still cached under. */
const UPSTREAM_RUDY_TILES = 'https://tile.happyman.idv.tw/map/rudy/';

/**
 * The address a tile was cached under before it was asked for through this
 * site. Everything already downloaded for offline use is filed under the old
 * one, and changing where the map is fetched from must not quietly turn all
 * of that into tiles that have to be fetched again.
 */
export function formerTileUrl(url: string): string | undefined {
    return url.startsWith(OWN_RUDY_TILES)
        ? UPSTREAM_RUDY_TILES + url.slice(OWN_RUDY_TILES.length)
        : undefined;
}
