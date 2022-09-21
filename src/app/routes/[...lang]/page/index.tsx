import { component$ } from '@builder.io/qwik';
import { DocumentHead, StaticGenerateHandler } from '@builder.io/qwik-city';
import { Speak, $translate as t } from 'qwik-speak';

import { config } from '../../../speak-config';

export const Page = component$(() => {
  return (
    <>
      <h1>{t('app.title')}</h1>
      <h2>{t('app.subtitle')}</h2>

      <p>{t('page.text')}</p>
    </>
  );
});

export default component$(() => {
  return (
    /**
     * Add Page translation (only available in child components)
     * In this example, there is an additional language that is used as a fallback for missing values 
     * by the handleMissingTranslation$ implemented during configuration
     */
    <Speak assets={['page']} langs={['en-US']}>
      <Page />
    </Speak>
  );
});

export const head: DocumentHead = {
  title: 'app.page.title',
  meta: [{ name: 'description', content: 'app.page.description' }]
};

// E.g. SSG
export const onStaticGenerate: StaticGenerateHandler = () => {
  return {
    params: config.supportedLocales.map(locale => {
      return { lang: locale.lang !== config.defaultLocale.lang ? locale.lang : '' };
    }),
  };
};