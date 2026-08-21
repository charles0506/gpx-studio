// Cloudflare Pages Function.
//
// overpass-api.de answers browser requests with 406 and no CORS headers when
// the Origin or Referer sits on a *.pages.dev host, so the deployed site
// cannot query it directly. Proxying through this Function works because the
// server-to-server request carries neither header, and the response reaches
// the page as same-origin.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function proxy(query) {
    const upstream = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            // Without a User-Agent overpass-api.de answers 406, and the Workers
            // runtime does not set one by itself.
            'User-Agent': 'gpx-studio-selfhost (+https://github.com/charles0506/gpx-studio)',
        },
        body: query,
    });

    return new Response(upstream.body, {
        status: upstream.status,
        headers: {
            'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
            'Cache-Control': 'public, max-age=3600',
        },
    });
}

export async function onRequestGet({ request }) {
    const query = new URL(request.url).searchParams.get('data');
    if (!query) {
        return new Response('missing "data" query parameter', { status: 400 });
    }
    return proxy(query);
}

export async function onRequestPost({ request }) {
    return proxy(await request.text());
}
