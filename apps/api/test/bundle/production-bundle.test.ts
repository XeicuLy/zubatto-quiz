import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { E2E_LOGIN_PATH } from '../e2e-login-path';
import { SWAGGER_UI_PATH } from '../swagger-path';

const apiRoot = new URL('../../', import.meta.url);
const outDirs: string[] = [];

afterAll(async () => {
  await Promise.all(outDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * 確かめるバンドルと、それを作る wrangler deploy の引数。
 * production は先頭の設定（本番）、e2e は wrangler.jsonc の env.e2e。
 * dev は vite dev の API の Worker で、本番の設定の main だけを開発の入口に替える。
 * 入口を選ぶのは apps/web の api-worker.ts で、wrangler.jsonc に env はないので、入口のファイルを直に渡す
 */
const TARGETS = {
  production: ['--env='],
  e2e: ['--env=e2e'],
  dev: ['--env=', 'test/dev-entry.ts'],
} as const satisfies Record<string, readonly string[]>;
type Target = keyof typeof TARGETS;

/** wrangler deploy --dry-run で、デプロイするときと同じバンドルを作り、出力の JS を1つの文字列にして返す */
async function bundleOf(target: Target): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), 'zubakui-bundle-'));
  outDirs.push(outDir);
  // 手元で CLOUDFLARE_ENV を入れていても、--env の値で作る
  const { CLOUDFLARE_ENV: _, ...processEnv } = process.env;
  await promisify(execFile)(
    'pnpm',
    ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', outDir, ...TARGETS[target]],
    {
      cwd: apiRoot,
      env: { ...processEnv, WRANGLER_SEND_METRICS: 'false' },
    },
  );
  // 分けて書き出されたモジュールも見るよう、下のフォルダーまで探す
  const files = (await readdir(outDir, { recursive: true })).filter((file) => file.endsWith('.js'));
  const sources = await Promise.all(files.map((file) => readFile(join(outDir, file), 'utf8')));
  return sources.join('\n');
}

// wrangler のバンドルは1回に数秒かかるので、バンドルごとに1度だけ作り、どのテストも同じものを読む
const bundles = new Map<Target, Promise<string>>();
const cachedBundleOf = (target: Target) => {
  const bundle = bundles.get(target) ?? bundleOf(target);
  bundles.set(target, bundle);
  return bundle;
};

// toContain で比べると、失敗したときにバンドルの全体（数 MB）が差分に出るので、true / false で比べる
describe('E2E 用のログインの入口（ADR 0003）', () => {
  it('本番のバンドルには、E2E 用のログインの経路が入らない', async () => {
    expect((await cachedBundleOf('production')).includes(E2E_LOGIN_PATH)).toBe(false);
  });

  it('e2e の環境のバンドルには入る（上の確認が、綴りの違いなどで空振りしていない）', async () => {
    expect((await cachedBundleOf('e2e')).includes(E2E_LOGIN_PATH)).toBe(true);
  });

  it('開発の入口のバンドルにも入らない。開発では本物の GitHub のログインを使う', async () => {
    expect((await cachedBundleOf('dev')).includes(E2E_LOGIN_PATH)).toBe(false);
  });
});

describe('Swagger UI（ADR 0011）', () => {
  it('本番のバンドルには、Swagger UI の経路が入らない', async () => {
    expect((await cachedBundleOf('production')).includes(SWAGGER_UI_PATH)).toBe(false);
  });

  it('e2e の環境のバンドルには入る（上の確認が、綴りの違いなどで空振りしていない）', async () => {
    expect((await cachedBundleOf('e2e')).includes(SWAGGER_UI_PATH)).toBe(true);
  });

  it('開発の入口のバンドルにも入る（vite dev で開ける）', async () => {
    expect((await cachedBundleOf('dev')).includes(SWAGGER_UI_PATH)).toBe(true);
  });
});
