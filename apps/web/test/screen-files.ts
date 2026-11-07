import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

/** src の画面のファイル（テスト・ストーリー・自動生成のルート表を除く）を、src からの相対パスで返す */
export const screenFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter(
    (path) =>
      /\.tsx?$/.test(path) &&
      !/\.test\.tsx?$/.test(path) &&
      !/\.stories\.tsx?$/.test(path) &&
      !path.endsWith('routeTree.gen.ts'),
  )
  .map((path) => path.replaceAll('\\', '/'))
  .sort();

/** 画面のファイルの中身 */
export function sourceOf(path: string): string {
  return readFileSync(`${srcDir}${path}`, 'utf8');
}

/** その class を使う画面のファイル。text-stage が text-stage-label に当たらないよう、class 名の切れ目で区切る */
export function filesUsing(className: string): string[] {
  const pattern = new RegExp(String.raw`(?<![\w-])${className}(?![\w-])`);
  return screenFiles.filter((path) => pattern.test(sourceOf(path)));
}
