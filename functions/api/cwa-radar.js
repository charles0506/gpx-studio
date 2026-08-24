// Cloudflare Pages Function: the CWA rain radar image.
//
// www.cwa.gov.tw serves the image without CORS headers, so the browser cannot
// fetch it directly the way it can the S3-hosted radar composite. Proxying
// makes it same-origin for the page.
//
// This is the product behind OBS_Radar_rain, refreshed roughly every 90
// seconds — the plain reflectivity composite only moves every ten minutes,
// which is too slow to watch a squall line approach.
const IMAGE_URL = 'https://www.cwa.gov.tw/Data/radar_rain/CV1_RCSL_3600/CV1_RCSL_3600.png';

// Shorter than the publishing interval, so a new scan is never more than a
// minute stale, and long enough that panning the map does not refetch 2 MB.
const CACHE_SECONDS = 60;

export async function onRequestGet() {
    const upstream = await fetch(IMAGE_URL, {
        headers: {
            // The site answers 403 to a request without a browser-shaped
            // User-Agent.
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36',
            Referer: 'https://www.cwa.gov.tw/V8/C/W/OBS_Radar_rain.html',
        },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    }).catch(() => null);

    if (!upstream || !upstream.ok) {
        return new Response('radar image unavailable', {
            status: upstream ? upstream.status : 502,
        });
    }

    return new Response(upstream.body, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
            'Last-Modified': upstream.headers.get('Last-Modified') ?? new Date().toUTCString(),
        },
    });
}
