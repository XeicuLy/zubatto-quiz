import { globSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

/**
 * vitest の test.projects に渡す値を決める。
 *
 * - vitest 4 は、projects のグロブが1つも当たらないと（`[]` でも）「No projects were found」で落ちる。
 *   これは passWithNoTests より前に起きる
 * - projects を書かない（undefined）ときは root が1つのプロジェクトになり、テストが0件なら passWithNoTests で成功する
 * - apps/・packages/・tools/ がまだ空でも、pnpm run test（CI）を成功させたい
 */
function resolveProjects(globs: string[]): string[] | undefined {
  // ファイル（apps/README.md など）だけが当たったときは、パッケージがあるとみなさない
  const hasPackage = globs.some((glob) =>
    globSync(glob, { cwd: import.meta.dirname, withFileTypes: true }).some((entry) => entry.isDirectory()),
  );
  return hasPackage ? globs : undefined;
}

export default defineConfig({
  test: {
    // 各パッケージの vitest の設定を束ねて1回で走らせる。vitest-pool-workers を使うパッケージは自分の設定でプールを持つ
    // apps/api は、Workers で走るテスト（apps/api/vitest.config.ts）とは別に、node で走るバンドルの確認も持つ
    projects: resolveProjects(['apps/*', 'apps/api/vitest.bundle.config.ts', 'packages/*', 'tools/*']),
    // パッケージがまだ空でも CI を通す
    passWithNoTests: true,
  },
});
