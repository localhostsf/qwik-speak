import type { Plugin } from 'vite';
import type { RenderedChunk } from 'rollup';
import { readFile, readdir } from 'fs/promises';
import path from 'path';

import type { QwikSpeakInlineOptions, Translation } from './types';
import { translateFnTest, translateFnMatch, translateFnSignatureMatch, globalLang } from './constants';
import log from '../logger';

/**
 * Qwik Speak Inline Vite plugin
 * 
 * Inline $translate values: $lang === 'lang' && 'value' || 'default value'
 */
export function qwikSpeakInline(options: QwikSpeakInlineOptions): Plugin {
  // Resolve options
  const opts: Required<QwikSpeakInlineOptions> = {
    ...options,
    basePath: options.basePath ?? './',
    assetsPath: options.assetsPath ?? 'public/i18n',
    keySeparator: options.keySeparator ?? '.',
    keyValueSeparator: options.keyValueSeparator ?? '@@',
  }

  // Resolve translation data
  const translation: Translation = Object.fromEntries(opts.supportedLangs.map(value => [value, {}]));

  const plugin: Plugin = {
    name: 'qwik-speak-inline-vite-plugin',
    enforce: 'post',
    // Apply only on build
    apply: 'build',

    /**
     * Load translation files when build starts
     */
    async buildStart() {
      // For all langs
      await Promise.all(opts.supportedLangs.map(async lang => {
        const baseDir = `${opts.basePath}${opts.assetsPath}/${lang}`;
        // For all files
        const files = await readdir(baseDir);

        if (files.length > 0) {
          const ext = path.extname(files[0]);
          let data: Translation = {};

          const tasks = files.map(filename => readFile(`${baseDir}/${filename}`, 'utf8'));
          const sources = await Promise.all(tasks);

          for (const source of sources) {
            if (source) {
              switch (ext) {
                case '.json':
                  data = await parseJson(data, source);
                  break;
              }
            }
          }

          translation[lang] = { ...translation[lang], ...data }; // Shallow merge
        }
      }));
    },

    /**
     * Inline translation data in chunk files
     */
    async renderChunk(code: string, chunk: RenderedChunk) {
      if (!translateFnTest.test(code)) return null; // no transformation

      if (chunk.fileName.startsWith('entry')) log(chunk.fileName);
      return inline(code, translation, opts);
    },

    async closeBundle() {
      log(`Qwik Speak Inline: build ends at ${new Date().toLocaleString()}`);
    }
  };

  return plugin;
}

export async function parseJson(target: Translation, source: string): Promise<Translation> {
  target = { ...target, ...JSON.parse(source) };
  return target;
}

export function inline(
  code: string,
  translation: Translation,
  opts: Required<QwikSpeakInlineOptions>
): string | null {
  const matches = code.match(translateFnMatch);
  // Skip dynamic keys
  if (!matches) return null;

  for (const originalFn of matches) {
    // Get signature
    const args = originalFn.match(translateFnSignatureMatch)?.[0];

    if (args) {
      // Get signature parameters
      const params = getParams(args);

      // Skip dynamic params
      if (params[1]) {
        // "{ name: 'Qwik Speak' }" => 'name'
        const paramNames = params[1].match(/(\w+(?=:|\s+:))/g);
        if (!paramNames) continue;
      }

      let supportedLangs: string[];
      let defaultLang: string;

      // Check multilingual
      const optionalLang = multilingual(params[3], opts.supportedLangs);

      if (!optionalLang) {
        supportedLangs = opts.supportedLangs;
        defaultLang = opts.defaultLang;
      } else {
        supportedLangs = [optionalLang];
        defaultLang = optionalLang;
      }

      // Get key
      const key = getKey(params[0], opts.keyValueSeparator);

      // Get default value
      const defaultValue = getValue(key, translation[defaultLang], params[1], opts.keySeparator);
      if (!defaultValue) {
        log(`${defaultLang} - missing value for key: ${key} - Skip`);
        continue;
      }

      // Map of values
      const values = new Map<string, string>();
      values.set(defaultLang, defaultValue);

      for (const lang of supportedLangs.filter(x => x !== defaultLang)) {
        const value = getValue(key, translation[lang], params[1], opts.keySeparator);
        if (!value) {
          log(`${lang} - missing value for key: ${key}`);
          continue;
        }
        values.set(lang, value);
      }

      // Build translated line
      const line = buildLine(values, supportedLangs, defaultLang);

      // Replace
      code = code.replace(originalFn, line);
    }
  }

  return code;
}

export function multilingual(param: string | undefined, supportedLangs: string[]): string | undefined {
  if (!param) return undefined;
  const lang = trimQuotes(param);
  return supportedLangs.find(x => x === lang);
}

export function getKey(param: string, keyValueSeparator: string): string {
  let key = trimQuotes(param);
  key = key.split(keyValueSeparator)[0];
  return key;
}

export function getValue(
  key: string,
  data: Translation,
  args: string | undefined,
  keySeparator: string
): string | undefined {
  const value = key.split(keySeparator).reduce((acc, cur) => (acc && acc[cur] != null) ? acc[cur] : null, data);
  if (typeof value === 'string') return args ? handleParams(value, args) : quoteValue(value);
  return undefined;
}

export function handleParams(value: string, args: string): string | undefined {
  // Trim brackets
  args = args.replace(/(^({))|(})$/g, '');

  const params = getParams(args);

  for (const param of params) {
    const parts = param.split(':').map(x => x.trim());
    if (parts.length === 2) {
      value = value.replace(/{{\s?([^{}\s]*)\s?}}/g, (substring: string, parsedKey: string) => {
        return parsedKey === parts[0] ? interpolateParam(parts[1]) : substring;
      });
    }
  }
  return quoteValue(value);
}

export function getParams(args: string): string[] {
  // Split by comma outside single or double quotes, backticks and brackets
  let params = args
    .split(/((?:[^,'"`]*(?:"(?:[^"])*"|'(?:[^'])*'|'(?:[^`])*`|,(?:[^{]*\}))[^,'"`]*)+)|,/gs)
    .filter(Boolean);

  // Change all groups of white-spaces characters to a single space & trim the result
  params = params.map(x => x.replace(/\s+/g, ' ').trim());
  return params;
}

export function trimQuotes(value: string): string {
  return value.replace(/(^("|'|`))|("|'|`)$/g, '');
}

/**
 * Ready for inlining
 * @param value 
 * @returns The value in backticks
 */
export function quoteValue(value: string): string {
  return '`' + value + '`';
}

export function interpolateParam(param: string): string {
  return '${' + param + '}';
}

/**
 * Build the translated line
 */
export function buildLine(values: Map<string, string>, supportedLangs: string[], defaultLang: string): string {
  let translatedLine = '';
  for (const lang of supportedLangs.filter(x => x !== defaultLang)) {
    translatedLine += `${globalLang} === ${quoteValue(lang)} && ${values.get(lang)} || `;
  }
  translatedLine += values.get(defaultLang);
  return translatedLine;
}
