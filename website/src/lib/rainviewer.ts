// RainViewer publishes radar imagery as a set of frames, each living under a
// path that changes every ten minutes, so the tile URL cannot be baked into a
// static style. The overlay in layers.ts carries a placeholder instead, and
// this module resolves it to whichever frame is current.
export const rainviewerPathPlaceholder = 'RAINVIEWER_PATH';

const API_URL = 'https://api.rainviewer.com/public/weather-maps.json';

// Frames appear every ten minutes; refreshing a little more often keeps the
// radar from lagging without hammering the API.
export const rainviewerRefreshInterval = 5 * 60 * 1000;

let latestPath: string | undefined = undefined;
let pending: Promise<string | undefined> | undefined = undefined;

async function fetchLatestPath(): Promise<string | undefined> {
    try {
        const response = await fetch(API_URL, { cache: 'no-store' });
        if (!response.ok) {
            return latestPath;
        }
        const data = await response.json();
        // nowcast holds the short-term forecast frames, past holds observations;
        // the most recent observation is the one to show by default.
        const frames = [...(data?.radar?.past ?? [])];
        const path = frames.at(-1)?.path;
        if (typeof path === 'string') {
            // The API returns "/v2/radar/<id>"; the tile template already has a
            // slash before the placeholder, so drop the leading one.
            latestPath = path.replace(/^\//, '');
        }
    } catch (error) {
        // Offline, or the API is down. Keep whatever was resolved last.
    }
    return latestPath;
}

/**
 * The path of the most recent radar frame, e.g. "v2/radar/ecafcf1e222b".
 * Concurrent callers share one request.
 */
export function getRainviewerPath(): Promise<string | undefined> {
    if (!pending) {
        pending = fetchLatestPath().finally(() => {
            pending = undefined;
        });
    }
    return pending;
}

/** Substitute the placeholder in every tile URL of a style, in place. */
export function applyRainviewerPath(style: any, path: string): void {
    for (const sourceId in style?.sources ?? {}) {
        const source = style.sources[sourceId];
        if (Array.isArray(source?.tiles)) {
            source.tiles = source.tiles.map((tile: string) =>
                tile.replace(rainviewerPathPlaceholder, path)
            );
        }
    }
}

export function styleNeedsRainviewerPath(style: any): boolean {
    for (const sourceId in style?.sources ?? {}) {
        const source = style.sources[sourceId];
        if (
            Array.isArray(source?.tiles) &&
            source.tiles.some((tile: string) => tile.includes(rainviewerPathPlaceholder))
        ) {
            return true;
        }
    }
    return false;
}
