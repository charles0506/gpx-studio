// Cloudflare Pages Function: 魯地圖 tiles, with a copy of our own to fall back on.
//
// The map is drawn by somebody else's server, tile by tile, on request, and it
// is the real thing: redrawn every week, at every zoom, for the whole island.
// So that server is asked first, and what it sends is what is shown.
//
// It is not always able to answer. It has spent days at a time returning 502
// for every tile not already in its cache, and when that happens the map does
// not go blank, it goes soft — the level above is stretched to fit, and a route
// downloaded for offline use is a blur at exactly the zoom it was downloaded
// for. For those times there is a second copy: tiles drawn ahead of time from
// the same map file with the same style, kept in R2. They are older than the
// live map by however long it is since they were drawn, which is why they come
// second, and they are a great deal better than a blur.
//
// The asking is done from here rather than by redirecting the browser, because
// a redirect cannot be taken back: once the browser has been sent to the other
// server and been refused, there is nowhere for it to go next.

const UPSTREAM = 'https://tile.happyman.idv.tw/map/rudy';
// Long enough for a tile that has to be drawn; short enough that a server
// which is not going to answer does not hold the whole map up while it fails.
const PATIENCE_MS = 6000;

// Kept at the edge so that a tile fetched for one phone does not make the other
// wait, or ask that server, or read R2 again. A tile from the live map for as
// long as that server itself says its tiles are good for. One of ours for an
// hour: it is the stand-in, and when the live map comes back it should take over
// promptly rather than a week later.
const LIVE_SECONDS = 3 * 24 * 60 * 60;
const OWN_SECONDS = 60 * 60;

function whole(value, max) {
    if (!/^\d{1,8}$/.test(value)) {
        return undefined;
    }
    const number = Number(value);
    return number <= max ? number : undefined;
}

function image(body, source, seconds) {
    return new Response(body, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': `public, max-age=${seconds}`,
            'Access-Control-Allow-Origin': '*',
            'X-Tile-Source': source,
        },
    });
}

export async function onRequestGet({ params, env, request, waitUntil }) {
    const z = whole(String(params.z), 22);
    const x = whole(String(params.x), 2 ** 22);
    const y = whole(String(params.y).replace(/\.png$/, ''), 2 ** 22);
    if (z === undefined || x === undefined || y === undefined) {
        return new Response('bad tile', { status: 400 });
    }

    const edge = caches.default;
    const key = new Request(new URL(request.url).origin + `/tiles/rudy/${z}/${x}/${y}.png`);
    const kept = await edge.match(key);
    if (kept) {
        const answer = new Response(kept.body, kept);
        answer.headers.set('X-Tile-Cache', 'hit');
        return answer;
    }

    let answer = undefined;
    try {
        const live = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, {
            signal: AbortSignal.timeout(PATIENCE_MS),
        });
        // An error page arrives with a 200 often enough to be worth checking
        // that what came back is a picture.
        if (live.ok && (live.headers.get('Content-Type') ?? '').startsWith('image/')) {
            answer = image(live.body, 'upstream', LIVE_SECONDS);
        }
    } catch {
        // Timed out or unreachable: the same as being refused.
    }

    if (!answer && env.TILES) {
        const stored = await env.TILES.get(`rudy/${z}/${x}/${y}.png`);
        if (stored) {
            answer = image(stored.body, 'own', OWN_SECONDS);
        }
    }

    if (!answer) {
        return new Response('no tile', {
            status: 502,
            headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
        });
    }

    waitUntil(edge.put(key, answer.clone()));
    answer.headers.set('X-Tile-Cache', 'miss');
    return answer;
}
