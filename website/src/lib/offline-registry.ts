import { get } from 'svelte/store';
import { GPXFileStateCollectionObserver } from '$lib/logic/file-state';
import { ListFileItem } from '$lib/components/file-list/file-list';
import { settings } from '$lib/logic/settings';
import { forgetTiles, tileKeysFor } from '$lib/offline';

/**
 * Which tiles each open route wants, so that closing one can take its tiles
 * with it — otherwise they sit in the cache until something else pushes them
 * out, which on a phone is a slow way to fill up several hundred megabytes.
 *
 * Kept per file rather than worked out at the moment of deletion, because by
 * then the route is gone and there is nothing left to read the tiles from.
 */
const wantedByFile = new Map<string, Set<string>>();

function zooms(): number[] {
    const [from, to] = get(settings.offlineZoomRange);
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/**
 * The tiles no remaining route wants. Low zoom levels cover kilometres and are
 * shared by everything nearby, so deleting one route's tiles outright would
 * take holes out of the others.
 */
function orphaned(fileId: string): string[] {
    const mine = wantedByFile.get(fileId);
    if (!mine) {
        return [];
    }
    const orphans: string[] = [];
    for (const key of mine) {
        let neededElsewhere = false;
        for (const [otherId, theirs] of wantedByFile) {
            if (otherId !== fileId && theirs.has(key)) {
                neededElsewhere = true;
                break;
            }
        }
        if (!neededElsewhere) {
            orphans.push(key);
        }
    }
    return orphans;
}

new GPXFileStateCollectionObserver(
    (newFiles) => {
        newFiles.forEach((fileState, fileId) => {
            fileState.subscribe((state) => {
                if (!state) {
                    return;
                }
                // Editing a route moves it, so this is read afresh each time
                // rather than only when the file arrives.
                wantedByFile.set(
                    fileId,
                    tileKeysFor(
                        state.statistics.getStatisticsFor(new ListFileItem(fileId)),
                        zooms()
                    )
                );
            });
        });
    },
    (fileId) => {
        const orphans = orphaned(fileId);
        wantedByFile.delete(fileId);
        void forgetTiles(orphans);
    },
    () => {
        // Everything closed at once: nothing is left to want any of it.
        const all = new Set<string>();
        for (const keys of wantedByFile.values()) {
            for (const key of keys) {
                all.add(key);
            }
        }
        wantedByFile.clear();
        void forgetTiles(all);
    }
);
