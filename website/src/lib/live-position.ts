import { get, writable } from 'svelte/store';
import { gpxStatistics } from '$lib/logic/statistics';
import { cumulativeHikingTime, secondsAt } from '$lib/hiking-time';

export type LivePosition = {
    lat: number;
    lon: number;
    /** Metres of GPS uncertainty, as the device reports it. */
    accuracy: number;
    at: Date;
};

/**
 * Where the device says it is. Fed by the map's geolocate control rather than a
 * watcher of its own, so there is one permission prompt and one battery cost,
 * and the blue dot on the map and the marker on the profile can never disagree.
 */
export const livePosition = writable<LivePosition | undefined>(undefined);

// When tracking began, for the elapsed clock. Cleared when it stops.
export const trackingSince = writable<Date | undefined>(undefined);

// A short history of where you were, in distance along the route. Vertical
// speed is taken from this rather than from the GPS altitude, which wanders by
// tens of metres while standing still; the route's own elevation at a projected
// position is far steadier.
type Step = { at: number; gain: number };
const history: Step[] = [];
const WINDOW_MS = 5 * 60 * 1000;

export function recordProgress(gain: number, at: Date = new Date()): void {
    history.push({ at: at.getTime(), gain });
    while (history.length > 2 && at.getTime() - history[0].at > WINDOW_MS) {
        history.shift();
    }
}

export function clearProgressHistory(): void {
    history.length = 0;
}

/**
 * Metres of ascent per hour, over the last few minutes. Undefined until there
 * is enough history to mean anything.
 */
export function verticalSpeed(): number | undefined {
    if (history.length < 2) {
        return undefined;
    }

    const first = history[0];
    const last = history[history.length - 1];
    const seconds = (last.at - first.at) / 1000;
    if (seconds < 60) {
        return undefined;
    }

    return Math.round(((last.gain - first.gain) / seconds) * 3600);
}

export type RouteProgress = {
    /** How far along the selected route the position projects, in kilometres. */
    km: number;
    /** How far the position is from the route itself, in metres. */
    offRouteMeters: number;
    /** Metres of ascent behind you, cumulative along the route. */
    gain: number;
    remainingKm: number;
    remainingGain: number;
    /** Seconds of walking left, at the estimate's pace. */
    remainingSeconds: number | undefined;
};

// Equirectangular approximation: at the scale of a GPS fix against a track
// point, the error is far below the fix's own.
function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
    const meanLat = ((aLat + bLat) / 2) * (Math.PI / 180);
    const dLat = (bLat - aLat) * 110574;
    const dLon = (bLon - aLon) * 111320 * Math.cos(meanLat);
    return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Project a position onto the selected route: which point of it you are nearest,
 * how far off it you are, and what is left to walk.
 */
export function progressAlongRoute(position: LivePosition | undefined): RouteProgress | undefined {
    if (!position) {
        return undefined;
    }

    const statistics = get(gpxStatistics);
    if (!statistics?.forEachTrackPoint) {
        return undefined;
    }

    let nearestKm: number | undefined = undefined;
    let nearestMeters = Infinity;
    let nearestGain = 0;
    let totalKm = 0;
    let totalGain = 0;

    statistics.forEachTrackPoint((point, distance, _speed, _slope) => {
        const coordinates = point.getCoordinates();
        const away = distanceMeters(position.lat, position.lon, coordinates.lat, coordinates.lon);
        if (away < nearestMeters) {
            nearestMeters = away;
            nearestKm = distance;
        }
        totalKm = distance;
    });

    if (nearestKm === undefined) {
        return undefined;
    }

    // Elevation gain is only available cumulatively through getTrackPoint, so
    // walk it once more rather than carrying every point in memory.
    const curve = cumulativeHikingTime(statistics);
    const totalSeconds = curve.at(-1)?.seconds;
    const doneSeconds = secondsAt(curve, nearestKm);

    let index = 0;
    statistics.forEachTrackPoint((_point, distance, _speed, _slope, i) => {
        if (distance <= nearestKm!) {
            index = i;
        }
    });
    nearestGain = statistics.getTrackPoint(index)?.elevation.gain ?? 0;
    totalGain = statistics.global.elevation.gain;

    return {
        km: nearestKm,
        offRouteMeters: Math.round(nearestMeters),
        gain: Math.round(nearestGain),
        remainingKm: Math.max(0, totalKm - nearestKm),
        remainingGain: Math.max(0, Math.round(totalGain - nearestGain)),
        remainingSeconds:
            totalSeconds !== undefined && doneSeconds !== undefined
                ? Math.max(0, totalSeconds - doneSeconds)
                : undefined,
    };
}
