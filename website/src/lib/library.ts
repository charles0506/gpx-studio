import { get } from 'svelte/store';
import { buildGPX, parseGPX, type GPXFile } from 'gpx';
import { fileStateCollection } from '$lib/logic/file-state';
import { fileActions } from '$lib/logic/file-actions';
import { selection } from '$lib/logic/selection';
import { ListFileItem } from '$lib/components/file-list/file-list';
import { passphrase } from '$lib/sync';
import { settings } from '$lib/logic/settings';

/**
 * A shelf of routes in the cloud, one object each.
 *
 * The workspace sync keeps a whole desk and replaces it wholesale, which is
 * right for moving what you are working on between two machines and wrong for
 * a phone on a hill: there you want one route out of thirty and none of the
 * other twenty-nine.
 */

export type LibraryEntry = {
    id: string;
    name: string;
    /** Fingerprint of the stored file, to tell an unchanged route from an edited one. */
    hash?: string;
    /** Strings, because they come back from storage metadata. */
    km?: string;
    ascent?: string;
    updatedAt?: string;
};

async function request(method: 'GET' | 'PUT' | 'DELETE', id?: string, body?: string): Promise<any> {
    const secret = get(passphrase);
    if (!secret) {
        throw new Error('missing passphrase');
    }

    const response = await fetch(`/api/library${id === undefined ? '' : `?id=${id}`}`, {
        method,
        headers: {
            Authorization: `Bearer ${secret}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error ?? `library failed (${response.status})`);
    }
    return data;
}

export async function listRoutes(): Promise<LibraryEntry[]> {
    const data = await request('GET');
    const routes: LibraryEntry[] = data.routes ?? [];
    return routes.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

/**
 * Put the selected routes on the shelf, one object each. Ids are made here
 * rather than by the server so that saving the same route twice replaces it
 * rather than growing the shelf.
 */
/**
 * Put every open route on the shelf.
 *
 * The local copy is the fragile one: it lives in storage the browser is free
 * to throw away, and it throws away a whole origin at a time. Selecting ten
 * routes one by one on a phone to protect them is a chore nobody does twice,
 * so this takes the lot.
 */
export async function shelveAll(
    onProgress?: (done: number, total: number) => void
): Promise<LibraryEntry[]> {
    const fileIds = get(settings.fileOrder).filter((fileId: string) =>
        Boolean(fileStateCollection.getFile(fileId))
    );
    if (fileIds.length === 0) {
        throw new Error('nothing open');
    }
    return shelveFiles(fileIds, onProgress);
}

export async function shelveSelection(): Promise<LibraryEntry[]> {
    const selected = new Set(
        get(selection)
            .getSelected()
            .map((item: any) => (item.getFileId ? item.getFileId() : undefined))
            .filter((id: string | undefined): id is string => id !== undefined)
    );
    if (selected.size === 0) {
        throw new Error('nothing selected');
    }
    return shelveFiles([...selected]);
}

/**
 * Shelve some files, and hand back the entries that were written.
 *
 * Handed back rather than left to be discovered in the next listing: that
 * listing is eventually consistent, so reading it straight after a write
 * returns the shelf as it was before — and the route just uploaded appears
 * to have gone nowhere.
 */
async function shelveFiles(
    fileIds: string[],
    onProgress?: (done: number, total: number) => void
): Promise<LibraryEntry[]> {
    // What is on the shelf already, so that a route which has not been
    // touched since it was last put there is not sent again. Shelving a
    // whole desk is mostly re-shelving: on a phone, on a hill, the ones
    // worth spending the connection on are the ones that changed.
    const existing = new Map<string, string | undefined>();
    try {
        for (const route of await listRoutes()) {
            existing.set(route.id, route.hash);
        }
    } catch (error) {
        // The shelf could not be listed. Everything is sent, which is
        // what would have happened anyway.
    }

    const saved: LibraryEntry[] = [];
    let done = 0;
    for (const fileId of fileIds) {
        onProgress?.(done, fileIds.length);
        done += 1;
        const file = fileStateCollection.getFile(fileId);
        if (!file) {
            continue;
        }
        const name = file.metadata.name ?? fileId;
        // Read off the file itself: the shelf lists distance and ascent, and
        // reading them back out of every route to list them would be absurd.
        const global = fileStateCollection
            .getStatistics(fileId)
            ?.getStatisticsFor(new ListFileItem(fileId))?.global;
        const gpx = buildGPX(file, []);
        const id = idFor(name);
        const hash = await fingerprint(gpx);
        if (existing.get(id) === hash) {
            continue;
        }
        const km = global ? global.distance.total.toFixed(2) : '';
        const ascent = global ? String(Math.round(global.elevation.gain)) : '';
        const { updatedAt } = await request(
            'PUT',
            id,
            JSON.stringify({ name, gpx, hash, km, ascent })
        );
        saved.push({ id, name, hash, km, ascent, updatedAt });
    }
    onProgress?.(fileIds.length, fileIds.length);
    return saved;
}

/**
 * A stable id from the name: saving a route again should replace the one on the
 * shelf, and a name is the only thing about a route that stays put across an
 * edit. Anything the key will not take becomes a dash.
 */
function idFor(name: string): string {
    const slug = Array.from(name)
        .map((character) => (/[A-Za-z0-9_-]/.test(character) ? character : '-'))
        .join('')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
    // Names in Chinese slug down to nothing, so they are given a short digest
    // of the name instead of an empty id.
    return slug.length > 0 ? slug : `r${digest(name)}`;
}

/**
 * A fingerprint of a route file.
 *
 * Wide on purpose. The only thing it decides is whether to skip an upload,
 * and a collision there means the shelf quietly keeps an old version of a
 * route somebody believes they saved — which is the failure this whole
 * corner of the app exists to prevent. The 32-bit digest below is fine for
 * turning a name into a key and much too narrow for this.
 */
async function fingerprint(text: string): Promise<string> {
    try {
        const bytes = new TextEncoder().encode(text);
        const sum = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(sum).slice(0, 8))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    } catch (error) {
        // No subtle crypto here. A narrow fingerprint is still better than
        // uploading everything every time, and it errs towards uploading.
        return `f${digest(text)}`;
    }
}

function digest(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

/** Take one route off the shelf and open it, leaving everything else alone. */
export async function openRoute(id: string): Promise<string> {
    const data = await request('GET', id);
    const file: GPXFile = parseGPX(data.gpx);
    if (file.metadata === undefined) {
        file.metadata = {};
    }
    if (!file.metadata.name?.trim()) {
        file.metadata.name = data.name ?? id;
    }
    const ids = fileActions.addMultiple([file]);
    selection.selectFileWhenLoaded(ids[0]);
    return data.name ?? id;
}

export async function removeRoute(id: string): Promise<void> {
    await request('DELETE', id);
}
