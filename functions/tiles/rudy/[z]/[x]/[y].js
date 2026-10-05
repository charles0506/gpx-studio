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

function whole(value, max) {
    if (!/^\d{1,8}$/.test(value)) {
        return undefined;
    }
    const number = Number(value);
    return number <= max ? number : undefined;
}

function image(body, source) {
    return new Response(body, {
        headers: {
            'Content-Type': 'image/png',
            // A week. The map is redrawn weekly, and a trail that moved is
            // worth seeing move.
            'Cache-Control': 'public, max-age=604800',
            'Access-Control-Allow-Origin': '*',
            'X-Tile-Source': source,
        },
    });
}

export async function onRequestGet({ params, env }) {
    const z = whole(String(params.z), 22);
    const x = whole(String(params.x), 2 ** 22);
    const y = whole(String(params.y).replace(/\.png$/, ''), 2 ** 22);
    if (z === undefined || x === undefined || y === undefined) {
        return new Response('bad tile', { status: 400 });
    }

    try {
        const live = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, {
            signal: AbortSignal.timeout(PATIENCE_MS),
        });
        // An error page arrives with a 200 often enough to be worth checking
        // that what came back is a picture.
        if (live.ok && (live.headers.get('Content-Type') ?? '').startsWith('image/')) {
            return image(live.body, 'upstream');
        }
    } catch {
        // Timed out or unreachable: the same as being refused.
    }

    if (env.TILES) {
        const stored = await env.TILES.get(`rudy/${z}/${x}/${y}.png`);
        if (stored) {
            return image(stored.body, 'own');
        }
    }

    return new Response('no tile', {
        status: 502,
        headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
}
