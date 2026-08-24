// The Central Weather Administration publishes its radar composite as a single
// PNG at a fixed URL, overwritten in place roughly every ten minutes. Nothing
// in the URL changes between scans, so a cache-buster is the only way to pick a
// new one up — hence the placeholder in the overlay definition.
export const cwaRadarStampPlaceholder = 'CWA_RADAR_STAMP';

export const cwaRadarSource = 'cwaRadar';

export const cwaRadarRefreshInterval = 5 * 60 * 1000;

/**
 * Replace the cache-buster placeholder in an image source, in place. Returns
 * the resolved URL when the style carries one, and undefined otherwise.
 */
export function applyCwaRadarStamp(style: any): string | undefined {
    const source = style?.sources?.[cwaRadarSource];
    if (typeof source?.url !== 'string' || !source.url.includes(cwaRadarStampPlaceholder)) {
        return undefined;
    }
    source.url = source.url.replace(cwaRadarStampPlaceholder, String(Date.now()));
    return source.url;
}
