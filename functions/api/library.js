// Cloudflare Pages Function: a shelf of routes, one object each.
//
// The workspace sync in sync.js keeps a whole desk — every file open at once,
// replaced wholesale. This is the other half of the same idea: routes kept one
// per object so that a phone on the trail can take down the one it needs and
// leave the rest where they are.
//
// Same passphrase, same store, no accounts. The helpers are copied rather than
// shared because sync.js works, and reaching into it to refactor would put that
// at risk for the sake of thirty lines.

const PREFIX = 'library/';
// One route. A day's GPX with elevation is a few hundred kilobytes at most.
const MAX_BYTES = 8 * 1024 * 1024;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

// Compare in a way that does not leak how much of the passphrase was right.
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

// Ids come from the browser and end up in a storage key, so they are held to
// something that cannot climb out of the prefix.
function routeId(request) {
    const id = new URL(request.url).searchParams.get('id');
    if (id === null) {
        return undefined;
    }
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export async function onRequestGet({ request, env }) {
    const denied = authorise(request, env);
    if (denied) return denied;

    const id = routeId(request);
    if (id === null) return json({ error: 'bad id' }, 400);

    // No id: the shelf itself, which is names and figures rather than routes.
    if (id === undefined) {
        if (env.SYNC_KV) {
            const listed = await env.SYNC_KV.list({ prefix: PREFIX });
            return json({
                routes: listed.keys.map((key) => ({
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
            routes: listed.objects.map((object) => ({
                id: object.key.slice(PREFIX.length),
                ...(object.customMetadata ?? {}),
            })),
        });
    }

    if (env.SYNC_KV) {
        const stored = await env.SYNC_KV.get(PREFIX + id);
        return stored === null
            ? json({ error: 'no such route' }, 404)
            : new Response(stored, {
                  headers: {
                      'Content-Type': 'application/json; charset=utf-8',
                      'Cache-Control': 'no-store',
                  },
              });
    }

    const object = await env.SYNC_BUCKET.get(PREFIX + id);
    if (!object) return json({ error: 'no such route' }, 404);
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

    const id = routeId(request);
    if (!id) return json({ error: 'an id is required' }, 400);

    const body = await request.text();
    if (body.length > MAX_BYTES) {
        return json({ error: `route is larger than ${MAX_BYTES} bytes` }, 413);
    }

    let payload;
    try {
        payload = JSON.parse(body);
    } catch (error) {
        return json({ error: 'body is not valid JSON' }, 400);
    }
    if (typeof payload?.gpx !== 'string' || typeof payload?.name !== 'string') {
        return json({ error: 'expected { name, gpx, km, ascent }' }, 400);
    }

    const updatedAt = new Date().toISOString();
    // Kept beside the object rather than inside it, so that listing the shelf
    // does not mean reading every route on it.
    const metadata = {
        name: payload.name.slice(0, 200),
        km: String(payload.km ?? ''),
        ascent: String(payload.ascent ?? ''),
        updatedAt,
    };
    const stored = JSON.stringify({ id, name: metadata.name, gpx: payload.gpx, updatedAt });

    if (env.SYNC_KV) {
        await env.SYNC_KV.put(PREFIX + id, stored, { metadata });
    } else {
        await env.SYNC_BUCKET.put(PREFIX + id, stored, {
            httpMetadata: { contentType: 'application/json; charset=utf-8' },
            customMetadata: metadata,
        });
    }

    return json({ id, updatedAt });
}

export async function onRequestDelete({ request, env }) {
    const denied = authorise(request, env);
    if (denied) return denied;

    const id = routeId(request);
    if (!id) return json({ error: 'an id is required' }, 400);

    if (env.SYNC_KV) {
        await env.SYNC_KV.delete(PREFIX + id);
    } else {
        await env.SYNC_BUCKET.delete(PREFIX + id);
    }
    return json({ deleted: true });
}
