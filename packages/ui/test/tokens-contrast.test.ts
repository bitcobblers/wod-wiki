import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Token contrast guard.
 *
 * The property editor renders its fields on `--background`, so the tokens it
 * leans on (placeholder text, field boundary) have to clear WCAG 1.4.3 (4.5:1
 * for text) and 1.4.11 (3:1 for control boundaries) in BOTH themes. The
 * values live in CSS, so the guard parses the stylesheet instead of trusting
 * a comment to stay true.
 */

const stylesheet = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8');

type Rgb = [number, number, number];

function blockTokens(selector: string): Map<string, string> {
  const start = stylesheet.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing ${selector} block`);
  const end = stylesheet.indexOf('}', start);
  const body = stylesheet.slice(start, end);
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

function hslToRgb(value: string): Rgb {
  const [hue, saturation, lightness] = value
    .split(/\s+/)
    .map((part) => Number.parseFloat(part));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((hue % 360) + 360) % 360 / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1 ? [chroma, secondary, 0]
    : sector < 2 ? [secondary, chroma, 0]
    : sector < 3 ? [0, chroma, secondary]
    : sector < 4 ? [0, secondary, chroma]
    : sector < 5 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];
  const offset = lightness - chroma / 2;
  return [(r + offset) * 255, (g + offset) * 255, (b + offset) * 255];
}

function composite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [
    alpha * fg[0] + (1 - alpha) * bg[0],
    alpha * fg[1] + (1 - alpha) * bg[1],
    alpha * fg[2] + (1 - alpha) * bg[2],
  ];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function token(tokens: Map<string, string>, name: string): Rgb {
  const value = tokens.get(name);
  if (!value) throw new Error(`Missing token ${name}`);
  return hslToRgb(value);
}

const light = blockTokens(':root');
const dark = blockTokens('.dark');

describe('design token contrast', () => {
  it('keeps the property field boundary readable in both themes', () => {
    for (const [name, tokens] of [['light', light], ['dark', dark]] as const) {
      const ratio = contrast(token(tokens, 'field-border'), token(tokens, 'background'));
      expect(ratio, `${name} field-border vs background`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps placeholder text legible in both themes', () => {
    for (const [name, tokens] of [['light', light], ['dark', dark]] as const) {
      const background = token(tokens, 'background');
      const ratio = contrast(
        composite(token(tokens, 'foreground'), background, 0.7),
        background,
      );
      expect(ratio, `${name} placeholder vs background`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps muted text legible in both themes', () => {
    for (const [name, tokens] of [['light', light], ['dark', dark]] as const) {
      const ratio = contrast(token(tokens, 'muted-foreground'), token(tokens, 'background'));
      expect(ratio, `${name} muted-foreground vs background`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
