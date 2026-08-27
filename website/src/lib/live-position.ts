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

/**
 * Where you have actually been since tracking started, for drawing behind you.
 *
 * Only what the page saw: a browser suspends the watch when the screen locks
 * or the tab goes to the background, so this is a record of the walk only for
 * as long as the walk was being watched. It is a check on where you just went,
 * not a track log.
 */
export type TrailPoint = { lat: number; lon: number; at: number };

// Far enough apart to be movement rather than the fix wandering, and enough
// of them for a long day at one a second.
const MINIMUM_STEP_M = 5;
const MAXIMUM_TRAIL_POINTS = 20000;

export const trail = writable<TrailPoint[]>([]);

export function recordTrail(position: LivePosition): void {
    const points = get(trail);
    const last = points.at(-1);
    if (last && distanceMeters(last.lat, last.lon, position.lat, position.lon) < MINIMUM_STEP_M) {
        // Standing still. Setting the store anyway would redraw the line on the
        // map once a second for as long as the rest stop lasts.
        return;
    }
    const next = [...points, { lat: position.lat, lon: position.lon, at: position.at.getTime() }];
    trail.set(
        next.length > MAXIMUM_TRAIL_POINTS ? next.slice(next.length - MAXIMUM_TRAIL_POINTS) : next
    );
}

export function clearTrail(): void {
    trail.set([]);
}

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
    lastMatchKm = undefined;
    cached = undefined;
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

/**
 * Far enough off the route that a position projected onto it is a guess
 * rather than a reading. A fix wanders by a few tens of metres under trees;
 * this is well past that.
 */
export const OFF_ROUTE_METERS = 60;

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

// Where the last fix landed on the route, so an out-and-back is read as the
// walk it is. Cleared when tracking stops.
let lastMatchKm: number | undefined = undefined;

// Walking the whole route costs a couple of milliseconds on a long track, and
// four different things ask for this on every fix. The answer only changes
// when the position or the route does.
let cached:
    | { statistics: unknown; lat: number; lon: number; result: RouteProgress | undefined }
    | undefined = undefined;

// Out and back, the two legs lie on top of each other: every point of the
// route has a twin the same distance away, and which of them is nearest is a
// coin toss the projection loses about half the time. Among the points as
// near as the nearest, one just ahead of the last fix is preferred — the
// route is walked forwards, and at the turnaround the twin ahead is the leg
// now being walked. Nothing ahead means standing still is fine, and going
// genuinely backwards falls through to the plain nearest point.
const CONTINUITY_SLACK_M = 25;
const FORWARD_KM = 0.3;
const BACKWARD_KM = 0.02;

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

    if (
        cached &&
        cached.statistics === statistics &&
        cached.lat === position.lat &&
        cached.lon === position.lon
    ) {
        return cached.result;
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

    // A second look, now that there is something to compare against: of the
    // points as near as the nearest, the nearest one that lies just ahead of
    // where the last fix landed.
    if (lastMatchKm !== undefined) {
        const nearest = nearestMeters;
        const previous = lastMatchKm;
        let aheadKm: number | undefined = undefined;
        statistics.forEachTrackPoint((point, distance) => {
            if (distance < previous - BACKWARD_KM || distance > previous + FORWARD_KM) {
                return;
            }
            const coordinates = point.getCoordinates();
            const away = distanceMeters(
                position.lat,
                position.lon,
                coordinates.lat,
                coordinates.lon
            );
            if (away > nearest + CONTINUITY_SLACK_M) {
                return;
            }
            if (
                aheadKm === undefined ||
                Math.abs(distance - previous) < Math.abs(aheadKm - previous)
            ) {
                aheadKm = distance;
            }
        });
        if (aheadKm !== undefined) {
            nearestKm = aheadKm;
        }
    }
    lastMatchKm = nearestKm;

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

    const result: RouteProgress = {
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
    cached = { statistics, lat: position.lat, lon: position.lon, result };
    return result;
}
