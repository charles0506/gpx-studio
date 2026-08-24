// Cloudflare Pages Function: keep one workspace of GPX files in Cloudflare
// storage so that the same routes are available on the phone and on the
// desktop.
//
// Either binding works. KV needs no payment details, which R2 does even on its
// free tier, so KV is the one to reach for first; R2 is accepted because it is
// the better fit if the workspace ever grows past what KV will hold.
//
// There are no accounts. A single passphrase, held in the SYNC_SECRET
// environment variable, guards the store — enough for one person syncing their
// own devices, and nothing more is pretended.
const OBJECT_KEY = 'workspace.json';

// The KV value ceiling. A workspace of routes is nowhere near it, and the whole
// thing is stored as one object rather than one per file.
const MAX_BYTES = 25 * 1024 * 1024;

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

export async function onRequestGet({ request, env }) {
    const denied = authorise(request, env);
    if (denied) return denied;

    if (env.SYNC_KV) {
        const stored = await env.SYNC_KV.get(OBJECT_KEY);
        return stored === null
            ? json({ files: [], updatedAt: null })
            : new Response(stored, {
                  headers: {
                      'Content-Type': 'application/json; charset=utf-8',
                      'Cache-Control': 'no-store',
                  },
              });
    }

    const object = await env.SYNC_BUCKET.get(OBJECT_KEY);
    if (!object) {
        return json({ files: [], updatedAt: null });
    }

    return new Response(object.body, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ETag: object.httpEtag,
        },
    });
}

export async function onRequestPut({ request, env }) {
    const denied = authorise(request, env);
    if (denied) return denied;

    const body = await request.text();
    if (body.length > MAX_BYTES) {
        return json({ error: `workspace is larger than ${MAX_BYTES} bytes` }, 413);
    }

    let payload;
    try {
        payload = JSON.parse(body);
    } catch (error) {
        return json({ error: 'body is not valid JSON' }, 400);
    }
    if (!Array.isArray(payload?.files)) {
        return json({ error: 'expected { files: [{ name, gpx }] }' }, 400);
    }

    const stored = JSON.stringify({
        files: payload.files,
        updatedAt: new Date().toISOString(),
    });

    if (env.SYNC_KV) {
        await env.SYNC_KV.put(OBJECT_KEY, stored);
    } else {
        await env.SYNC_BUCKET.put(OBJECT_KEY, stored, {
            httpMetadata: { contentType: 'application/json; charset=utf-8' },
        });
    }

    return json({ files: payload.files.length, updatedAt: JSON.parse(stored).updatedAt });
}

export async function onRequestDelete({ request, env }) {
    const denied = authorise(request, env);
    if (denied) return denied;

    if (env.SYNC_KV) {
        await env.SYNC_KV.delete(OBJECT_KEY);
    } else {
        await env.SYNC_BUCKET.delete(OBJECT_KEY);
    }
    return json({ deleted: true });
}
