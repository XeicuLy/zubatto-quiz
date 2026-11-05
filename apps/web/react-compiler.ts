import babel from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';

/**
 * React Compiler を動かす Babel のプラグイン。vite.config.ts と vitest.config.ts で同じ変換を使うために1か所にまとめる。
 * react() のすぐ後ろに置く。@babel/core は 7 系のままにする（8 系では既定値付きの props を持つ部品がエラーなしで飛ばされる）
 */
export function reactCompiler() {
  const preset = reactCompilerPreset();
  // ルートを並べるだけの生成ファイルで、部品がない。README の filter.id.exclude = … は、filter.id がないので実行時に落ちる
  preset.rolldown.filter = { ...preset.rolldown.filter, id: { exclude: ['**/routeTree.gen.ts'] } };
  return babel({ presets: [preset] });
}
