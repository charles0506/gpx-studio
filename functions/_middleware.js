// Cloudflare Pages middleware: give a shared link a preview card.
//
// The app is a static page, so every link into it carries the same head. That
// is fine for the app and useless for a share: pasted into a chat, a route link
// should say which route, how far, how much up, and show the shape of it.
//
// The person who made the share never sees any of this — their browser runs the
// app and the app sets its own title. This is only for the crawlers that fetch
// a pasted link, which do not run scripts, and so have to be told in the HTML.

const PREFIX = 'share/';
const ID = /^[A-Za-z0-9_-]{16,64}$/;

function escapeAttribute(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** The name and route count, without dragging the whole bundle out of storage. */
async function summaryOf(env, id) {
    if (env.SYNC_KV) {
        const listed = await env.SYNC_KV.list({ prefix: PREFIX + id, limit: 1 });
        const key = listed.keys.find((candidate) => candidate.name === PREFIX + id);
        return key ? (key.metadata ?? {}) : undefined;
    }
    if (env.SYNC_BUCKET) {
        const object = await env.SYNC_BUCKET.head(PREFIX + id);
        return object ? (object.customMetadata ?? {}) : undefined;
    }
    return undefined;
}

export async function onRequest({ request, next, env }) {
    const url = new URL(request.url);
    const id = url.searchParams.get('share');
    // Everything else on the site — the app itself, the API, every asset —
    // leaves here immediately.
    if (id === null || !ID.test(id)) {
        return next();
    }

    const response = await next();
    if (!(response.headers.get('Content-Type') ?? '').includes('text/html')) {
        return response;
    }

    const summary = await summaryOf(env, id);
    if (summary === undefined) {
        // A link to a share that has expired or been deleted still opens the
        // app; it just does not pretend to be a route.
        return response;
    }

    const name = summary.name || '路線分享';
    const routes = Number(summary.routes ?? 1);
    // What somebody actually wants to know from a link in a chat: how far, and
    // how much climbing. The route count only earns its place when there is
    // more than one.
    const parts = [];
    if (routes > 1) parts.push(`${routes} 條路線`);
    if (summary.km) parts.push(`${summary.km} km`);
    if (summary.ascent) parts.push(`↗ ${summary.ascent} m`);
    const description = parts.length > 0 ? parts.join(' · ') : '點連結直接開啟';
    const image = `${url.origin}/api/share-image?id=${id}`;

    const tags = [
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="快到了">`,
        `<meta property="og:title" content="${escapeAttribute(name)}">`,
        `<meta property="og:description" content="${escapeAttribute(description)}">`,
        `<meta property="og:url" content="${escapeAttribute(url.href)}">`,
        `<meta name="description" content="${escapeAttribute(description)}">`,
    ];
    // Only claim a picture when there is one: a card pointing at a missing
    // image looks more broken than a card with no image at all.
    if (summary.image === '1') {
        tags.push(
            `<meta property="og:image" content="${escapeAttribute(image)}">`,
            `<meta property="og:image:type" content="image/png">`,
            `<meta property="og:image:width" content="1200">`,
            `<meta property="og:image:height" content="630">`,
            `<meta property="og:image:alt" content="${escapeAttribute(name)}">`,
            `<meta name="twitter:card" content="summary_large_image">`,
            `<meta name="twitter:image" content="${escapeAttribute(image)}">`
        );
    } else {
        tags.push(`<meta name="twitter:card" content="summary">`);
    }
    tags.push(
        `<meta name="twitter:title" content="${escapeAttribute(name)}">`,
        `<meta name="twitter:description" content="${escapeAttribute(description)}">`
    );

    return (
        new HTMLRewriter()
            // The page is prerendered with the site's own card in it. Crawlers
            // read the first tag they find, so the site's has to go before the
            // share's is added — appending would leave the app's name and logo
            // winning over the route's.
            .on('meta', {
                element(element) {
                    const key =
                        element.getAttribute('property') ?? element.getAttribute('name') ?? '';
                    if (
                        key.startsWith('og:') ||
                        key.startsWith('twitter:') ||
                        key === 'description'
                    ) {
                        element.remove();
                    }
                },
            })
            .on('title', {
                element(element) {
                    element.setInnerContent(name);
                },
            })
            .on('head', {
                element(element) {
                    element.append(tags.join(''), { html: true });
                },
            })
            .transform(response)
    );
}
