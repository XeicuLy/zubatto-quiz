import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

/** wrangler.jsonc の secrets.required。JSONC なので、配列の部分だけを取り出して読む */
function requiredSecrets(): string[] {
  const list = readRepoFile('apps/api/wrangler.jsonc').match(/"secrets":\s*\{\s*"required":\s*(\[[^\]]*\])/)?.[1];
  if (list === undefined) {
    throw new Error('apps/api/wrangler.jsonc に secrets.required がない');
  }
  return JSON.parse(list) as string[];
}

/** .dev.vars.example の「名前=値」の行。コメントと空行は除く */
const entries = readRepoFile('apps/api/.dev.vars.example')
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#'))
  .map((line) => {
    const [name = '', ...value] = line.split('=');
    return { name, value: value.join('=') };
  });

describe('apps/api/.dev.vars.example', () => {
  it('名前が wrangler.jsonc の secrets.required とそろっている', () => {
    // 1つでも欠けた .dev.vars では、vite dev でログインできない（docs/runbooks/secrets.md）
    expect(entries.map(({ name }) => name).sort()).toEqual(requiredSecrets().sort());
  });

  it('秘密の値は空のままにしている', () => {
    // ひな形はコミットされる。.dev.vars と取り違えて本物の値を書いてしまったら、ここで止める
    const filled = entries.filter(({ name, value }) => name !== 'BETTER_AUTH_URL' && value !== '');
    expect(filled).toEqual([]);
  });
});
