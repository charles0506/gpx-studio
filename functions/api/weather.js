// Cloudflare Pages Function: weather along a route, from the Central Weather
// Administration's open data.
//
// The key never reaches the browser — it lives in the CWA_API_KEY environment
// variable and is only ever appended here. The two datasets are also large
// (the station list alone is over 400 kB), so they are fetched once per request
// and cached at the edge rather than shipped to every visitor.
const OBSERVATION_DATASET = 'O-A0003-001'; // automatic weather stations, with coordinates
const FORECAST_DATASET = 'F-C0032-001'; // 36-hour forecast, by county

const CACHE_SECONDS = 600; // both datasets are refreshed every ten minutes

const MAX_POINTS = 24;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        },
    });
}

async function fetchDataset(dataset, key) {
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataset}?Authorization=${encodeURIComponent(key)}&format=JSON`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'gpx-studio-selfhost' },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
    if (!response.ok) {
        throw new Error(`${dataset} responded ${response.status}`);
    }
    return response.json();
}

// Equirectangular approximation. Over the tens of kilometres that separate a
// hiker from the nearest weather station it is well within the error that
// picking a station at all introduces.
function distanceKm(aLat, aLon, bLat, bLon) {
    const meanLat = ((aLat + bLat) / 2) * (Math.PI / 180);
    const dLat = (bLat - aLat) * 110.574;
    const dLon = (bLon - aLon) * 111.32 * Math.cos(meanLat);
    return Math.sqrt(dLat * dLat + dLon * dLon);
}

function readStations(data) {
    const stations = data?.records?.Station ?? [];
    return stations
        .map((station) => {
            const wgs84 = (station.GeoInfo?.Coordinates ?? []).find(
                (c) => c.CoordinateName === 'WGS84'
            );
            if (!wgs84) return undefined;
            const element = station.WeatherElement ?? {};
            return {
                name: station.StationName,
                county: station.GeoInfo?.CountyName,
                town: station.GeoInfo?.TownName,
                altitude: Number(station.GeoInfo?.StationAltitude),
                lat: Number(wgs84.StationLatitude),
                lon: Number(wgs84.StationLongitude),
                time: station.ObsTime?.DateTime,
                weather: element.Weather,
                temperature: Number(element.AirTemperature),
                humidity: Number(element.RelativeHumidity),
                precipitation: Number(element.Now?.Precipitation),
                windSpeed: Number(element.WindSpeed),
                gust: Number(element.GustInfo?.PeakGustSpeed),
            };
        })
        .filter((station) => station && Number.isFinite(station.lat) && Number.isFinite(station.lon));
}

function readForecast(data) {
    const locations = data?.records?.location ?? [];
    const byCounty = {};
    for (const location of locations) {
        const elements = {};
        for (const element of location.weatherElement ?? []) {
            elements[element.elementName] = (element.time ?? []).map((slot) => ({
                start: slot.startTime,
                end: slot.endTime,
                value: slot.parameter?.parameterName,
                unit: slot.parameter?.parameterUnit,
            }));
        }
        byCounty[location.locationName] = elements;
    }
    return byCounty;
}

function parsePoints(value) {
    if (!value) return [];
    return value
        .split(';')
        .map((pair) => pair.split(',').map(Number))
        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
        .slice(0, MAX_POINTS)
        .map(([lat, lon]) => ({ lat, lon }));
}

export async function onRequestGet({ request, env }) {
    const key = env.CWA_API_KEY;
    if (!key) {
        return json({ error: 'CWA_API_KEY is not configured' }, 503);
    }

    const points = parsePoints(new URL(request.url).searchParams.get('points'));
    if (points.length === 0) {
        return json({ error: 'missing "points" query parameter, e.g. 25.03,121.56;24.9,121.5' }, 400);
    }

    let stations;
    let forecast;
    try {
        const [observationData, forecastData] = await Promise.all([
            fetchDataset(OBSERVATION_DATASET, key),
            fetchDataset(FORECAST_DATASET, key),
        ]);
        stations = readStations(observationData);
        forecast = readForecast(forecastData);
    } catch (error) {
        return json({ error: String(error.message ?? error) }, 502);
    }

    const results = points.map((point) => {
        let nearest;
        let nearestDistance = Infinity;
        for (const station of stations) {
            const d = distanceKm(point.lat, point.lon, station.lat, station.lon);
            if (d < nearestDistance) {
                nearestDistance = d;
                nearest = station;
            }
        }

        return {
            point,
            station: nearest
                ? { ...nearest, distanceKm: Math.round(nearestDistance * 10) / 10 }
                : undefined,
            forecast: nearest?.county ? forecast[nearest.county] : undefined,
        };
    });

    return json({ stationCount: stations.length, results });
}
