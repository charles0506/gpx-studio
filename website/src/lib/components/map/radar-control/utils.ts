import type { LayerTreeType } from '$lib/assets/layers';

// One overlay per radar view. Drawing several at once made them overlap into a
// mess, so exactly one is ever shown. Which one is chosen in the layer panel;
// the map control only shows and hides it.
export const radarStations = [
    'cwaRadarAll',
    'cwaRadarNorth',
    'cwaRadarCentral',
    'cwaRadarSouth',
] as const;
export type RadarStation = (typeof radarStations)[number];

// Where the overlays sit in the tree. The control has to write to the same
// leaves the layer panel does, or the two would disagree.
const GROUP = ['overlays', 'countries', 'taiwan'];

function leaf(tree: LayerTreeType | undefined): LayerTreeType | undefined {
    let node: LayerTreeType | boolean | undefined = tree;
    for (const key of GROUP) {
        if (node === undefined || typeof node === 'boolean') {
            return undefined;
        }
        node = node[key];
    }
    return typeof node === 'object' ? node : undefined;
}

/** Whichever station is currently shown, or undefined when the radar is off. */
export function activeStation(tree: LayerTreeType | undefined): RadarStation | undefined {
    const group = leaf(tree);
    return radarStations.find((station) => group?.[station] === true);
}

/** A copy of the tree showing only `station`, or none of them. */
export function withStation(
    tree: LayerTreeType | undefined,
    station: RadarStation | undefined
): LayerTreeType {
    const root: LayerTreeType = { ...(tree ?? {}) };

    let node = root;
    for (const key of GROUP) {
        const child = node[key];
        node[key] = typeof child === 'object' && child !== null ? { ...child } : {};
        node = node[key] as LayerTreeType;
    }

    for (const candidate of radarStations) {
        node[candidate] = candidate === station;
    }

    return root;
}

const LAST_STATION_KEY = 'radarStation';

/**
 * The view the control turns back on. Remembering it is what lets the button be
 * a plain on/off switch: the choice belongs to the layer panel, and pressing
 * the button should not silently move it somewhere else.
 */
export function rememberedStation(): RadarStation {
    if (typeof localStorage === 'undefined') {
        return radarStations[0];
    }
    const stored = localStorage.getItem(LAST_STATION_KEY);
    return radarStations.includes(stored as RadarStation)
        ? (stored as RadarStation)
        : radarStations[0];
}

export function rememberStation(station: RadarStation): void {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_STATION_KEY, station);
    }
}

/**
 * Keep at most one radar view on. The layer panel renders the whole overlay
 * tree with checkboxes, so nothing there stops two views being ticked at once —
 * and two of these images drawn together are unreadable. Rather than teach the
 * panel about exclusive groups, drop the older selection whenever a second one
 * appears.
 */
export function enforceSingleRadar(
    previous: LayerTreeType | undefined,
    next: LayerTreeType | undefined
): LayerTreeType | undefined {
    const group = leaf(next);
    if (!group) {
        return undefined;
    }

    const on = radarStations.filter((station) => group[station] === true);
    if (on.length < 2) {
        return undefined;
    }

    // Whichever was not on a moment ago is the one just ticked.
    const before = leaf(previous);
    const added = on.find((station) => before?.[station] !== true) ?? on[on.length - 1];
    return withStation(next, added);
}
