import { $ } from '@builder.io/qwik';
import { isServer } from '@builder.io/qwik/build';
import {
  LoadTranslationFn,
  ResolveLocaleFn,
  SpeakConfig,
  TranslateFn
} from 'qwik-speak';

/**
 * Speak config
 */
export const config: SpeakConfig = {
  defaultLocale: { lang: 'en-US', currency: 'USD', timeZone: 'America/Los_Angeles', units: { 'length': 'mile' } },
  supportedLocales: [
    { lang: 'it-IT', currency: 'EUR', timeZone: 'Europe/Rome', units: { 'length': 'kilometer' } },
    { lang: 'en-US', currency: 'USD', timeZone: 'America/Los_Angeles', units: { 'length': 'mile' } }
  ],
  assets: [
    'app', // Translations shared by the pages
    'runtime' // Translations with dynamic keys or parameters
  ]
};

/**
 * E.g. Fetch translation data from json files
 * In productions with inlined translations, only the runtime file is loaded
 */
export const loadTranslation$: LoadTranslationFn = $(async (lang: string, asset: string, origin?: string) => {
  if (import.meta.env.DEV || asset === 'runtime') {
    let url = '';
    // Absolute urls on server
    if (isServer && origin) {
      url = origin;
    }
    url += `/i18n/${lang}/${asset}.json`;
    const data = await fetch(url);
    return data.json();
  }
});

// E.g. Resolve locale by url during SSR
export const resolveLocale$: ResolveLocaleFn = $((url: URL) => {
  const pathLang = config.supportedLocales.find(x => url.pathname.startsWith(`/${x.lang}`))?.lang;
  const lang = pathLang || config.defaultLocale.lang;
  const locale = config.supportedLocales.find(x => x.lang == lang);
  return locale;
});

/**
 * Translation functions
 */
export const translateFn: TranslateFn = {
  loadTranslation$: loadTranslation$,
  resolveLocale$: resolveLocale$
};
