import { get } from 'svelte/store';
import { parseGPX, type GPXFile } from 'gpx';
import { fileActions } from '$lib/logic/file-actions';
import { selection } from '$lib/logic/selection';
import { applySettings, collectSelection, collectSettings, passphrase } from '$lib/sync';

/**
 * A bundle of routes and settings behind a link that opens without a
 * passphrase.
 *
 * The workspace sync and the route library are both for one person and their
 * own devices, and both are guarded by the passphrase — handing that out would
 * hand out the power to delete everything. A share is the other thing: read
 * only, opened by anyone holding the link, and holding a copy rather than a
 * reference, so deleting it later cannot take the walk out from under someone
 * who is on it.
 */

export type ShareEntry = {
    id: string;
    name?: string;
    routes?: string;
    createdAt?: string;
};

/** Long enough that guessing one is not a thing anybody will do. */
function newId(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(22);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function request(method: 'GET' | 'PUT' | 'DELETE', id?: string, body?: string): Promise<any> {
    const secret = get(passphrase);
    // Reading a share needs no passphrase; everything else does.
    if (method !== 'GET' && !secret) {
        throw new Error('missing passphrase');
    }

    const response = await fetch(`/api/share${id === undefined ? '' : `?id=${id}`}`, {
        method,
        headers: {
            ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error ?? `share failed (${response.status})`);
    }
    return data;
}

/** The shares you have made, newest first. Yours only, and it needs the key. */
export async function listShares(): Promise<ShareEntry[]> {
    const data = await request('GET');
    const shares: ShareEntry[] = data.shares ?? [];
    return shares.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * Bundle up what is selected, with the settings that make it look the way it
 * looks here, and return the link to hand over.
 */
export async function createShare(includeSettings: boolean): Promise<string> {
    const routes = collectSelection();
    if (routes.length === 0) {
        throw new Error('nothing selected');
    }

    const id = newId();
    await request(
        'PUT',
        id,
        JSON.stringify({
            name: routes.map((route) => route.name).join('、'),
            routes,
            settings: includeSettings ? collectSettings() : {},
        })
    );
    return linkFor(id);
}

export function linkFor(id: string): string {
    const base = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`;
    return `${base}?share=${id}`;
}

export async function removeShare(id: string): Promise<void> {
    await request('DELETE', id);
}

export type OpenedShare = { routes: number; settings: Record<string, unknown> };

/**
 * Open a share: the routes are added to whatever is already there rather than
 * replacing it, and the settings are handed back rather than applied, because
 * quietly rewriting somebody's units and basemap is not a thing a link should
 * do without asking.
 */
export async function openShare(id: string): Promise<OpenedShare> {
    const data = await request('GET', id);

    const parsed: GPXFile[] = [];
    for (const entry of data.routes ?? []) {
        const file = parseGPX(entry.gpx);
        if (file.metadata === undefined) {
            file.metadata = {};
        }
        if (!file.metadata.name?.trim()) {
            file.metadata.name = entry.name;
        }
        parsed.push(file);
    }

    if (parsed.length > 0) {
        const ids = fileActions.addMultiple(parsed);
        selection.selectFileWhenLoaded(ids[0]);
    }

    return { routes: parsed.length, settings: data.settings ?? {} };
}

export function acceptSettings(settings: Record<string, unknown>): number {
    return applySettings(settings);
}
