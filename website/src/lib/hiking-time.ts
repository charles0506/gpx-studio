import type { GPXStatisticsGroup } from 'gpx';

// Tobler's hiking function: walking speed in km/h as a function of the slope,
// expressed as a rise over run. It peaks slightly downhill, at a gradient of
// -5%, which is why the offset is there.
//
//     W = 6 · e^(−3.5 · |S + 0.05|)
//
// On the flat it gives 5.04 km/h, which is a brisk pace on a good path and far
// too quick for a rough mountain trail, so the estimate is scaled by a fitness
// factor before it is shown.
// Smoothed slopes still spike on short, noisy segments — a GPS wobble across a
// couple of metres can read as several hundred percent — and Tobler decays so
// steeply that such a spike alone can add days to the estimate. Past about 60%
// (31 degrees) nobody is walking anyway, so the gradient is clamped there.
const MAX_GRADIENT = 0.6;

function toblerSpeed(gradient: number): number {
    const clamped = Math.max(-MAX_GRADIENT, Math.min(MAX_GRADIENT, gradient));
    return 6 * Math.exp(-3.5 * Math.abs(clamped + 0.05));
}

// A factor of 1 reproduces Tobler unchanged. Below 1 is slower, and the default
// lands close to the pace an unhurried hiker keeps on a Taiwanese mountain
// trail with roots, steps and the occasional rope.
export const defaultFitnessFactor = 0.7;

export const minimumFitnessFactor = 0.3;
export const maximumFitnessFactor = 1.5;

/**
 * Estimate how long a route takes to walk, in seconds, from its distances and
 * slopes alone — no timestamps needed. Returns undefined when the selection
 * holds nothing to work with.
 */
export function estimateHikingTime(
    statistics: GPXStatisticsGroup | undefined,
    fitnessFactor: number = defaultFitnessFactor
): number | undefined {
    if (!statistics?.forEachTrackPoint) {
        return undefined;
    }

    let seconds = 0;
    let previousKilometers: number | undefined = undefined;
    let previousSlope = 0;

    statistics.forEachTrackPoint((_point, distance, _speed, slope) => {
        // distance is cumulative and in kilometres, slope.at is a percentage.
        if (previousKilometers !== undefined) {
            const kilometers = distance - previousKilometers;
            if (kilometers > 0) {
                const speed = toblerSpeed(previousSlope / 100) * fitnessFactor;
                if (speed > 0) {
                    seconds += (kilometers / speed) * 3600;
                }
            }
        }
        previousKilometers = distance;
        previousSlope = slope.at;
    });

    return seconds > 0 ? Math.round(seconds) : undefined;
}
