// Hourly forecast from Open-Meteo: free, no key, and it answers for several
// coordinates in one request, which is what a route needs. The CWA data behind
// the weather tool is authoritative for Taiwan but only breaks the day into
// twelve-hour blocks — too coarse to answer "will it be raining when I get to
// the ridge?".
const API_URL = 'https://api.open-meteo.com/v1/forecast';

export type HourlyForecast = {
    lat: number;
    lon: number;
    elevation?: number;
    times: Date[];
    precipitation: number[];
    precipitationProbability: number[];
    temperature: number[];
    windSpeed: number[];
    cloudCover: number[];
};

function toSeries(entry: any, lat: number, lon: number): HourlyForecast {
    const hourly = entry?.hourly ?? {};
    return {
        lat: entry?.latitude ?? lat,
        lon: entry?.longitude ?? lon,
        elevation: entry?.elevation,
        // The API is asked for Asia/Taipei, so the timestamps carry no zone and
        // have to be read as local time there.
        times: (hourly.time ?? []).map((t: string) => new Date(t + '+08:00')),
        precipitation: hourly.precipitation ?? [],
        precipitationProbability: hourly.precipitation_probability ?? [],
        temperature: hourly.temperature_2m ?? [],
        windSpeed: hourly.wind_speed_10m ?? [],
        cloudCover: hourly.cloud_cover ?? [],
    };
}

export async function fetchHourlyForecast(
    points: { lat: number; lon: number }[],
    days: number = 3
): Promise<HourlyForecast[]> {
    if (points.length === 0) {
        return [];
    }

    const params = new URLSearchParams({
        latitude: points.map((p) => p.lat.toFixed(4)).join(','),
        longitude: points.map((p) => p.lon.toFixed(4)).join(','),
        hourly: 'precipitation,precipitation_probability,temperature_2m,wind_speed_10m,cloud_cover',
        forecast_days: String(days),
        timezone: 'Asia/Taipei',
    });

    const response = await fetch(`${API_URL}?${params}`);
    if (!response.ok) {
        throw new Error(`forecast lookup failed (${response.status})`);
    }

    const data = await response.json();
    // One coordinate comes back as an object, several as an array.
    const entries = Array.isArray(data) ? data : [data];
    return entries.map((entry, index) => toSeries(entry, points[index].lat, points[index].lon));
}

/** The index of the hour containing `when`, or undefined when out of range. */
export function hourIndexFor(forecast: HourlyForecast, when: Date): number | undefined {
    const target = when.getTime();
    for (let i = 0; i < forecast.times.length; i++) {
        const start = forecast.times[i].getTime();
        if (target >= start && target < start + 3600 * 1000) {
            return i;
        }
    }
    return undefined;
}

/** Total rainfall, in millimetres, over a span of the forecast. */
export function rainBetween(forecast: HourlyForecast, from: Date, to: Date): number {
    let total = 0;
    for (let i = 0; i < forecast.times.length; i++) {
        const t = forecast.times[i].getTime();
        if (t >= from.getTime() && t < to.getTime()) {
            total += forecast.precipitation[i] ?? 0;
        }
    }
    return Math.round(total * 10) / 10;
}
