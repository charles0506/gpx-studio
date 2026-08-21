// Cloudflare Pages Function.
//
// overpass-api.de answers browser requests with 406 and no CORS headers when
// the Origin or Referer sits on a *.pages.dev host, so the deployed site
// cannot query it directly. Proxying through this Function works because the
// server-to-server request carries neither header, and the response reaches
// the page as same-origin.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'gpx-studio-selfhost (+https://github.com/charles0506/gpx-studio)';

async function proxy(query) {
    const upstream = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            // Without a User-Agent overpass-api.de answers 406, and the Workers
            // runtime does not set one by itself.
            'User-Agent': USER_AGENT,
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
    const url = new URL(request.url);

    // Diagnostic: report which headers the upstream actually receives, so a
    // deployment can be told apart from the one before it.
    if (url.searchParams.has('ping')) {
        const echo = await fetch('https://httpbin.org/headers', {
            headers: { 'User-Agent': USER_AGENT },
        });
        const seen = echo.ok ? await echo.json() : { error: echo.status };
        return Response.json({ version: 2, userAgent: USER_AGENT, seen });
    }

    const query = url.searchParams.get('data');
    if (!query) {
        return new Response('missing "data" query parameter', { status: 400 });
    }
    return proxy(query);
}

export async function onRequestPost({ request }) {
    return proxy(await request.text());
}
