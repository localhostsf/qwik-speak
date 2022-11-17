import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { extname, join, normalize } from 'path';

import type { QwikSpeakExtractOptions, Translation } from './types';
import { getTranslateAlias, parseJson, parseSequenceExpressions } from '../core/parser';
import { deepMerge, deepSet } from '../core/merge';
import { minDepth, sortTarget, toJsonString } from '../core/format';

/**
 * Extract translations from source files
 */
export async function qwikSpeakExtract(options: QwikSpeakExtractOptions) {
  // Resolve options
  const resolvedOptions: Required<QwikSpeakExtractOptions> = {
    ...options,
    basePath: options.basePath ?? './',
    sourceFilesPath: options.sourceFilesPath ?? 'src',
    assetsPath: options.assetsPath ?? 'public/i18n',
    format: options.format ?? 'json',
    keySeparator: options.keySeparator ?? '.',
    keyValueSeparator: options.keyValueSeparator ?? '@@',
  }

  // Logs
  const stats = new Map<string, number>();

  const baseSources = normalize(`${resolvedOptions.basePath}/${resolvedOptions.sourceFilesPath}`);

  // Source files
  const sourceFiles: string[] = [];
  // Translation data
  const translation: Translation = Object.fromEntries(resolvedOptions.supportedLangs.map(value => [value, {}]));

  /**
   * Read source files recursively
   */
  const readSourceFiles = async (sourceFilesPath: string) => {
    const files = await readdir(sourceFilesPath, { withFileTypes: true });
    for (const file of files) {
      const filePath = join(sourceFilesPath, file.name);
      const ext = extname(file.name);
      if (file.isDirectory()) {
        await readSourceFiles(filePath);
      } else if (/\.js|\.ts|\.jsx|\.tsx/.test(ext)) {
        sourceFiles.push(filePath);
      }
    }
  };

  /**
   * Parse source file to return keys
   */
  const parseSourceFile = async (file: string): Promise<string[]> => {
    const keys: string[] = [];

    const code = await readFile(normalize(`${resolvedOptions.basePath}/${file}`), 'utf8');

    if (/\$translate/.test(code)) {
      const alias = getTranslateAlias(code);
      // Parse sequence
      const sequence = parseSequenceExpressions(code, alias);
      for (const expr of sequence) {
        const args = expr.arguments;

        if (args?.[0]?.value) {
          if (args[0].type === 'Identifier') {
            stats.set('dynamic', (stats.get('dynamic') ?? 0) + 1);
            continue;
          }
          if (args[0].type === 'Literal') {
            if (args[0].value !== 'key' && /\${.*}/.test(args[0].value)) {
              stats.set('dynamic', (stats.get('dynamic') ?? 0) + 1);
              continue;
            }
          }
          if (args[1]?.type === 'Identifier' || args[1]?.type === 'CallExpression' ||
            args[2]?.type === 'Identifier' || args[2]?.type === 'CallExpression' ||
            args[3]?.type === 'Identifier' || args[3]?.type === 'CallExpression') {
            stats.set('dynamic', (stats.get('dynamic') ?? 0) + 1);
            continue;
          }

          keys.push(args[0].value);
          stats.set('keys', (stats.get('keys') ?? 0) + 1);
        }
      }
    }

    return keys;
  };

  /**
   * Read, deep merge & sort translation data
   */
  const readAssets = async () => {
    await Promise.all(resolvedOptions.supportedLangs.map(async lang => {
      const baseAssets = normalize(`${resolvedOptions.basePath}/${resolvedOptions.assetsPath}/${lang}`);

      if (!existsSync(baseAssets)) return;

      const files = await readdir(baseAssets);

      if (files.length > 0) {
        const ext = extname(files[0]);
        let data: Translation = {};

        const tasks = files.map(filename => readFile(`${baseAssets}/${filename}`, 'utf8'));
        const sources = await Promise.all(tasks);

        for (const source of sources) {
          if (source) {
            switch (ext) {
              case '.json':
                data = parseJson(data, source);
                break;
            }
          }
        }

        deepMerge(translation[lang], data);

        // Sort by key
        translation[lang] = sortTarget(translation[lang]);
      }
    }));
  };

  /**
   * Write translation data
   * 
   * Naming convention of keys:
   * min depth > 1: filenames = each top-level property name
   * min depth = 1: filename = 'app'
   */
  const writeAssets = async () => {
    for (const lang of resolvedOptions.supportedLangs) {
      const baseAssets = normalize(`${resolvedOptions.basePath}/${resolvedOptions.assetsPath}/${lang}`);

      if (!existsSync(baseAssets)) {
        mkdirSync(baseAssets, { recursive: true });
      }

      if (minDepth(translation[lang]) > 1) {
        for (const topLevelProperty of Object.keys(translation[lang])) {
          let data: string;
          switch (resolvedOptions.format) {
            case 'json':
              // Computed property name
              data = toJsonString({ [topLevelProperty]: translation[lang][topLevelProperty] });
              break;
          }
          const file = normalize(`${baseAssets}/${topLevelProperty}.${resolvedOptions.format}`);
          await writeFile(file, data);
          console.log(file);
        }
      } else {
        let data: string;
        switch (resolvedOptions.format) {
          case 'json':
            data = toJsonString(translation[lang]);
            break;
        }

        const file = normalize(`${baseAssets}/app.${resolvedOptions.format}`);
        await writeFile(file, data);
        console.log(file);
      }
    }
  };

  /**
   * Start pipeline
   */
  await readSourceFiles(baseSources);

  const tasks = sourceFiles.map(file => parseSourceFile(file));
  const sources = await Promise.all(tasks);

  let keys: string[] = [];
  for (const source of sources) {
    keys = keys.concat(source);
  }

  // Deep set
  for (let key of keys) {
    let defaultValue: string | undefined = undefined;

    [key, defaultValue] = key.split(resolvedOptions.keyValueSeparator);

    for (const lang of resolvedOptions.supportedLangs) {
      deepSet(translation[lang], key.split(resolvedOptions.keySeparator), defaultValue || '');
    }
  }

  // Read, deep merge & sort
  await readAssets();

  // Write
  await writeAssets();

  // Log
  for (const [key, value] of stats) {
    switch (key) {
      case 'keys':
        console.log('\x1b[32m%s\x1b[0m', `extracted keys: ${value}`);
        break;
      case 'dynamic':
        console.log('\x1b[32m%s\x1b[0m', `skipped keys due to dynamic params: ${value}`);
        break;
    }
  }
}

export type { QwikSpeakExtractOptions };