import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

test('Telegram sign-in has one canonical implementation and preserves the old import path', () => {
  const canonical = read('src/lib/telegram-auth.ts');
  const compatibility = read('src/firebase/telegram-auth.ts');

  assert.equal(canonical.split('export async function syncTelegramUser').length - 1, 1);
  assert.equal(canonical.split('function getDeterministicPassword').length - 1, 1);
  assert.match(compatibility, /export\s*\{\s*syncTelegramUser\s*\}\s*from\s*['"]@\/lib\/telegram-auth['"]/);
  assert.doesNotMatch(compatibility, /function getDeterministicPassword|async function syncTelegramUser/);
});

test('placeholder image modules share one public type without merging their distinct datasets or fallback behavior', () => {
  const sharedType = read('src/lib/placeholder-image-types.ts');
  const rootModule = read('src/lib/placeholder-images.ts');
  const appModule = read('src/app/lib/placeholder-images.ts');

  assert.match(sharedType, /export type ImagePlaceholder\s*=/);
  assert.match(rootModule, /export type \{ ImagePlaceholder \} from '\.\/placeholder-image-types'/);
  assert.match(appModule, /export type \{ ImagePlaceholder \} from '@\/lib\/placeholder-image-types'/);

  assert.match(rootModule, /data\.placeholderImages/);
  assert.match(appModule, /data\?\.placeholderImages \|\| \[\]/);
  assert.match(rootModule, /from '\.\/placeholder-images\.json'/);
  assert.match(appModule, /from '\.\/placeholder-images\.json'/);
});
