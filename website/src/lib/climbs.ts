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
/**
 * Ground rising slower than this is approach, not climb. It is charged against
 * the ascent as the route is walked, so a kilometre of it costs 30 m: a long
 * gentle valley road cannot carry a steep finish into the same climb, and the
 * average gradient a climb reports is never watered down by the flat that led
 * to it.
 */
const APPROACH_GRADIENT = 3;

function categorise(score: number): 1 | 2 | 3 | 4 {
    if (score >= 40000) return 1;
    if (score >= 20000) return 2;
    if (score >= 9000) return 3;
    return 4;
}

/**
 * Find the climbs on a route. Each step of the route scores what it gains less
 * what a gentle approach would have gained over the same ground, and the climbs
 * are the stretches where that score runs positive — the largest-sum runs, in
 * other words, which is Kadane's algorithm with a drawdown rule to close a
 * climb once the ground has fallen far enough that the rise is over rather than
 * merely interrupted.
 *
 * Trimming the approach matters on a route that drifts uphill for ten
 * kilometres and then rears up at the end: counted whole it is one climb at
 * 2%, which describes neither half of it.
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

    const close = (start: Sample, peak: Sample) => {
        const gain = peak.elevation - start.elevation;
        const length = peak.km - start.km;
        if (gain < MINIMUM_GAIN || length <= 0) {
            return;
        }
        const gradient = (gain / (length * 1000)) * 100;
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

    let start = samples[0];
    // The highest ground since the climb began, which is what a dip is measured
    // against, and the point the climb is worth the most at, which is where it
    // ends: they part company when a summit gives way to a level ridge, and it
    // is the second that a watch calls the top.
    let peak = samples[0];
    let top = samples[0];
    let running = 0;
    let best = 0;

    for (let i = 1; i < samples.length; i += 1) {
        const previous = samples[i - 1];
        const sample = samples[i];
        const metres = Math.max((sample.km - previous.km) * 1000, 0);
        running += sample.elevation - previous.elevation - (metres * APPROACH_GRADIENT) / 100;

        if (sample.elevation > peak.elevation) {
            peak = sample;
        }
        if (running > best) {
            best = running;
            top = sample;
        }

        // The climb is over once the ground has fallen away from its high point
        // — in plain metres, since the approach charge would make a long shallow
        // dip look like a descent — or once what has been walked no longer
        // outruns an approach at all.
        if (running <= 0 || peak.elevation - sample.elevation >= MAXIMUM_DIP) {
            close(start, top);
            running = 0;
            best = 0;
            start = sample;
            peak = sample;
            top = sample;
        }
    }
    close(start, top);

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

/**
 * Steeper reads hotter, the way Garmin shades its climbs. The scale runs past
 * the 15% a road cyclist would call the top of it: these are 古道, where whole
 * climbs average 30% and a single band would paint every one of them the same
 * red, so the steps above 15% are what tells a hard climb from a staircase.
 */
export const gradientScale: { from: number; colour: string }[] = [
    { from: 0, colour: '#84cc16' },
    { from: 4, colour: '#eab308' },
    { from: 7, colour: '#f59e0b' },
    { from: 10, colour: '#ea580c' },
    { from: 15, colour: '#dc2626' },
    { from: 25, colour: '#b91c1c' },
    { from: 35, colour: '#7f1d1d' },
];

export function gradientColour(gradient: number): string {
    let colour = gradientScale[0].colour;
    for (const step of gradientScale) {
        if (gradient >= step.from) {
            colour = step.colour;
        }
    }
    return colour;
}
