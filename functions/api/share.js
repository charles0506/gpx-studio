// Cloudflare Pages Function: a bundle of routes and settings behind a link
// that needs no passphrase to open.
//
// Reading is deliberately unauthenticated: the point of a share is to hand
// someone a link and have it work. The id is the secret, in the way a Google
// Docs link is the secret — twenty-two random characters, never listed to
// anyone who cannot already prove they own the store.
//
// Writing is not. Creating and deleting need the same passphrase as everything
// else here, so nobody can fill the store with their own bundles or replace
// yours with something else.

const PREFIX = 'share/';
// The preview card lives beside the bundle rather than inside it, so that a
// crawler asking for the picture does not drag every track point along with it.
const IMAGE_PREFIX = 'shareimg/';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// Routes and a page of settings. Well over what a day out weighs.
const MAX_BYTES = 8 * 1024 * 1024;
// A share is for a walk that is about to happen, not an archive.
const TTL_SECONDS = 90 * 24 * 60 * 60;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

function secretMatches(provided, expected) {
    if (typeof provided !== 'string' || provided.length !== expected.length) {
        return false;
    }
    let difference = 0;
    for (let i = 0; i < expected.length; i++) {
        difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return difference === 0;
}

function authorise(request, env) {
    if (!env.SYNC_SECRET) {
        return json({ error: 'SYNC_SECRET is not configured' }, 503);
    }
    if (!env.SYNC_KV && !env.SYNC_BUCKET) {
        return json({ error: 'neither SYNC_KV nor SYNC_BUCKET is bound' }, 503);
    }

    const header = request.headers.get('Authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!secretMatches(provided, env.SYNC_SECRET)) {
        return json({ error: 'wrong passphrase' }, 401);
    }

    return undefined;
}

// The id reaches a storage key, so it is held to something that cannot climb
// out of the prefix, and to a length that cannot be guessed.
function shareId(request) {
    const id = new URL(request.url).searchParams.get('id');
    if (id === null) {
        return undefined;
    }
    return /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}

export async function onRequestGet({ request, env }) {
    if (!env.SYNC_KV && !env.SYNC_BUCKET) {
        return json({ error: 'neither SYNC_KV nor SYNC_BUCKET is bound' }, 503);
    }

    const id = shareId(request);
    if (id === null) return json({ error: 'bad id' }, 400);

    // Listing is the owner's business: it is the one thing here that would let
    // somebody find shares they were never given.
    if (id === undefined) {
        const denied = authorise(request, env);
        if (denied) return denied;

        if (env.SYNC_KV) {
            const listed = await env.SYNC_KV.list({ prefix: PREFIX });
            return json({
                shares: listed.keys.map((key) => ({
                    id: key.name.slice(PREFIX.length),
                    ...(key.metadata ?? {}),
                })),
            });
        }
        const listed = await env.SYNC_BUCKET.list({
            prefix: PREFIX,
            include: ['customMetadata'],
        });
        return json({
            shares: listed.objects.map((object) => ({
                id: object.key.slice(PREFIX.length),
                ...(object.customMetadata ?? {}),
            })),
        });
    }

    if (env.SYNC_KV) {
        const stored = await env.SYNC_KV.get(PREFIX + id);
        return stored === null
            ? json({ error: 'no such share' }, 404)
            : new Response(stored, {
                  headers: {
                      'Content-Type': 'application/json; charset=utf-8',
                      'Cache-Control': 'no-store',
                  },
              });
    }

    const object = await env.SYNC_BUCKET.get(PREFIX + id);
    if (!object) return json({ error: 'no such share' }, 404);
    return new Response(object.body, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

export async function onRequestPut({ request, env }) {
    const denied = authorise(request, env);
    if (denied) return denied;

    const id = shareId(request);
    if (!id) return json({ error: 'an id of 16 to 64 characters is required' }, 400);

    const body = await request.text();
    if (body.length > MAX_BYTES) {
        return json({ error: `share is larger than ${MAX_BYTES} bytes` }, 413);
    }

    let payload;
    try {
        payload = JSON.parse(body);
    } catch (error) {
        return json({ error: 'body is not valid JSON' }, 400);
    }
    if (!Array.isArray(payload?.routes) || payload.routes.length === 0) {
        return json({ error: 'expected { name, routes: [{ name, gpx }], settings }' }, 400);
    }

    // A data URL for the preview card, decoded here so that what is stored is
    // an image and can be served as one.
    let image;
    if (typeof payload.image === 'string' && payload.image.startsWith('data:image/png;base64,')) {
        try {
            const binary = atob(payload.image.slice('data:image/png;base64,'.length));
            if (binary.length <= MAX_IMAGE_BYTES) {
                image = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    image[i] = binary.charCodeAt(i);
                }
            }
        } catch (error) {
            // A card that will not decode is not a reason to lose the routes.
            image = undefined;
        }
    }

    const createdAt = new Date().toISOString();
    const metadata = {
        name: String(payload.name ?? '').slice(0, 200),
        routes: String(payload.routes.length),
        image: image ? '1' : '',
        km: String(payload.km ?? '').slice(0, 10),
        ascent: String(payload.ascent ?? '').slice(0, 10),
        createdAt,
    };
    const stored = JSON.stringify({
        name: metadata.name,
        routes: payload.routes,
        settings: payload.settings && typeof payload.settings === 'object' ? payload.settings : {},
        createdAt,
    });

    if (env.SYNC_KV) {
        await env.SYNC_KV.put(PREFIX + id, stored, {
            metadata,
            expirationTtl: TTL_SECONDS,
        });
        if (image) {
            await env.SYNC_KV.put(IMAGE_PREFIX + id, image, { expirationTtl: TTL_SECONDS });
        }
    } else {
        await env.SYNC_BUCKET.put(PREFIX + id, stored, {
            httpMetadata: { contentType: 'application/json; charset=utf-8' },
            customMetadata: metadata,
        });
        if (image) {
            await env.SYNC_BUCKET.put(IMAGE_PREFIX + id, image, {
                httpMetadata: { contentType: 'image/png' },
            });
        }
    }

    return json({ id, createdAt });
}

export async function onRequestDelete({ request, env }) {
    const denied = authorise(request, env);
    if (denied) return denied;

    const id = shareId(request);
    if (!id) return json({ error: 'an id is required' }, 400);

    if (env.SYNC_KV) {
        await env.SYNC_KV.delete(PREFIX + id);
        await env.SYNC_KV.delete(IMAGE_PREFIX + id);
    } else {
        await env.SYNC_BUCKET.delete(PREFIX + id);
        await env.SYNC_BUCKET.delete(IMAGE_PREFIX + id);
    }
    return json({ deleted: true });
}
