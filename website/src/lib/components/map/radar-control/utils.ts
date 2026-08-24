import type { LayerTreeType } from '$lib/assets/layers';

// One overlay per radar view. Drawing several at once made them overlap into a
// mess, so the control shows one at a time and cycles through them: off, the
// island-wide composite, then each of the three rain radars.
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

/** The next station in the cycle, ending back at nothing. */
export function nextStation(current: RadarStation | undefined): RadarStation | undefined {
    if (current === undefined) {
        return radarStations[0];
    }
    const index = radarStations.indexOf(current);
    return index + 1 < radarStations.length ? radarStations[index + 1] : undefined;
}
