// Cloudflare Pages Function: 魯地圖 tiles, from this site's own store first.
//
// The map is drawn by somebody else's server, one tile at a time, on request.
// When that server cannot draw — and it has spent days answering 502 to every
// tile not already in its cache — the map does not go blank, it goes soft:
// the level above is stretched to fit, and a route downloaded for offline use
// is a blur at exactly the zoom it was downloaded for.
//
// The tiles for the routes that matter are therefore drawn ahead of time, from
// the same map file with the same style, and kept in R2. This looks there
// first. Anything not there is passed on to the usual server exactly as
// before, by redirect, so the browser is still the one asking and nothing
// about that server's traffic changes.

const UPSTREAM = 'https://tile.happyman.idv.tw/map/rudy';

function whole(value, max) {
    if (!/^\d{1,8}$/.test(value)) {
        return undefined;
    }
    const number = Number(value);
    return number <= max ? number : undefined;
}

export async function onRequestGet({ params, env }) {
    const z = whole(String(params.z), 22);
    const x = whole(String(params.x), 2 ** 22);
    const y = whole(String(params.y).replace(/\.png$/, ''), 2 ** 22);
    if (z === undefined || x === undefined || y === undefined) {
        return new Response('bad tile', { status: 400 });
    }

    if (env.TILES) {
        const stored = await env.TILES.get(`rudy/${z}/${x}/${y}.png`);
        if (stored) {
            return new Response(stored.body, {
                headers: {
                    'Content-Type': 'image/png',
                    // A week. They are redrawn when the map file is, which is
                    // weekly, and a trail that moved is worth seeing move.
                    'Cache-Control': 'public, max-age=604800',
                    'Access-Control-Allow-Origin': '*',
                    'X-Tile-Source': 'own',
                },
            });
        }
    }

    return new Response(null, {
        status: 302,
        headers: {
            Location: `${UPSTREAM}/${z}/${x}/${y}.png`,
            // Not remembered: a tile that is not here today may be tomorrow.
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'X-Tile-Source': 'upstream',
        },
    });
}
