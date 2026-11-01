import { get } from 'svelte/store';
import { ListFileItem } from '$lib/components/file-list/file-list';
import { boundsManager } from '$lib/logic/bounds';
import { fileStateCollection } from '$lib/logic/file-state';
import { selection } from '$lib/logic/selection';

/**
 * Which routes were picked out, kept across a reload.
 *
 * The climb screen, the profile and the offline download all work from the
 * selection, so a page reloaded with nothing selected is a page with most of
 * it switched off until the route is tapped again — every time the phone has
 * thrown the page away, which on a walk is every time it goes in a pocket.
 *
 * By file. A track or segment picked out inside a file comes back as the file:
 * their positions are not something that can be relied on to mean the same
 * thing later, and the file is what the screens are reading anyway.
 */

const STORAGE_KEY = 'last-selection';

function readSaved(): string[] {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * Put the selection back, then start keeping it.
 *
 * In that order, and only once the files are known. The selection is empty
 * until then, and keeping it any sooner would write that emptiness over the
 * very thing about to be read.
 *
 * `putBack` is false when this load arrived with routes of its own, on a shared
 * link: those are what is being asked about, and they select themselves.
 */
export function resumeSelection(putBack: boolean) {
    if (putBack) {
        const items = readSaved()
            .filter((fileId) => get(fileStateCollection).has(fileId))
            .map((fileId) => new ListFileItem(fileId));
        if (items.length > 0) {
            boundsManager.withoutCentering(() => selection.set(items));
        }
    }

    selection.subscribe((selected) => {
        const fileIds = new Set(selected.getSelected().map((item) => item.getFileId()));
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([...fileIds]));
        } catch {
            // A private window, or site data blocked. It only means tapping again.
        }
    });
}
