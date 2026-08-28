function getModule(language: string | undefined, guide: string) {
    language = language ?? 'en';
    let subguide = undefined;
    if (guide.includes('/')) {
        [guide, subguide] = guide.split('/');
    }
    // Guides this build adds are not translated into all thirty-four
    // languages. A language without one falls back to English rather than
    // taking the whole help section down with it.
    const load = (lang: string) =>
        subguide
            ? import(`./../../../../lib/docs/${lang}/${guide}/${subguide}.mdx`)
            : import(`./../../../../lib/docs/${lang}/${guide}.mdx`);
    return load(language).catch(() => load('en'));
}

export async function load({ params }) {
    const { guide, language } = params;

    const guideModule = await getModule(language, guide);

    return {
        guideModule,
    };
}
