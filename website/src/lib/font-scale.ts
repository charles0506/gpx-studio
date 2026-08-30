import { get } from 'svelte/store';
import { settings } from '$lib/logic/settings';

/**
 * How large the interface is drawn.
 *
 * Everything in the app is sized in rem, so moving the root font size moves the
 * whole of it together — the toolbar, the file tabs, the panels, the readings
 * under the profile. The map's own controls are the exception: they come from
 * the map library in pixels and stay the size they are.
 *
 * This is not the browser's zoom. Zooming makes the map smaller as it makes the
 * text bigger, which on a hill is the wrong trade: the point is to read the
 * numbers without giving up the ground they describe.
 */

/** The browser's own default. Everything is a multiple of this. */
const BASE_PX = 16;

export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.6;
const STEP = 0.1;

function clamp(scale: number): number {
    if (!Number.isFinite(scale)) {
        return 1;
    }
    return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(scale * 100) / 100));
}

function apply(scale: number) {
    if (typeof document === 'undefined') {
        return;
    }
    document.documentElement.style.fontSize = `${(BASE_PX * clamp(scale)).toFixed(2)}px`;
}

let connected = false;

/** Follow the setting for as long as the app is open. */
export function connectFontScale() {
    if (connected) {
        return;
    }
    connected = true;
    settings.fontScale.subscribe(apply);
}

export function enlargeFont() {
    settings.fontScale.set(clamp(get(settings.fontScale) + STEP));
}

export function shrinkFont() {
    settings.fontScale.set(clamp(get(settings.fontScale) - STEP));
}

export function resetFont() {
    settings.fontScale.set(1);
}
