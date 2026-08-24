import type { GPXStatisticsGroup } from 'gpx';

// A ClimbPro-style breakdown: rather than one long profile to squint at, the
// route is cut into the climbs that actually cost something, each with its own
// length, gain and steepness, so you know what is in front of you and how much
// of it is left.

export type Climb = {
    /** Distance along the route where the climb starts and ends, in kilometres. */
    startKm: number;
    endKm: number;
    startElevation: number;
    endElevation: number;
    /** Metres gained, ignoring the dips inside the climb. */
    gain: number;
    /** Mean gradient over the climb, as a percentage. */
    gradient: number;
    /**
     * Garmin and the cycling world both score a climb by length times gradient.
     * The thresholds here are lowered for walking: 5000 is a serious afternoon
     * on foot, where a cyclist would call it category 4.
     */
    score: number;
    category: 1 | 2 | 3 | 4;
    /**
     * The climb's own profile, thinned to something a sparkline can use. Drawing
     * the whole route to show one climb is what a watch face refuses to do, and
     * rightly: what matters on the way up is the shape of this climb alone.
     */
    profile: Sample[];
};

type Sample = { km: number; elevation: number };

// A climb has to gain this much to be worth naming, and may dip this much
// without being counted as two.
const MINIMUM_GAIN = 60;
const MAXIMUM_DIP = 25;
const MINIMUM_GRADIENT = 2;

function categorise(score: number): 1 | 2 | 3 | 4 {
    if (score >= 40000) return 1;
    if (score >= 20000) return 2;
    if (score >= 9000) return 3;
    return 4;
}

/**
 * Find the climbs on a route. Walks the elevation once, opening a climb when
 * the ground starts rising and closing it when it has fallen far enough that
 * the rise is over rather than merely interrupted.
 */
export function findClimbs(statistics: GPXStatisticsGroup | undefined): Climb[] {
    if (!statistics?.forEachTrackPoint) {
        return [];
    }

    // A recorded route can carry a run of zeroes where the device had no fix
    // yet, and gpx.studio itself writes zero until the elevation tool has run.
    // Sea level is not a plausible reading on these routes, and taking it
    // literally invents a climb out of the first few hundred metres, so treat
    // it as missing.
    const samples: Sample[] = [];
    statistics.forEachTrackPoint((point, distance) => {
        const elevation = point.ele;
        if (typeof elevation === 'number' && elevation !== 0) {
            samples.push({ km: distance, elevation });
        }
    });
    if (samples.length < 2) {
        return [];
    }

    const climbs: Climb[] = [];
    let start = samples[0];
    let peak = samples[0];

    // Enough to keep the shape, few enough to put in an SVG path attribute.
    const MAX_PROFILE_POINTS = 64;

    const thin = (from: Sample, to: Sample): Sample[] => {
        const within = samples.filter((s) => s.km >= from.km && s.km <= to.km);
        if (within.length <= MAX_PROFILE_POINTS) {
            return within;
        }
        const step = (within.length - 1) / (MAX_PROFILE_POINTS - 1);
        return Array.from({ length: MAX_PROFILE_POINTS }, (_, i) => within[Math.round(i * step)]);
    };

    const close = (end: Sample) => {
        const gain = peak.elevation - start.elevation;
        const length = peak.km - start.km;
        if (gain < MINIMUM_GAIN || length <= 0) {
            return;
        }
        const gradient = (gain / (length * 1000)) * 100;
        if (gradient < MINIMUM_GRADIENT) {
            return;
        }
        const score = length * 1000 * gradient;
        climbs.push({
            startKm: start.km,
            endKm: peak.km,
            startElevation: Math.round(start.elevation),
            endElevation: Math.round(peak.elevation),
            gain: Math.round(gain),
            gradient: Math.round(gradient * 10) / 10,
            score: Math.round(score),
            category: categorise(score),
            profile: thin(start, peak),
        });
    };

    for (const sample of samples) {
        if (sample.elevation >= peak.elevation) {
            peak = sample;
            continue;
        }

        // Falling. A small dip is part of the climb; a real descent ends it.
        if (peak.elevation - sample.elevation >= MAXIMUM_DIP) {
            close(sample);
            start = sample;
            peak = sample;
        }
    }
    close(samples[samples.length - 1]);

    return climbs;
}

/** The climb a distance falls inside, if any. */
export function climbAt(climbs: Climb[], km: number): Climb | undefined {
    return climbs.find((climb) => km >= climb.startKm && km <= climb.endKm);
}

/** The next climb ahead of a distance. */
export function nextClimb(climbs: Climb[], km: number): Climb | undefined {
    return climbs.find((climb) => climb.startKm > km);
}

/**
 * Metres of this climb already behind you at a distance. Measured against the
 * climb's own profile rather than pro-rated from the total, since a climb that
 * starts gently and steepens would otherwise flatter you early on.
 */
export function climbGainSoFar(climb: Climb, km: number): number {
    if (km <= climb.startKm) {
        return 0;
    }
    if (km >= climb.endKm) {
        return climb.gain;
    }

    let here = climb.profile[0]?.elevation ?? climb.startElevation;
    for (const sample of climb.profile) {
        if (sample.km > km) {
            break;
        }
        here = sample.elevation;
    }
    return Math.max(0, Math.round(here - climb.startElevation));
}

/** How far through a climb a distance is, from 0 to 1. */
export function climbProgress(climb: Climb, km: number): number {
    const length = climb.endKm - climb.startKm;
    if (length <= 0) {
        return 1;
    }
    return Math.min(1, Math.max(0, (km - climb.startKm) / length));
}

// Steeper reads hotter, the way Garmin shades its climbs.
export function gradientColour(gradient: number): string {
    if (gradient >= 15) return '#b91c1c';
    if (gradient >= 10) return '#ea580c';
    if (gradient >= 7) return '#f59e0b';
    if (gradient >= 4) return '#eab308';
    return '#84cc16';
}
