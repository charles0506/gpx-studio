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
