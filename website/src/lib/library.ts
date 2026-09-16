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

    // A phone on a hillside can hold a request open with no answer for as
    // long as it likes, and a request with no end leaves a spinner with no
    // end. Long enough for one bar of signal to get a route through; short
    // enough that giving up says something before you have given up on it.
    const controller = new AbortController();
    // Sending a route is a few hundred kilobytes; reading the list is a few.
    const timer = setTimeout(() => controller.abort(), method === 'PUT' ? 60000 : 15000);
    let response: Response;
    try {
        response = await fetch(`/api/library${id === undefined ? '' : `?id=${id}`}`, {
            method,
            headers: {
                Authorization: `Bearer ${secret}`,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body,
            signal: controller.signal,
        });
    } catch (e) {
        if (controller.signal.aborted) {
            throw new Error('library.timeout');
        }
        throw new Error('library.offline');
    } finally {
        clearTimeout(timer);
    }

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

async function shelveFiles(
    fileIds: string[],
    onProgress?: (done: number, total: number) => void
): Promise<LibraryEntry[]> {
    // What is on the shelf already, so that a route which has not been
    // touched since it was last put there is not sent again. Shelving a
    // whole desk is mostly re-shelving: on a phone, on a hill, the ones
    // worth spending the connection on are the ones that changed.
    const existing = new Map<string, { hash?: string; name?: string }>();
    try {
        for (const route of await listRoutes()) {
            existing.set(route.id, { hash: route.hash, name: route.name });
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
        // A route already on the shelf under the old kind of id keeps it, so
        // that it is replaced rather than stored a second time — but only if
        // the route there has this very name. Under the old id a different
        // route entirely can be sitting at that key, and writing over it is
        // the bug this is here to stop.
        const legacy = legacyIdFor(name);
        const id = existing.get(legacy)?.name === name ? legacy : idFor(name);
        const hash = await fingerprint(gpx);
        if (existing.get(id)?.hash === hash) {
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

function slugOf(name: string): string {
    return Array.from(name)
        .map((character) => (/[A-Za-z0-9_-]/.test(character) ? character : '-'))
        .join('')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
}

/**
 * A stable id from the name: saving a route again should replace the one on the
 * shelf, and a name is the only thing about a route that stays put across an
 * edit.
 *
 * The readable part keeps only what a key will take, which for a name in
 * Chinese is its digits and not much else — so the digest of the whole name
 * always goes on the end. Without it `0906四獸山` and next year's `0906七星山`
 * were both `0906`, `淡蘭南路2` was `2`, and shelving the second of any such
 * pair silently replaced the first.
 */
function idFor(name: string): string {
    const slug = slugOf(name);
    return slug.length > 0 ? `${slug}-${digest(name)}` : `r${digest(name)}`;
}

/** The id routes were shelved under before, which collided. */
function legacyIdFor(name: string): string {
    const slug = slugOf(name);
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
