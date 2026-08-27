import { get, writable } from 'svelte/store';
import { selection } from '$lib/logic/selection';

/**
 * Routes closed from the strip along the bottom of the map.
 *
 * Closing one there is not deleting it: the file stays in the tree, where
 * deleting is a deliberate act with a menu behind it. This is the difference
 * between putting a map away and throwing it out — the strip is what you are
 * carrying today, the tree is what you own.
 *
 * Held in memory rather than saved: a reload starts the day again with
 * everything you have open in front of you, which is the harmless direction to
 * be wrong in.
 */
export const closedFiles = writable<Set<string>>(new Set());

export function closeFile(fileId: string): void {
    closedFiles.update((closed) => {
        if (closed.has(fileId)) {
            return closed;
        }
        const next = new Set(closed);
        next.add(fileId);
        return next;
    });
}

export function reopenFile(fileId: string): void {
    const closed = get(closedFiles);
    if (!closed.has(fileId)) {
        return;
    }
    const next = new Set(closed);
    next.delete(fileId);
    closedFiles.set(next);
}

// Picking a route in the tree is asking for it back.
selection.subscribe((selected) => {
    if (get(closedFiles).size === 0) {
        return;
    }
    for (const item of selected.getSelected()) {
        const fileId = (item as any).getFileId?.();
        if (fileId !== undefined) {
            reopenFile(fileId);
        }
    }
});
