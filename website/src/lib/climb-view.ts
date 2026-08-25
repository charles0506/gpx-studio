import { writable } from 'svelte/store';

/**
 * The ClimbPro-style screen, and where to place you on it. A watch has the
 * screen because it knows where you are; at the kitchen table there is no fix
 * to be had, so the profile's own cursor stands in for one and the same panel
 * answers "what is this hill like" before the walk as well as during it.
 *
 * Three states rather than two, because the panel sits on the map and the two
 * reasons to want it are not the same reason: `auto` is for walking, and puts
 * it up only while a fix is placing you on the route; `on` keeps it up to read
 * a hill at the table; `off` is what was missing — the map to yourself even
 * while the geolocate control is following you.
 */
export type ClimbScreenMode = 'off' | 'auto' | 'on';

const MODES: ClimbScreenMode[] = ['off', 'auto', 'on'];
const STORAGE_KEY = 'climb-screen';

// Kept in the browser rather than in the app's own settings: those live in
// IndexedDB and re-emit a new object after every write, which an effect reading
// them and writing anything in response turns into an update-depth loop.
function remembered(): ClimbScreenMode {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved !== null && MODES.includes(saved as ClimbScreenMode)) {
            return saved as ClimbScreenMode;
        }
    } catch {
        // A private window, or site data blocked: the default will do.
    }
    return 'auto';
}

export const climbScreen = writable<ClimbScreenMode>(
    typeof localStorage === 'undefined' ? 'auto' : remembered()
);

climbScreen.subscribe((mode) => {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // Nothing to do about it, and nothing that depends on it.
    }
});

export function cycleClimbScreen(): void {
    climbScreen.update((mode) => MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
}

/**
 * The last point of the route the elevation profile was pointed at, in
 * kilometres. Deliberately not cleared when the pointer leaves the chart: the
 * panel would otherwise flash away the moment you moved to read it.
 */
export const climbCursorKm = writable<number | undefined>(undefined);
