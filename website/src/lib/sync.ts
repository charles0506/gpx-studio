import { get, writable } from 'svelte/store';
import { buildGPX, parseGPX, type GPXFile } from 'gpx';
import { fileStateCollection } from '$lib/logic/file-state';
import { fileActions } from '$lib/logic/file-actions';
import { selection } from '$lib/logic/selection';
import { settings } from '$lib/logic/settings';

// The passphrase is the only credential there is, so it stays in the browser
// and is sent on each request rather than exchanged for a session.
const STORAGE_KEY = 'syncPassphrase';
const SLOT_KEY = 'syncSlot';
const LABEL_KEY = 'syncSlotLabels';

/**
 * Independent workspaces, sharing one passphrase. The numbered ones hold what
 * is planned; 'now' holds the route being walked today, so a phone on the
 * trail downloads one route rather than a library of them.
 */
export const slots = ['1', '2', '3', '4', 'now'] as const;
export const currentSlot: Slot = 'now';
export type Slot = (typeof slots)[number];

function readStoredPassphrase(): string {
    if (typeof localStorage === 'undefined') {
        return '';
    }
    return localStorage.getItem(STORAGE_KEY) ?? '';
}

export const passphrase = writable(readStoredPassphrase());

function readStoredSlot(): Slot {
    if (typeof localStorage === 'undefined') {
        return '1';
    }
    const stored = localStorage.getItem(SLOT_KEY);
    return slots.includes(stored as Slot) ? (stored as Slot) : '1';
}

export const slot = writable<Slot>(readStoredSlot());

slot.subscribe((value) => {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SLOT_KEY, value);
    }
});

// Labels are only ever shown, never sent, so they live on the device. Naming a
// slot on the phone does not rename it on the desktop, which is a fair trade
// for not having to store them server-side.
function readStoredLabels(): Record<string, string> {
    if (typeof localStorage === 'undefined') {
        return {};
    }
    try {
        return JSON.parse(localStorage.getItem(LABEL_KEY) ?? '{}');
    } catch (error) {
        return {};
    }
}

export const slotLabels = writable<Record<string, string>>(readStoredLabels());

slotLabels.subscribe((value) => {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LABEL_KEY, JSON.stringify(value));
    }
});

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

async function request(
    method: 'GET' | 'PUT' | 'DELETE',
    body?: string,
    target: Slot = get(slot)
): Promise<any> {
    const secret = get(passphrase);
    if (!secret) {
        throw new Error('missing passphrase');
    }

    const response = await fetch(`/api/sync?slot=${target}`, {
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

/** The files the list has selected, in the order the list shows them. */
export function collectSelection(): SyncedFile[] {
    const selected = new Set(
        get(selection)
            .getSelected()
            .map((item: any) => (item.getFileId ? item.getFileId() : undefined))
            .filter((id: string | undefined): id is string => id !== undefined)
    );

    const files: SyncedFile[] = [];
    for (const fileId of get(settings.fileOrder)) {
        if (!selected.has(fileId)) {
            continue;
        }
        const file = fileStateCollection.getFile(fileId);
        if (file) {
            files.push({ name: file.metadata.name ?? fileId, gpx: buildGPX(file, []) });
        }
    }
    return files;
}

/**
 * Put what is selected into the walking slot, whichever slot is open. Planning
 * happens in a numbered workspace with every candidate route in it; what goes
 * up the hill is one of them, and picking it out on the phone in the rain is
 * the thing this avoids.
 */
export async function sendSelectionToCurrent(): Promise<{ files: number }> {
    const files = collectSelection();
    if (files.length === 0) {
        throw new Error('nothing selected');
    }
    await request('PUT', JSON.stringify({ files }), currentSlot);
    return { files: files.length };
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
