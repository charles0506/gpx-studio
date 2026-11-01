/**
 * Where the map was left.
 *
 * A phone throws a page away as soon as it needs the memory, and swiping a
 * browser out of the way is often enough. Coming back to it is then a fresh
 * load, and a fresh load used to start by framing every route open, which puts
 * you a long way from the junction you were reading a minute ago. So the view
 * is kept, and put back.
 *
 * The address bar keeps it too, but only for as long as the address does: an
 * icon on the home screen, or a tab reopened from a bookmark, has no position
 * in it.
 *
 * Kept in the browser rather than in the app's settings: those are in IndexedDB
 * and arrive too late, after the map has already been made somewhere else.
 */

const STORAGE_KEY = 'last-map-view';

export type MapView = {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
};

// Set when a view has actually been put back, as opposed to merely being
// stored: a page that was told where to look by its address, and an embedded
// map, both still frame their routes as they always have.
let restored = false;

export function wasViewRestored(): boolean {
    return restored;
}

/** The view to start from, if this load has nothing better to go on. */
export function takeSavedView(): MapView | undefined {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === null) {
            return undefined;
        }
        const view = JSON.parse(stored) as MapView;
        const fine = [view.center?.[0], view.center?.[1], view.zoom, view.bearing, view.pitch].every(
            (value) => Number.isFinite(value)
        );
        if (!fine) {
            return undefined;
        }
        restored = true;
        return view;
    } catch {
        return undefined;
    }
}

export function saveView(view: MapView) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
    } catch {
        // A private window, or site data blocked. It only means starting over.
    }
}
