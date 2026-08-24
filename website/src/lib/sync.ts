import { get, writable } from 'svelte/store';
import { buildGPX, parseGPX, type GPXFile } from 'gpx';
import { fileStateCollection } from '$lib/logic/file-state';
import { fileActions } from '$lib/logic/file-actions';
import { selection } from '$lib/logic/selection';
import { settings } from '$lib/logic/settings';

// The passphrase is the only credential there is, so it stays in the browser
// and is sent on each request rather than exchanged for a session.
const STORAGE_KEY = 'syncPassphrase';

function readStoredPassphrase(): string {
    if (typeof localStorage === 'undefined') {
        return '';
    }
    return localStorage.getItem(STORAGE_KEY) ?? '';
}

export const passphrase = writable(readStoredPassphrase());

passphrase.subscribe((value) => {
    if (typeof localStorage === 'undefined') {
        return;
    }
    if (value) {
        localStorage.setItem(STORAGE_KEY, value);
    } else {
        localStorage.removeItem(STORAGE_KEY);
    }
});

export type SyncedFile = {
    name: string;
    gpx: string;
};

export type Workspace = {
    files: SyncedFile[];
    updatedAt: string | null;
};

async function request(method: 'GET' | 'PUT' | 'DELETE', body?: string): Promise<any> {
    const secret = get(passphrase);
    if (!secret) {
        throw new Error('missing passphrase');
    }

    const response = await fetch('/api/sync', {
        method,
        headers: {
            Authorization: `Bearer ${secret}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error ?? `sync failed (${response.status})`);
    }
    return data;
}

/** Everything currently open, serialised the same way the export button does. */
export function collectWorkspace(): SyncedFile[] {
    const files: SyncedFile[] = [];
    for (const fileId of get(settings.fileOrder)) {
        const file = fileStateCollection.getFile(fileId);
        if (file) {
            files.push({
                name: file.metadata.name ?? fileId,
                gpx: buildGPX(file, []),
            });
        }
    }
    return files;
}

export async function upload(): Promise<{ files: number; updatedAt: string }> {
    const files = collectWorkspace();
    return request('PUT', JSON.stringify({ files }));
}

export async function fetchWorkspace(): Promise<Workspace> {
    return request('GET');
}

/**
 * Replace what is open with what the bucket holds. Merging two workspaces
 * without a per-file history invents conflicts that cannot be resolved
 * sensibly, so the download is deliberately destructive and the UI says so.
 */
export async function download(): Promise<number> {
    const workspace = await fetchWorkspace();

    const parsed: GPXFile[] = [];
    for (const entry of workspace.files ?? []) {
        const file = parseGPX(entry.gpx);
        if (file.metadata === undefined) {
            file.metadata = {};
        }
        if (!file.metadata.name?.trim()) {
            file.metadata.name = entry.name;
        }
        parsed.push(file);
    }

    fileActions.deleteAllFiles();

    if (parsed.length > 0) {
        const ids = fileActions.addMultiple(parsed);
        selection.selectFileWhenLoaded(ids[0]);
    }

    return parsed.length;
}
