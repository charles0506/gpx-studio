// Cloudflare Pages Function: put map tiles into this site's own store.
//
// The tiles are drawn on a computer at home and there are a great many of
// them. Sent through Cloudflare's management API they are held to twelve
// hundred requests in five minutes, which makes a hundred and eighty thousand
// tiles half a day's work; sent here they are written through the binding,
// forty to a request.
//
// Guarded by a secret of its own rather than the passphrase the app uses: this
// is a way to write to the map everybody sees, and it should not open with a
// phrase that is typed into phones.
//
// The body is tiles end to end, each as
//   2 bytes  length of the key
//   n bytes  the key, "rudy/z/x/y.png"
//   4 bytes  length of the image
//   n bytes  the image

const KEY = /^rudy\/\d{1,2}\/\d{1,8}\/\d{1,8}\.png$/;
// A binding call counts as a subrequest, and a request is allowed fifty.
const MOST = 45;
const PNG = [0x89, 0x50, 0x4e, 0x47];

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

// Compare in a way that does not leak how much of the secret was right.
function matches(provided, expected) {
    if (typeof provided !== 'string' || provided.length !== expected.length) {
        return false;
    }
    let difference = 0;
    for (let i = 0; i < expected.length; i++) {
        difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return difference === 0;
}

export async function onRequestPost({ request, env }) {
    if (!env.TILES_UPLOAD_SECRET || !env.TILES) {
        return json({ error: 'uploads are not configured' }, 503);
    }
    const header = request.headers.get('Authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!matches(provided, env.TILES_UPLOAD_SECRET)) {
        return json({ error: 'not allowed' }, 401);
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const decoder = new TextDecoder();
    const tiles = [];
    let at = 0;
    while (at < bytes.length) {
        if (at + 2 > bytes.length) return json({ error: 'cut short' }, 400);
        const keyLength = view.getUint16(at);
        at += 2;
        if (at + keyLength + 4 > bytes.length) return json({ error: 'cut short' }, 400);
        const key = decoder.decode(bytes.subarray(at, at + keyLength));
        at += keyLength;
        const length = view.getUint32(at);
        at += 4;
        if (at + length > bytes.length) return json({ error: 'cut short' }, 400);
        const image = bytes.subarray(at, at + length);
        at += length;

        if (!KEY.test(key)) return json({ error: `bad key ${key.slice(0, 40)}` }, 400);
        if (PNG.some((byte, index) => image[index] !== byte)) {
            return json({ error: `not a PNG: ${key}` }, 400);
        }
        tiles.push([key, image]);
        if (tiles.length > MOST) return json({ error: `more than ${MOST} tiles` }, 413);
    }

    await Promise.all(
        tiles.map(([key, image]) =>
            env.TILES.put(key, image, {
                httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=604800' },
            })
        )
    );
    return json({ stored: tiles.length });
}
