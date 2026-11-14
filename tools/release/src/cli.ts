/**
 * 次の版とリリースノートの文面を、1つの JSON で標準出力に出す（ADR 0012）。
 *
 *   node tools/release/src/cli.ts --bump auto --to "$GITHUB_SHA"
 *   → {"baseTag":"v1.3.0","next":"1.4.0","reason":"…","notes":"## v1.4.0\n…"}
 *
 * - 基準は最新の v* タグ（plan の latestTag）。そこから --to（既定は HEAD）までの commit を読む
 * - next が null（auto で上げるものがない、タグがない）なら、notes も null にして JSON を出し、理由を標準エラーにも書いて終了コード 1。
 *   引数の誤りは JSON を出さずに終了コード 2
 * - GitHub のことは知らない。verify-ci のまとめと outputs、release job への受け渡しは、呼ぶ側のシェルが JSON から作る
 * - 基準のタグが --to の祖先であることは確かめない（verify-ci が確かめる）。changelogen の getGitDiff は
 *   `基準...to` で読むので、祖先でないと、基準の側にしかない commit も混ざる
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { getGitDiff, loadChangelogConfig } from 'changelogen';

import { renderNotes, selectCommits } from './notes.ts';
import { bumps, latestTag, plan, type Bump } from './plan.ts';

export type CliArgs = { bump: Bump; to: string };

export type CliOutput = { baseTag: string | null; next: string | null; reason: string; notes: string | null };

/** コミットの SHA・ブランチ名・HEAD など。getGitDiff は ref をシェルの文字列に埋め込むので、引用符や空白や $ を通さない */
const REF_RE = /^\w[\w./-]*$/;

const isBump = (value: string): value is Bump => (bumps as readonly string[]).includes(value);

export function parseCliArgs(args: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: [...args],
    options: {
      bump: { type: 'string', default: 'auto' },
      to: { type: 'string', default: 'HEAD' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!isBump(values.bump)) {
    throw new Error(`--bump は ${bumps.join(' / ')} のどれか: ${values.bump}`);
  }
  if (!REF_RE.test(values.to)) {
    throw new Error(`--to はコミットかブランチの名前にする: ${JSON.stringify(values.to)}`);
  }
  return { bump: values.bump, to: values.to };
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function main(args: CliArgs): Promise<CliOutput> {
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: repoRoot, encoding: 'utf8' }).split('\n');
  const baseTag = latestTag(tags);
  if (baseTag === null) {
    return { baseTag, ...plan({ currentTag: null, commits: [], bump: args.bump }), notes: null };
  }

  const config = await loadChangelogConfig(repoRoot, { from: baseTag, to: args.to });
  const commits = selectCommits(await getGitDiff(baseTag, args.to, repoRoot), config);
  const { next, reason } = plan({ currentTag: baseTag, commits, bump: args.bump });
  if (next === null) {
    return { baseTag, next, reason, notes: null };
  }
  const notes = await renderNotes(commits, { ...config, newVersion: next });
  return { baseTag, next, reason, notes };
}

const parseOrExit = (args: readonly string[]): CliArgs => {
  try {
    return parseCliArgs(args);
  } catch (error) {
    // 引数の誤りは、上げるものがない（1）と分けて 2 で終える
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
};

if (import.meta.main) {
  const output = await main(parseOrExit(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (output.next === null) {
    console.error(output.reason);
    process.exitCode = 1;
  }
}
