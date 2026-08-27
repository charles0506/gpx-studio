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
    settings?: Record<string, unknown>;
    updatedAt: string | null;
};

/**
 * Settings that mean something on one device and nothing on another: file
 * ids that differ per browser, panel sizes and a default line width chosen
 * from the screen it was first opened on.
 */
const DEVICE_ONLY = new Set([
    'fileOrder',
    'bottomPanelSize',
    'rightPanelSize',
    'defaultWidth',
    'treeFileView',
]);

// Whether the settings travel with the files. Kept in the browser rather than
// in the settings themselves, which would be a setting about syncing settings.
const SETTINGS_KEY = 'syncSettings';

function readStoredSyncSettings(): boolean {
    if (typeof localStorage === 'undefined') {
        return true;
    }
    return localStorage.getItem(SETTINGS_KEY) !== 'false';
}

export const syncSettings = writable(readStoredSyncSettings());

syncSettings.subscribe((value) => {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_KEY, value ? 'true' : 'false');
    }
});

/** Everything worth carrying between devices, as plain values. */
export function collectSettings(): Record<string, unknown> {
    const collected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
        if (DEVICE_ONLY.has(key) || !value || typeof (value as any).subscribe !== 'function') {
            continue;
        }
        collected[key] = get(value as any);
    }
    return collected;
}

export function applySettings(stored: Record<string, unknown> | undefined): number {
    let applied = 0;
    for (const [key, value] of Object.entries(stored ?? {})) {
        if (DEVICE_ONLY.has(key)) {
            continue;
        }
        const setting = (settings as any)[key];
        if (setting && typeof setting.set === 'function') {
            setting.set(value);
            applied += 1;
        }
    }
    return applied;
}

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
    const body = get(syncSettings) ? { files, settings: collectSettings() } : { files };
    return request('PUT', JSON.stringify(body));
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

    // After the files, so that a setting about them lands on something.
    if (get(syncSettings)) {
        applySettings(workspace.settings);
    }

    return parsed.length;
}
