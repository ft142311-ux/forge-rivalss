import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/fans/page.tsx', import.meta.url), 'utf8');

test('fan base loads persisted server-owned metrics before showing the page', () => {
  assert.match(source, /getFoundationFansAction\(await user\.getIdToken\(true\)\)/);
  assert.match(source, /setFans\(result\.fans as any\)/);
  assert.match(source, /const \[isFansLoading, setIsFansLoading\] = useState\(true\)/);
  assert.match(source, /!user \|\| isFansLoading\) return <LoadingScreen \/>/);
  assert.match(source, /return \(\) => \{ active = false; \}/);
});
