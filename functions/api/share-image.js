// Cloudflare Pages Function: the preview card for a shared link.
//
// Chat apps and social sites fetch this with no cookies and no headers worth
// speaking of, so like reading the share itself it is unauthenticated: the id
// is the secret. It never lists, so a card can only be fetched by somebody who
// was given the link.

const IMAGE_PREFIX = 'shareimg/';

function notFound() {
    return new Response('', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

// A card is drawn once and never changes; a new share gets a new id. So it can
// be cached hard, which matters when four different chat apps fetch it at once.
const HEADERS = {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=31536000, immutable',
};

export async function onRequestGet({ request, env }) {
    if (!env.SYNC_KV && !env.SYNC_BUCKET) {
        return notFound();
    }

    const id = new URL(request.url).searchParams.get('id');
    if (id === null || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
        return notFound();
    }

    if (env.SYNC_KV) {
        const stored = await env.SYNC_KV.get(IMAGE_PREFIX + id, 'arrayBuffer');
        return stored === null ? notFound() : new Response(stored, { headers: HEADERS });
    }

    const object = await env.SYNC_BUCKET.get(IMAGE_PREFIX + id);
    return object ? new Response(object.body, { headers: HEADERS }) : notFound();
}
