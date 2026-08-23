import type { GPXStatistics } from 'gpx';

// Tobler's hiking function: walking speed in km/h as a function of the slope,
// expressed as a rise over run. It peaks slightly downhill, at a gradient of
// -5%, which is why the offset is there.
//
//     W = 6 · e^(−3.5 · |S + 0.05|)
//
// On the flat it gives 5.04 km/h, which is a brisk pace on a good path and far
// too quick for a rough mountain trail, so the estimate is scaled by a fitness
// factor before it is shown.
function toblerSpeed(gradient: number): number {
    return 6 * Math.exp(-3.5 * Math.abs(gradient + 0.05));
}

// A factor of 1 reproduces Tobler unchanged. Below 1 is slower, and the default
// lands close to the pace an unhurried hiker keeps on a Taiwanese mountain
// trail with roots, steps and the occasional rope.
export const defaultFitnessFactor = 0.7;

export const minimumFitnessFactor = 0.3;
export const maximumFitnessFactor = 1.5;

/**
 * Estimate how long a route takes to walk, in seconds, from its distances and
 * slopes alone — no timestamps needed. Returns undefined when the statistics
 * hold nothing to work with.
 */
export function estimateHikingTime(
    statistics: GPXStatistics,
    fitnessFactor: number = defaultFitnessFactor
): number | undefined {
    const data = statistics?.local?.data;
    if (!data || data.length < 2) {
        return undefined;
    }

    let seconds = 0;
    for (let i = 0; i < data.length - 1; i++) {
        // distance.total is cumulative and in kilometres, slope.at is a percentage.
        const kilometers = data[i + 1].distance.total - data[i].distance.total;
        if (!(kilometers > 0)) {
            continue;
        }

        const speed = toblerSpeed(data[i].slope.at / 100) * fitnessFactor;
        if (speed > 0) {
            seconds += (kilometers / speed) * 3600;
        }
    }

    return seconds > 0 ? Math.round(seconds) : undefined;
}
