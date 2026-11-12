import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const playgroundPublic = resolve(repoRoot, 'apps/playground/public');

describe('Static discovery & GitHub Pages fallback contracts (WW-002, WW-017)', () => {
  it('ships .nojekyll and .well-known/agent-capabilities.json in apps/playground/public', () => {
    expect(existsSync(resolve(playgroundPublic, '.nojekyll'))).toBe(true);
    expect(existsSync(resolve(playgroundPublic, '.well-known/agent-capabilities.json'))).toBe(true);
  });

  it('includes Open Graph / Twitter fallback metadata and SPA redirect script in 404.html (WW-002)', () => {
    const html = readFileSync(resolve(playgroundPublic, '404.html'), 'utf8');
    expect(html).toContain('<title>Wod.Wiki</title>');
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain('property="og:site_name" content="Wod.Wiki"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(html).toContain("sessionStorage.setItem('spa-redirect', location.href)");
    expect(html).toContain('location.replace(base)');
  });

  it('preserves hidden files across CI artifact uploads and verifies .well-known before Pages deploy (WW-017)', () => {
    const deployPlaygroundYml = readFileSync(
      resolve(repoRoot, '.github/workflows/_deploy-playground.yml'),
      'utf8',
    );
    const verifyYml = readFileSync(
      resolve(repoRoot, '.github/workflows/_verify.yml'),
      'utf8',
    );
    const publishYml = readFileSync(
      resolve(repoRoot, '.github/workflows/_publish.yml'),
      'utf8',
    );

    expect(deployPlaygroundYml).toContain('include-hidden-files: true');
    expect(verifyYml).toContain('include-hidden-files: true');
    expect(publishYml).toContain('.well-known/agent-capabilities.json');
    expect(publishYml).toContain('.nojekyll');
  });
});
