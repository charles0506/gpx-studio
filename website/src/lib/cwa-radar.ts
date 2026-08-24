// CWA publishes radar imagery as opaque PNGs: a neutral grey base map with the
// echoes painted on top in a saturated palette. Laid over a basemap as-is, the
// base greys everything out — which is what "the radar breaks the map" was.
// Nothing in MapLibre keys a colour out of a raster layer, so the images are
// repainted in a canvas first; see lib/radar-image.ts.
//
// These are the S3-hosted open-data products rather than the ones behind the
// public web page: same scans, permissive CORS so no proxy is needed, and a
// grey base rather than a green one, which is what makes the background
// separable from the weather at all.
const S3 = 'https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation';

// Every image is a transparent 1x1 until the keyed version is ready. Handing
// MapLibre the real URL first would flash the opaque original over the map.
export const blankImage =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAX+aBpQAAAABJRU5ErkJggg==';

export type RadarStationDefinition = {
    /** Both the overlay key and the id of its source and layer. */
    id: string;
    /** Where the scan comes from. */
    source: string;
    /** How often it is republished. */
    refreshMs: number;
};

// The composite of all seven radars covers the island but is republished every
// ten minutes; the three rain radars each reach 150 km and land every ninety
// seconds.
export const cwaRadarDefinitions: RadarStationDefinition[] = [
    { id: 'cwaRadarAll', source: `${S3}/O-A0058-003.png`, refreshMs: 5 * 60 * 1000 },
    { id: 'cwaRadarNorth', source: `${S3}/O-A0084-001.png`, refreshMs: 90 * 1000 },
    { id: 'cwaRadarCentral', source: `${S3}/O-A0084-002.png`, refreshMs: 90 * 1000 },
    { id: 'cwaRadarSouth', source: `${S3}/O-A0084-003.png`, refreshMs: 90 * 1000 },
];

export function radarDefinitionFor(sourceId: string): RadarStationDefinition | undefined {
    return cwaRadarDefinitions.find((definition) => definition.id === sourceId);
}

/** The station coordinates and 150 km range come from the O-A0084 metadata. */
const RANGE_KM = 150;

export function stationCoordinates(lon: number, lat: number): number[][] {
    const latSpan = RANGE_KM / 110.574;
    const lonSpan = RANGE_KM / (111.32 * Math.cos((lat * Math.PI) / 180));
    const round = (value: number) => Number(value.toFixed(4));

    return [
        [round(lon - lonSpan), round(lat + latSpan)],
        [round(lon + lonSpan), round(lat + latSpan)],
        [round(lon + lonSpan), round(lat - latSpan)],
        [round(lon - lonSpan), round(lat - latSpan)],
    ];
}
