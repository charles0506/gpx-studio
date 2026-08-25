import fs from 'fs';
import { defaultLanguage, languages } from '../languages';

function localizeManifest(manifestTemplateData: any, language: string) {
    const localizedManifestFile = `static/${language}.manifest.webmanifest`;
    const localizedStringsFile = `src/locales/${language}.json`;
    const localizedStrings = JSON.parse(fs.readFileSync(localizedStringsFile, 'utf8'));

    manifestTemplateData.description = localizedStrings.metadata.description;
    manifestTemplateData.lang = language;
    // Relative to the manifest, which sits at the root of whatever the site is
    // served from: absolute paths would be wrong under a base path, and the
    // default language is served without its prefix, so that is the URL an
    // installed app has to open.
    manifestTemplateData.start_url = language === defaultLanguage ? `app` : `${language}/app`;
    // The whole site rather than one page: the app is reachable both with and
    // without the language prefix, and a page outside the scope cannot be
    // installed at all.
    manifestTemplateData.scope = '.';
    // No id: it defaults to start_url. The one written here pointed at
    // gpx.studio, another origin entirely, which no browser would accept.
    delete manifestTemplateData.id;

    fs.writeFileSync(localizedManifestFile, JSON.stringify(manifestTemplateData, null, 2));
}

const manifestTemplateFile = 'static/en.manifest.webmanifest';
const manifestTemplateData = JSON.parse(fs.readFileSync(manifestTemplateFile, 'utf8'));
for (const language of Object.keys(languages)) {
    if (language === 'en') continue;
    localizeManifest(manifestTemplateData, language);
}
