import { writable } from 'svelte/store';

/**
 * The ClimbPro-style screen, and where to place you on it. A watch has the
 * screen because it knows where you are; at the kitchen table there is no fix
 * to be had, so the profile's own cursor stands in for one and the same panel
 * answers "what is this hill like" before the walk as well as during it.
 */
export const showClimbPro = writable(false);

/**
 * The last point of the route the elevation profile was pointed at, in
 * kilometres. Deliberately not cleared when the pointer leaves the chart: the
 * panel would otherwise flash away the moment you moved to read it.
 */
export const climbCursorKm = writable<number | undefined>(undefined);
