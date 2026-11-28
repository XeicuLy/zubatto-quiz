import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { read, repoRoot } from './documents';

const cwd = fileURLToPath(repoRoot);

const git = (...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** wrangler.jsonc を持つ Worker のパッケージ。どれも wrangler types で worker-configuration.d.ts を作る */
const workerApps = readdirSync(new URL('apps/', repoRoot))
  .map((dir) => `apps/${dir}`)
  .filter((dir) => existsSync(new URL(`${dir}/wrangler.jsonc`, repoRoot)));

const scriptsOf = (dir: string) =>
  (JSON.parse(read(new URL(`${dir}/package.json`, repoRoot))) as { scripts: Record<string, string> }).scripts;

// 型のファイルをリポジトリに入れると、wrangler を上げる Dependabot の PR が `wrangler types --check` で毎回落ちる。
// 入れずに tsc のたびに作るので、古い型のまま確かめることも、手で作り直して push することもない
describe('Workers の型（worker-configuration.d.ts）', () => {
  it('Worker のパッケージが見つかる', () => {
    // 0件だと下の it.each が何も確かめないまま通る
    expect(workerApps).toEqual(['apps/api', 'apps/web']);
  });

  it.each(workerApps)('%s の tsc は、型を作り直してから確かめる', (dir) => {
    expect(scriptsOf(dir).tsc).toMatch(/^wrangler types && /);
  });

  it.each(workerApps)('%s の型のファイルは git が無視する', (dir) => {
    // .gitignore から行が消えると、作ったファイルがまたコミットに入る。
    // --no-index がないと、追跡しているファイルは無視されないと答えるので、追跡のほうは下の it で確かめる
    expect(git('check-ignore', '-q', '--no-index', `${dir}/worker-configuration.d.ts`).status).toBe(0);
  });

  it('型のファイルを git が追跡していない', () => {
    // .gitignore に書いても、前から追跡しているファイルは外れない
    const { status, stdout } = git('ls-files', '--', ':(glob)**/worker-configuration.d.ts');
    expect(status).toBe(0);
    expect(stdout).toBe('');
  });
});
