import { base } from '$app/paths';
import { defaultLanguage, languages } from '$lib/languages';
import { getURLForLanguage } from '$lib/utils';

// Where this copy of the app actually lives. The upstream project bakes
// gpx.studio into every card, which on a fork means a pasted link previews with
// somebody else's name and somebody else's logo.
const SITE = 'https://gpx-studio2.pages.dev';

export async function handle({ event, resolve }) {
    const language = event.params.language ?? defaultLanguage;
    const strings = await import(`./locales/${language}.json`);

    const path = event.url.pathname;
    const page = event.route.id?.replace('/[[language]]', '').split('/')[1] ?? 'home';

    let title = strings.metadata[`${page}_title`];
    const description = strings.metadata[`description`];

    if (page === 'help' && event.params.guide) {
        const [guide, subguide] = event.params.guide.split('/');
        // English stands in for a guide this build added and has not
        // translated; a missing one must not fail the page.
        const loadGuide = (lang) =>
            subguide
                ? import(`./lib/docs/${lang}/${guide}/${subguide}.mdx`)
                : import(`./lib/docs/${lang}/${guide}.mdx`);
        const guideModule = await loadGuide(language).catch(() => loadGuide('en'));
        title = `${title} | ${guideModule.metadata.title}`;
    }

    const htmlTag = `<html lang="${language}" translate="no">`;

    let headTag = `<head>
    <title>快到了</title>
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "快到了",
        "url": "${SITE}"
    }
    </script>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="快到了" />
    <meta property="og:description" content="${description}" />
    <meta name="twitter:title" content="快到了" />
    <meta name="twitter:description" content="${description}" />
    <meta property="og:image" content="${SITE}${base}/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${SITE}${path}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="快到了" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${SITE}${base}/og.png" />
    <meta name="twitter:url" content="${SITE}${path}" />
    <link rel="alternate" hreflang="x-default" href="https://gpx.studio${getURLForLanguage('en', path)}" />
    <link rel="manifest" href="${base}/${language}.manifest.webmanifest" />`;

    if (page !== '404') {
        for (let lang of Object.keys(languages)) {
            headTag += `   <link rel="alternate" hreflang="${lang}" href="https://gpx.studio${getURLForLanguage(lang, path)}" />
`;
        }
    }

    const response = await resolve(event, {
        transformPageChunk: ({ html }) =>
            html.replace('<html>', htmlTag).replace('<head>', headTag),
        // No modulepreload hints for the scripts. The service worker answers
        // those requests from its own cache, and a preload fetched in the
        // page's world cannot be matched to a response from the worker's: the
        // browser discards all ninety of them and says so twice each. The
        // stylesheets keep theirs — nothing renders until they land.
        preload: ({ type }) => type === 'css' || type === 'font',
    });

    return response;
}
