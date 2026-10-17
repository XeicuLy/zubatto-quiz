import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { E2E_LOGIN_PATH } from '../e2e-login-path';

const apiRoot = new URL('../../', import.meta.url);
const outDirs: string[] = [];

afterAll(async () => {
  await Promise.all(outDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * wrangler deploy --dry-run で、デプロイするときと同じバンドルを作り、出力の JS を1つの文字列にして返す。
 * env は wrangler.jsonc の環境の名前。'' は先頭の設定（本番）を指す
 */
async function bundleOf(env: string): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), 'zubakui-bundle-'));
  outDirs.push(outDir);
  // 手元で CLOUDFLARE_ENV を入れていても、--env の値で作る
  const { CLOUDFLARE_ENV: _, ...processEnv } = process.env;
  await promisify(execFile)('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', outDir, `--env=${env}`], {
    cwd: apiRoot,
    env: { ...processEnv, WRANGLER_SEND_METRICS: 'false' },
  });
  // 分けて書き出されたモジュールも見るよう、下のフォルダーまで探す
  const files = (await readdir(outDir, { recursive: true })).filter((file) => file.endsWith('.js'));
  const sources = await Promise.all(files.map((file) => readFile(join(outDir, file), 'utf8')));
  return sources.join('\n');
}

// toContain で比べると、失敗したときにバンドルの全体（数 MB）が差分に出るので、true / false で比べる
describe('E2E 用のログインの入口（ADR 0003）', () => {
  it('本番のバンドルには、E2E 用のログインの経路が入らない', async () => {
    expect((await bundleOf('')).includes(E2E_LOGIN_PATH)).toBe(false);
  });

  it('e2e の環境のバンドルには入る（上の確認が、綴りの違いなどで空振りしていない）', async () => {
    expect((await bundleOf('e2e')).includes(E2E_LOGIN_PATH)).toBe(true);
  });
});
