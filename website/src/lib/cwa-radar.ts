// CWA publishes radar imagery as opaque PNGs — a neutral base map with the
// echoes painted over it — so the layer dims whatever is beneath it. Keying the
// background out in a canvas was tried and dropped: it cost a repaint of a
// 3600 px image on every scan and swallowed the faintest echoes, which are the
// ones worth seeing. Raster opacity carries the layer instead.
//
// These are the S3-hosted open-data products rather than the ones behind the
// public web page: same scans, and permissive CORS, so no proxy is needed.
const S3 = 'https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation';

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

/** The image URL for a radar source, with a cache-buster the refresh replaces. */
export function radarSourceFor(sourceId: string): string {
    const definition = radarDefinitionFor(sourceId);
    return definition ? `${definition.source}?t=0` : '';
}

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
