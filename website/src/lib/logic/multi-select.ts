import { writable } from 'svelte/store';

/**
 * Whether a tap adds to the selection rather than replacing it.
 *
 * On a desktop this is Ctrl held down, which a phone has no way to say. Rather
 * than inventing a long-press — which the list already spends on dragging — it
 * is a mode with a switch, on for as long as it is useful and off again after.
 */
export const multiSelectMode = writable(false);
