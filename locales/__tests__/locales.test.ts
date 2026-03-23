import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.resolve(__dirname, '..');
const EN_PATH = path.join(LOCALES_DIR, 'en.json');

/** Recursively collect all dot-separated key paths from an object. */
function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return collectKeys(value as Record<string, unknown>, fullKey);
    }

    return [fullKey];
  });
}

const enJson = JSON.parse(fs.readFileSync(EN_PATH, 'utf-8'));
const enKeys = new Set(collectKeys(enJson));

const localeFiles = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'en.json');

describe('Locale completeness', () => {
  it('en.json is valid JSON with at least one key', () => {
    expect(enKeys.size).toBeGreaterThan(0);
  });

  for (const file of localeFiles) {
    const locale = file.replace('.json', '');

    describe(locale, () => {
      const localePath = path.join(LOCALES_DIR, file);
      const localeJson = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
      const localeKeys = new Set(collectKeys(localeJson));

      it('has no keys missing from en.json', () => {
        const missing = [...enKeys].filter((k) => !localeKeys.has(k));

        expect(missing, `Missing keys in ${file}: ${missing.join(', ')}`).toHaveLength(0);
      });

      it('has no extra keys not present in en.json', () => {
        const extra = [...localeKeys].filter((k) => !enKeys.has(k));

        expect(extra, `Extra keys in ${file}: ${extra.join(', ')}`).toHaveLength(0);
      });
    });
  }
});
