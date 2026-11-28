/**
 * 前からあるホストの行を書き換える SQL を、標準出力に1行で出す（ADR 0016 の W1、docs/runbooks/host-data.md）。
 *
 *   node scripts/scrub-host-data-cli.ts check   → 書き換える行の数を数える SELECT
 *   node scripts/scrub-host-data-cli.ts scrub   → 書き換えの UPDATE（3文を `; ` でつなぐ）
 *
 * package.json の host-data:check・host-data:scrub が、この出力を wrangler d1 execute の --command に渡す。
 * SQL を作るのは scrub-host-data.ts で、ここは選んで出すだけ。Workers のテストから読まないよう、node の型のファイルに分けている
 */
import { argv } from 'node:process';

import { CHECK_SQL, SCRUB_STATEMENTS } from './scrub-host-data.ts';

const sqlByMode = new Map([
  ['check', CHECK_SQL],
  ['scrub', SCRUB_STATEMENTS.join('; ')],
]);

const sql = sqlByMode.get(argv[2] ?? '');
if (sql === undefined) {
  console.error('使い方: node scripts/scrub-host-data-cli.ts check|scrub');
  process.exitCode = 2;
} else {
  console.log(sql);
}
