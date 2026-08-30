import { get } from 'svelte/store';
import FileSaver from 'file-saver';
import JSZip from 'jszip';
import { buildGPX, parseGPX, type GPXFile } from 'gpx';
import { fileStateCollection } from '$lib/logic/file-state';
import { fileActions } from '$lib/logic/file-actions';
import { selection } from '$lib/logic/selection';
import { ListFileItem } from '$lib/components/file-list/file-list';
import { passphrase } from '$lib/sync';

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
export async function shelveSelection(): Promise<number> {
    const selected = new Set(
        get(selection)
            .getSelected()
            .map((item: any) => (item.getFileId ? item.getFileId() : undefined))
            .filter((id: string | undefined): id is string => id !== undefined)
    );
    if (selected.size === 0) {
        throw new Error('nothing selected');
    }

    let saved = 0;
    for (const fileId of selected) {
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
        await request(
            'PUT',
            idFor(name),
            JSON.stringify({
                name,
                gpx: buildGPX(file, []),
                km: global ? global.distance.total.toFixed(2) : '',
                ascent: global ? Math.round(global.elevation.gain) : '',
            })
        );
        saved += 1;
    }
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

/**
 * Every route on the shelf, in one zip.
 *
 * The shelf is the only copy of most of these: they are in somebody else’s
 * storage, behind a passphrase, and nothing on this machine has them. That is
 * a fine place for a route to live and a poor place for it to only live, so
 * there has to be a way to take the lot home in one go.
 *
 * Fetched one at a time on purpose. The shelf is tens of routes, not
 * thousands, and thirty parallel requests to the same store is a good way to
 * be rate limited half way through and end up with half a backup.
 */
export async function downloadAllRoutes(
    onProgress?: (done: number, total: number) => void
): Promise<number> {
    const routes = await listRoutes();
    if (routes.length === 0) {
        throw new Error('the shelf is empty');
    }

    const zip = new JSZip();
    let saved = 0;
    for (const route of routes) {
        onProgress?.(saved, routes.length);
        const data = await request('GET', route.id);
        if (typeof data?.gpx !== 'string') {
            continue;
        }
        // Two routes may share a name; neither should overwrite the other on
        // the way out.
        const base = data.name ?? route.name ?? route.id;
        let filename = base;
        for (let i = 1; zip.files[filename + '.gpx']; i += 1) {
            filename = `${base}-${i}`;
        }
        zip.file(filename + '.gpx', data.gpx);
        saved += 1;
    }
    onProgress?.(saved, routes.length);

    if (saved === 0) {
        throw new Error('nothing could be read');
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = await zip.generateAsync({ type: 'blob' });
    FileSaver.saveAs(blob, `路線庫-${stamp}.zip`);
    return saved;
}

export async function removeRoute(id: string): Promise<void> {
    await request('DELETE', id);
}
