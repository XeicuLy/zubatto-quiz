// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readAppFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

/** public/_headers から、すべての経路（/*）に付ける CSP を、ディレクティブごとに取り出す */
async function readCsp(): Promise<Map<string, string[]>> {
  const headers = await readAppFile('public/_headers');
  const [, rules = ''] = headers.split(/^\/\*$/m);
  const value = rules.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1];
  if (value === undefined) {
    throw new Error('public/_headers の /* に Content-Security-Policy がない');
  }
  return new Map(
    value
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name = '', ...sources]) => [name, sources]),
  );
}

describe('public/_headers の CSP（ADR 0004）', () => {
  it.each([
    ['default-src', ["'self'"]],
    // インラインのスクリプトと eval を許さない。XSS で差し込まれたスクリプトを動かさない
    ['script-src', ["'self'"]],
    // WebSocket も同じオリジンの /api/ の下につなぐ。'self' は同じホストの ws:・wss: も含む
    ['connect-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
  ])('%s は %j だけを許す', async (name, sources) => {
    const csp = await readCsp();

    expect(csp.get(name)).toEqual(sources);
  });
});

describe('index.html', () => {
  it('インラインのスクリプトを持たない（script-src の CSP に違反しない）', async () => {
    const html = await readAppFile('index.html');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];

    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes = '', body = ''] of scripts) {
      expect(attributes).toMatch(/\bsrc=/);
      expect(body.trim()).toBe('');
    }
  });

  it('インラインのスタイルとイベントハンドラーを持たない', async () => {
    const html = await readAppFile('index.html');

    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\s(style|on[a-z]+)=/);
  });

  it('言語を日本語にし、タイトルを日本語にする（SC3）', async () => {
    const html = await readAppFile('index.html');

    expect(html).toMatch(/<html lang="ja">/);
    expect(html).toMatch(/<title>ズバクイ<\/title>/);
  });
});
