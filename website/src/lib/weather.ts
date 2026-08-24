import type { GPXStatistics } from 'gpx';

export type WeatherStation = {
    name: string;
    county?: string;
    town?: string;
    altitude?: number;
    lat: number;
    lon: number;
    time?: string;
    weather?: string;
    temperature?: number;
    humidity?: number;
    precipitation?: number;
    windSpeed?: number;
    gust?: number;
    distanceKm?: number;
};

export type ForecastSlot = {
    start: string;
    end: string;
    value?: string;
    unit?: string;
};

export type WeatherPoint = {
    /** Distance along the route, in kilometres, of the sampled point. */
    at: number;
    station?: WeatherStation;
    forecast?: Record<string, ForecastSlot[]>;
};

/** The forecast is only published for Taiwan, so anything outside is skipped. */
export function isInTaiwan(lat: number, lon: number): boolean {
    return lat >= 20.5 && lat <= 26.5 && lon >= 118 && lon <= 124;
}

/**
 * Pick points roughly every `spacingKm` along the route, always including the
 * start and the finish. The API caps the number of points it will answer for,
 * so the spacing widens on a long route rather than dropping the tail.
 */
export function sampleRoute(
    statistics: GPXStatistics,
    spacingKm: number = 5,
    maxPoints: number = 12
): { at: number; lat: number; lon: number }[] {
    const data = statistics?.local?.data;
    const points = statistics?.local?.points;
    if (!data || !points || data.length === 0) {
        return [];
    }

    const total = data[data.length - 1].distance.total;
    const spacing = Math.max(spacingKm, total / (maxPoints - 1 || 1));

    const sampled: { at: number; lat: number; lon: number }[] = [];
    let next = 0;
    for (let i = 0; i < data.length; i++) {
        const at = data[i].distance.total;
        if (at + 1e-9 >= next || i === data.length - 1) {
            const coordinates = points[i]?.getCoordinates?.();
            if (coordinates) {
                sampled.push({ at, lat: coordinates.lat, lon: coordinates.lon });
            }
            next = at + spacing;
        }
    }

    return sampled;
}

export async function fetchWeather(
    samples: { at: number; lat: number; lon: number }[]
): Promise<WeatherPoint[]> {
    const inRange = samples.filter((sample) => isInTaiwan(sample.lat, sample.lon));
    if (inRange.length === 0) {
        return [];
    }

    const query = inRange
        .map((sample) => `${sample.lat.toFixed(4)},${sample.lon.toFixed(4)}`)
        .join(';');

    const response = await fetch(`/api/weather?points=${encodeURIComponent(query)}`);
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `weather lookup failed (${response.status})`);
    }

    const data = await response.json();
    return (data.results ?? []).map((result: any, index: number) => ({
        at: inRange[index]?.at ?? 0,
        station: result.station,
        forecast: result.forecast,
    }));
}

/** The slot covering now, or the first one still ahead. */
export function currentSlot(slots: ForecastSlot[] | undefined): ForecastSlot | undefined {
    if (!slots || slots.length === 0) {
        return undefined;
    }
    const now = Date.now();
    return (
        slots.find((slot) => {
            const end = Date.parse(slot.end.replace(' ', 'T') + '+08:00');
            return Number.isFinite(end) && end >= now;
        }) ?? slots[0]
    );
}
