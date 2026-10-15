/**
 * Dynamic Language Pack Loader
 *
 * Dynamically loads and registers Language Packs passed via `--pack <module-spec>`.
 * Throws PackLoadError on failure, enabling exit code 3 handling.
 */

function getPathUtils() {
  if (typeof globalThis.process?.versions?.node === 'undefined' && !('Bun' in globalThis)) {
    throw new Error('Path resolution is only supported in Node / Bun environments');
  }
  return {
    // eslint-disable-next-line no-restricted-syntax -- lazy CJS require keeps node builtins out of browser bundles
    resolve: require('path').resolve,
    // eslint-disable-next-line no-restricted-syntax -- lazy CJS require keeps node builtins out of browser bundles
    pathToFileURL: require('url').pathToFileURL,
  };
}
import { registerLanguagePack, type LanguagePack } from '@bitcobblers/wod-wiki-engine';

export class PackLoadError extends Error {
  constructor(
    public readonly spec: string,
    public readonly originalError: unknown,
  ) {
    const msg = originalError instanceof Error ? originalError.message : String(originalError);
    super(`Failed to load Language Pack "${spec}": ${msg}`);
    this.name = 'PackLoadError';
  }
}

/**
 * Dynamically imports a Language Pack module and registers it.
 *
 * @param moduleSpec - Relative or absolute path, or package name.
 */
export async function loadLanguagePack(moduleSpec: string): Promise<LanguagePack> {
  try {
    let importPath = moduleSpec;

    // If it looks like a relative or absolute file path, resolve and convert to file URL
    if (
      moduleSpec.startsWith('.') ||
      moduleSpec.startsWith('/') ||
      moduleSpec.includes('\\') ||
      moduleSpec.endsWith('.ts') ||
      moduleSpec.endsWith('.js') ||
      moduleSpec.endsWith('.mjs')
    ) {
      const { resolve, pathToFileURL } = getPathUtils();
      const resolved = resolve(process.cwd(), moduleSpec);
      importPath = pathToFileURL(resolved).href;
    }
    const imported = await import(/* @vite-ignore */ importPath);
    const candidate = imported.default ?? imported.pack ?? imported;

    if (!candidate || typeof candidate !== 'object') {
      throw new Error(`Module "${moduleSpec}" does not export a valid LanguagePack object`);
    }

    const pack = candidate as LanguagePack;
    registerLanguagePack(pack);
    return pack;
  } catch (error) {
    if (error instanceof PackLoadError) throw error;
    throw new PackLoadError(moduleSpec, error);
  }
}
