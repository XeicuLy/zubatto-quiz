import { existsSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { documents, read, repoRoot } from './documents';

type PackageJson = { name: string; scripts?: Record<string, string> };

const readPackage = (dir: string) => JSON.parse(read(new URL(`${dir}/package.json`, repoRoot))) as PackageJson;

const rootPackage = readPackage('.');

/** workspace のパッケージ（apps/*・packages/*・tools/*）を、`--filter` に書く名前で引く */
const workspacePackages = new Map(
  ['apps', 'packages', 'tools']
    .flatMap((group) => readdirSync(new URL(`${group}/`, repoRoot)).map((dir) => `${group}/${dir}`))
    .filter((dir) => existsSync(new URL(`${dir}/package.json`, repoRoot)))
    .map((dir) => readPackage(dir))
    .map((pkg) => [pkg.name, pkg]),
);

/**
 * 文に書いた `pnpm [-s] [--filter <名前>] run <スクリプト>`。`pnpm exec ...` は含まない。
 * スクリプト名は空白かバッククォート（インラインのコード）までを拾う。途中の `.` などで止めると、ないスクリプトを見逃す
 */
function scriptRunsIn(text: string) {
  return [...text.matchAll(/pnpm (?:-s |--silent )?(?:--filter (\S+) )?run ([^\s`]+)/g)].map(
    ([command, filter, script = '']) => ({ command, filter, script }),
  );
}

const scriptRuns = documents.flatMap((document) =>
  scriptRunsIn(read(new URL(document, repoRoot))).map((run) => ({ document, ...run })),
);

describe('scriptRunsIn', () => {
  it.each([
    { text: 'pnpm run fmt', expected: [{ filter: undefined, script: 'fmt' }] },
    { text: '`pnpm -s run logs:api` で残す', expected: [{ filter: undefined, script: 'logs:api' }] },
    {
      text: 'pnpm --filter @zubatto-quiz/api run db:generate --name init',
      expected: [{ filter: '@zubatto-quiz/api', script: 'db:generate' }],
    },
    // 名前の途中の `.` で止めると、ないスクリプトを、ある `logs:web` として通してしまう
    { text: 'pnpm run logs:web.bak', expected: [{ filter: undefined, script: 'logs:web.bak' }] },
    { text: 'pnpm exec vitest run --project docs', expected: [] },
  ])('「$text」から拾う', ({ text, expected }) => {
    expect(scriptRunsIn(text).map(({ filter, script }) => ({ filter, script }))).toEqual(expected);
  });
});

describe('手順書に書いたスクリプト', () => {
  it('手順書に pnpm run のコマンドがある', () => {
    // 1つも拾えないと、下の it.each が0件になり、何も確かめないまま通ってしまう
    expect(scriptRuns.length).toBeGreaterThan(0);
  });

  it.each(scriptRuns)('$document の「$command」のスクリプトが package.json にある', ({ filter, script }) => {
    // --filter がなければ root の package.json。名前を書き間違えたパッケージは引けず、undefined になって落ちる
    const pkg = filter === undefined ? rootPackage : workspacePackages.get(filter);
    // スクリプト名には `:` が入るので、パスの文字列ではなく配列で渡す
    expect(pkg?.scripts).toHaveProperty([script]);
  });
});

describe('本番中にログをファイルへ残すスクリプト（docs/runbooks/logs.md）', () => {
  it.each(['logs:api', 'logs:web'])('%s は、内側の pnpm にも --silent を付ける', (name) => {
    // pnpm 自身の出力が標準出力に混ざると、ファイルが JSON だけにならない。外側の -s が内側の pnpm に伝わることは、ドキュメントに書かれていない
    expect(rootPackage.scripts?.[name]).toMatch(/^pnpm --silent /);
  });
});

describe('ログをファイルへ残すコマンド', () => {
  const saves = [...documents, 'CLAUDE.md'].flatMap((document) =>
    [...read(new URL(document, repoRoot)).matchAll(/run logs:\w+ (>+) /g)].map(([command, redirect]) => ({
      document,
      command,
      redirect,
    })),
  );

  it('手順書に、ログをファイルへ残すコマンドがある', () => {
    expect(saves.length).toBeGreaterThan(0);
  });

  it.each(saves)('$document の「$command」は追記（>>）で書く', ({ redirect }) => {
    // > は同じ名前のファイルを空にしてから書く。tail を動かし直して名前がぶつかると、前のログが消える（O1）
    expect(redirect).toBe('>>');
  });
});
