/**
 * Ask the browser to stop treating this site's storage as disposable.
 *
 * Without this, everything stored here is "best effort": when the device runs
 * short of space the browser evicts whole origins, and it takes the lot — the
 * offline map tiles, and the routes and settings in the database beside them.
 * A route opened yesterday is simply gone, with nothing to say it ever existed.
 *
 * Which makes an offline map store a liability: hundreds of megabytes of tiles
 * are exactly what makes an origin worth evicting, and the routes are collateral.
 *
 * Asked for only once tiles have actually been stored. Chrome decides silently
 * on how much the site is used; Firefox may ask, and a casual visitor who has
 * never gone offline should not be asked anything.
 */

let asked = false;

export async function askToKeepStorage(): Promise<boolean | undefined> {
    if (asked || typeof navigator === 'undefined' || !navigator.storage?.persist) {
        return undefined;
    }
    asked = true;

    try {
        if (await navigator.storage.persisted()) {
            return true;
        }
        return await navigator.storage.persist();
    } catch {
        // Not available here. Storage stays evictable, which is where it was.
        return undefined;
    }
}

export type StorageUse = { used: number; quota: number; persisted: boolean };

/** What is stored and what the browser will allow, for the offline dialog. */
export async function storageUse(): Promise<StorageUse | undefined> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
        return undefined;
    }
    try {
        const { usage, quota } = await navigator.storage.estimate();
        return {
            used: usage ?? 0,
            quota: quota ?? 0,
            persisted: (await navigator.storage.persisted?.()) ?? false,
        };
    } catch {
        return undefined;
    }
}
