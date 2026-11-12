// @vitest-environment node
import { access, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readAppFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

/** public/_headers から、すべての経路（/*）に付けるヘッダーの行を取り出す */
async function readAllPathsRules(): Promise<string> {
  const headers = await readAppFile('public/_headers');
  const [, rules = ''] = headers.split(/^\/\*$/m);
  return rules;
}

/** public/_headers から、すべての経路（/*）に付ける CSP を、ディレクティブごとに取り出す */
async function readCsp(): Promise<Map<string, string[]>> {
  const rules = await readAllPathsRules();
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

// 部屋の参加画面やログイン画面が検索から見つからないようにする。
// robots.txt でクロールを止めると noindex が読まれず、ほかのサイトのリンクから URL だけ載ることがあるので、置かない
describe('検索エンジンに載せない', () => {
  it('_headers の /* が X-Robots-Tag で noindex を付ける', async () => {
    expect(await readAllPathsRules()).toMatch(/^\s+X-Robots-Tag: noindex, nofollow$/m);
  });

  it('index.html が robots の meta で noindex を付ける（ヘッダーを読まない経路への保険）', async () => {
    expect(await readAppFile('index.html')).toMatch(/<meta name="robots" content="noindex, nofollow" \/>/);
  });

  it('public/robots.txt を置かない', async () => {
    await expect(access(new URL('../public/robots.txt', import.meta.url))).rejects.toThrow(/ENOENT/);
  });
});

// HTML のタグ名と属性名は大文字小文字を区別しないので、正規表現には i を付ける。
// 閉じタグは </script > のように中に空白を持てるので、> までをまとめて読む

/** HTML の <script> を、属性と中身に分けて取り出す */
function scriptsIn(html: string): { attributes: string; body: string }[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)].map(([, attributes = '', body = '']) => ({
    attributes,
    body,
  }));
}

/** HTML が <style> の要素か、style・on* の属性を持つかを返す */
function hasInlineStyleOrHandler(html: string): boolean {
  return /<style\b/i.test(html) || /[\s/](style|on[a-z]+)\s*=/i.test(html);
}

describe('index.html の検査が見つけるもの', () => {
  // ブラウザは <SCRIPT> もスクリプトとして動かす
  it.each(['<script>alert(1)</script>', '<SCRIPT>alert(1)</SCRIPT>', '<script>alert(1)</script >'])(
    '%s をインラインのスクリプトとして見つける',
    (html) => {
      expect(scriptsIn(html)).toEqual([{ attributes: '', body: 'alert(1)' }]);
    },
  );

  it.each([
    '<style>body{}</style>',
    '<STYLE>body{}</STYLE>',
    '<div style="color:red"></div>',
    '<div STYLE="color:red"></div>',
    '<img onerror="alert(1)">',
    '<img ONERROR="alert(1)">',
    '<img onerror = "alert(1)">',
    // ブラウザは / も属性の区切りとして読む
    '<img/onerror="alert(1)">',
  ])('%s をインラインのスタイルかイベントハンドラーとして見つける', (html) => {
    expect(hasInlineStyleOrHandler(html)).toBe(true);
  });
});

describe('index.html', () => {
  it('インラインのスクリプトを持たない（script-src の CSP に違反しない）', async () => {
    const scripts = scriptsIn(await readAppFile('index.html'));

    expect(scripts.length).toBeGreaterThan(0);
    for (const { attributes, body } of scripts) {
      expect(attributes).toMatch(/\bsrc\s*=/i);
      expect(body.trim()).toBe('');
    }
  });

  it('インラインのスタイルとイベントハンドラーを持たない', async () => {
    expect(hasInlineStyleOrHandler(await readAppFile('index.html'))).toBe(false);
  });

  it('言語を日本語にし、タイトルを日本語にする（SC3）', async () => {
    const html = await readAppFile('index.html');

    expect(html).toMatch(/<html lang="ja">/);
    expect(html).toMatch(/<title>ズバクイ<\/title>/);
  });
});
