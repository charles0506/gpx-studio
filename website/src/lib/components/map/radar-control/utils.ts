import type { LayerTreeType } from '$lib/assets/layers';

export const cwaRadarOverlay = 'cwaRadar';

// Where the radar sits in the overlay tree. The tree is nested by region, so
// the control has to walk to the same leaf the layer control writes to,
// otherwise the two would disagree about whether the radar is on.
const RADAR_PATH = ['overlays', 'countries', 'taiwan', cwaRadarOverlay];

export function isRadarOn(tree: LayerTreeType | undefined): boolean {
    let node: LayerTreeType | boolean | undefined = tree;
    for (const key of RADAR_PATH) {
        if (node === undefined || typeof node === 'boolean') {
            return false;
        }
        node = node[key];
    }
    return node === true;
}

/** A copy of the tree with the radar switched on or off. */
export function withRadar(tree: LayerTreeType | undefined, on: boolean): LayerTreeType {
    const root: LayerTreeType = { ...(tree ?? {}) };

    let node = root;
    for (const key of RADAR_PATH.slice(0, -1)) {
        const child = node[key];
        node[key] = typeof child === 'object' && child !== null ? { ...child } : {};
        node = node[key] as LayerTreeType;
    }
    node[RADAR_PATH[RADAR_PATH.length - 1]] = on;

    return root;
}
