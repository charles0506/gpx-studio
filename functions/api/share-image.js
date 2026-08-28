// Cloudflare Pages Function: the preview card for a shared link.
//
// Chat apps and social sites fetch this with no cookies and no headers worth
// speaking of, so like reading the share itself it is unauthenticated: the id
// is the secret. It never lists, so a card can only be fetched by somebody who
// was given the link.

const IMAGE_PREFIX = 'shareimg/';

// A card is drawn once and never changes; a new share gets a new id. So it can
// be cached hard, which matters when four different chat apps fetch it at once.
const HEADERS = {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=31536000, immutable',
};

// A share made before the cards existed, or one whose picture would not draw,
// still gets a picture: the site's own. A preview with a card on it beats a
// preview that is a bare line of text, and the alternative here is nothing.
async function fallback(request) {
    try {
        const response = await fetch(new URL('/og.png', request.url));
        if (response.ok) {
            return new Response(response.body, { headers: HEADERS });
        }
    } catch (error) {
        // Nothing to fall back to; say so plainly below.
    }
    return new Response('', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestGet({ request, env }) {
    if (!env.SYNC_KV && !env.SYNC_BUCKET) {
        return fallback(request);
    }

    const id = new URL(request.url).searchParams.get('id');
    if (id === null || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
        return fallback(request);
    }

    if (env.SYNC_KV) {
        const stored = await env.SYNC_KV.get(IMAGE_PREFIX + id, 'arrayBuffer');
        return stored === null ? fallback(request) : new Response(stored, { headers: HEADERS });
    }

    const object = await env.SYNC_BUCKET.get(IMAGE_PREFIX + id);
    return object ? new Response(object.body, { headers: HEADERS }) : fallback(request);
}
