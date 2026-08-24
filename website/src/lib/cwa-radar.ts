// The Central Weather Administration runs three rain radars. Each publishes a
// square image, 3600 px across, covering 150 km around its own site — one
// station alone leaves most of the island uncovered, so the overlay carries all
// three.
//
// Each file is overwritten in place every ninety seconds and nothing in its URL
// changes between scans, so a cache-buster is the only way to pick a new one
// up. Hence the placeholder in the overlay definition.
export const cwaRadarStampPlaceholder = 'CWA_RADAR_STAMP';

export const cwaRadarRefreshInterval = 90 * 1000;

// Station coordinates and the 150 km range come from the O-A0084-00x dataset
// metadata.
export const cwaRadarStations = [
    { id: 'cwaRadarNorth', site: 'north', name: '樹林', lon: 121.4, lat: 25.0 },
    { id: 'cwaRadarCentral', site: 'central', name: '南屯', lon: 120.58, lat: 24.14 },
    { id: 'cwaRadarSouth', site: 'south', name: '林園', lon: 120.38, lat: 22.53 },
] as const;

const RANGE_KM = 150;

/**
 * The four corners of a station's image, clockwise from the top left, as
 * MapLibre wants them. The image is a square in kilometres rather than in
 * degrees, so the longitude span is widened by the latitude it sits at.
 */
export function stationCoordinates(station: { lon: number; lat: number }): number[][] {
    const latSpan = RANGE_KM / 110.574;
    const lonSpan = RANGE_KM / (111.32 * Math.cos((station.lat * Math.PI) / 180));

    const west = station.lon - lonSpan;
    const east = station.lon + lonSpan;
    const north = station.lat + latSpan;
    const south = station.lat - latSpan;

    return [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
    ];
}

/**
 * Replace the cache-buster placeholder in every image source of a style, in
 * place. Returns the source ids that were stamped.
 */
export function applyCwaRadarStamp(style: any): string[] {
    const stamped: string[] = [];
    const now = String(Date.now());

    for (const sourceId in style?.sources ?? {}) {
        const source = style.sources[sourceId];
        if (typeof source?.url === 'string' && source.url.includes(cwaRadarStampPlaceholder)) {
            source.url = source.url.replace(cwaRadarStampPlaceholder, now);
            stamped.push(sourceId);
        }
    }

    return stamped;
}
