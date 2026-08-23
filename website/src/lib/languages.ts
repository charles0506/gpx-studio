export const languages: Record<string, string> = {
    ca: 'Català',
    cs: 'Čeština',
    en: 'English',
    es: 'Español',
    eu: 'Euskara',
    de: 'Deutsch',
    fr: 'Français',
    it: 'Italiano',
    nl: 'Nederlands',
    'pt-BR': 'Português (Brasil)',
    tr: 'Türkçe',
    uk: 'Українська',
    zh: '简体中文',
    'zh-TW': '繁體中文',
};

// Language used when the URL carries no language prefix. Upstream ships English;
// this fork is aimed at Taiwanese hikers.
export const defaultLanguage = 'zh-TW';
