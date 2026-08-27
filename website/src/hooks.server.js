import { base } from '$app/paths';
import { defaultLanguage, languages } from '$lib/languages';
import { getURLForLanguage } from '$lib/utils';

export async function handle({ event, resolve }) {
    const language = event.params.language ?? defaultLanguage;
    const strings = await import(`./locales/${language}.json`);

    const path = event.url.pathname;
    const page = event.route.id?.replace('/[[language]]', '').split('/')[1] ?? 'home';

    let title = strings.metadata[`${page}_title`];
    const description = strings.metadata[`description`];

    if (page === 'help' && event.params.guide) {
        const [guide, subguide] = event.params.guide.split('/');
        const guideModule = subguide
            ? await import(`./lib/docs/${language}/${guide}/${subguide}.mdx`)
            : await import(`./lib/docs/${language}/${guide}.mdx`);
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
        "url": "https://gpx.studio"
    }
    </script>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="快到了" />
    <meta property="og:description" content="${description}" />
    <meta name="twitter:title" content="快到了" />
    <meta name="twitter:description" content="${description}" />
    <meta property="og:image" content="https://gpx.studio${base}/og_logo.png" />
    <meta property="og:url" content="https://gpx.studio/" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="快到了" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="https://gpx.studio${base}/og_logo.png" />
    <meta name="twitter:url" content="https://gpx.studio/" />
    <meta name="twitter:site" content="@gpxstudio" />
    <meta name="twitter:creator" content="@gpxstudio" />
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
