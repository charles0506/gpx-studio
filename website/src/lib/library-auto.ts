import { get, writable } from 'svelte/store';
import { fileStateCollection } from '$lib/logic/file-state';
import { settings } from '$lib/logic/settings';
import { passphrase } from '$lib/sync';
import { shelveFiles, type LibraryEntry } from '$lib/library';

/**
 * A route that has been open for an hour is put on the shelf without being
 * asked.
 *
 * The copy in the browser is the fragile one — it lives in storage the browser
 * may clear, a whole site at a time, without saying so — and the button that
 * protects a route from that only works if somebody remembers to press it.
 * Routes that vanished were, every time, routes nobody had pressed it for.
 *
 * An hour, rather than at once, because a good deal of what is opened is
 * opened to be looked at and closed: somebody else's track off a shared link,
 * three candidates for Saturday of which one will be walked. What is still
 * open an hour later is being kept.
 */

const HOUR_MS = 60 * 60 * 1000;
// How often to look. Nothing here is urgent to the minute; this is how late a
// route can be, past its hour, before it is noticed.
const EVERY_MS = 10 * 60 * 1000;
// The files are read out of the browser's database after the page is up, and
// asking before they are there finds nothing to back up.
const FIRST_LOOK_MS = 90 * 1000;

const SEEN_KEY = 'library-first-seen';
const SKIP_KEY = 'library-auto-skip';

function read(key: string): Record<string, any> | undefined {
    try {
        const stored = localStorage.getItem(key);
        return stored === null ? undefined : JSON.parse(stored);
    } catch {
        return undefined;
    }
}

function write(key: string, value: Record<string, any>) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // No storage to keep it in. The backup still runs; it just cannot
        // remember across a reload how long a route has been open.
    }
}

// A file id is handed out again once its file is closed, so the id alone would
// let a route opened a minute ago inherit the age of the one that had the id
// before it.
function keyFor(fileId: string): string {
    return `${fileId}|${fileStateCollection.getFile(fileId)?.metadata.name ?? ''}`;
}

/** Note when each open route was first seen. */
function noteOpenRoutes(): Record<string, number> {
    const stored = read(SEEN_KEY);
    const now = Date.now();
    // What is not open at this instant is kept, not dropped: for the first
    // moments after a reload nothing is open yet, and forgetting everything
    // then would start every route's hour again each time the page was loaded
    // — so that a route would only ever be backed up by somebody who kept the
    // page open for an hour straight. Entries are let go after a month.
    const seen: Record<string, number> = {};
    for (const [key, since] of Object.entries(stored ?? {})) {
        if (now - (since as number) < 30 * 24 * HOUR_MS || since === 0) {
            seen[key] = since as number;
        }
    }
    for (const fileId of get(settings.fileOrder) as string[]) {
        if (!fileStateCollection.getFile(fileId)) {
            continue;
        }
        const key = keyFor(fileId);
        if (seen[key] === undefined) {
            // The first time this runs on a device, whatever is already open
            // has been open for nobody knows how long — and is exactly what
            // has gone unprotected so far. It counts as old.
            seen[key] = stored === undefined ? 0 : now;
        }
    }
    write(SEEN_KEY, seen);
    return seen;
}

/**
 * A route taken off the shelf by hand, while still open, is not put back by
 * the backup. Without this the bin would not work: delete a route from the
 * shelf and ten minutes later it has been backed up again.
 *
 * Remembered with the fingerprint it had, so that the same route edited
 * afterwards is something new and is kept.
 */
export function leaveOffShelf(id: string, hash: string | undefined) {
    const skipped = read(SKIP_KEY) ?? {};
    skipped[id] = hash ?? '';
    write(SKIP_KEY, skipped);
}

/** Pressing the upload button is asking for everything, taken off or not. */
export function forgetLeftOff() {
    write(SKIP_KEY, {});
}

/** What the last unattended backup put on the shelf, for the list to pick up. */
export const autoShelved = writable<LibraryEntry[]>([]);

let running = false;

export async function backUpOldRoutes(): Promise<LibraryEntry[]> {
    if (running || !get(passphrase)) {
        return [];
    }
    if (typeof navigator !== 'undefined') {
        if (navigator.onLine === false) {
            return [];
        }
        // The phone is on a metered connection and has said so.
        if ((navigator as any).connection?.saveData) {
            return [];
        }
    }

    const seen = noteOpenRoutes();
    const now = Date.now();
    const old = (get(settings.fileOrder) as string[]).filter((fileId) => {
        const since = seen[keyFor(fileId)];
        return since !== undefined && now - since >= HOUR_MS;
    });
    if (old.length === 0) {
        return [];
    }

    running = true;
    try {
        const skipped = read(SKIP_KEY) ?? {};
        const saved = await shelveFiles(old, undefined, (id, hash) => skipped[id] === hash);
        if (saved.length > 0) {
            autoShelved.set(saved);
        }
        return saved;
    } catch {
        // No connection, a wrong passphrase, a server having a moment: all of
        // them are tried again at the next look, and none is worth a message
        // about something nobody asked to have done.
        return [];
    } finally {
        running = false;
    }
}

if (typeof window !== 'undefined') {
    // Keeps the record of what is open current between looks, so that a route
    // closed and another opened in its place does not borrow its age.
    //
    // A moment after the list changes rather than at once: the list names a
    // route before the route itself has been read in, and noting it then finds
    // nothing to note — which left a newly opened route's hour to start at the
    // next look, up to ten minutes late.
    let noting: ReturnType<typeof setTimeout> | undefined = undefined;
    settings.fileOrder.subscribe(() => {
        clearTimeout(noting);
        noting = setTimeout(() => {
            if (read(SEEN_KEY) !== undefined) {
                noteOpenRoutes();
            }
        }, 3000);
    });
    setTimeout(() => {
        void backUpOldRoutes();
        setInterval(() => void backUpOldRoutes(), EVERY_MS);
    }, FIRST_LOOK_MS);
}
