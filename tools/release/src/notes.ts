/**
 * リリースノートの文面を changelogen で作る（ADR 0012）。changelogen はライブラリとして、commit の解析と文面づくりだけに使う。
 *
 * changelogen の CLI が自分の中でしている絞り込みは、ライブラリとして呼ぶと効かないので、ここで同じことをする。
 */
import {
  generateMarkDown,
  parseCommits,
  type GitCommit,
  type RawGitCommit,
  type ResolvedChangelogConfig,
} from 'changelogen';

/** GitHub の Revert ボタンが作る題名。squash では後ろに ` (#N)` が付く */
const GITHUB_REVERT_RE = /^Revert "(?<reverted>.+)"(?<rest>.*)$/;

/**
 * `Revert "feat: x (#1)" (#2)` を `revert: feat: x (#1) (#2)` に書き換える。
 * commitlint は Revert "…" を確かめずに通し、changelogen の正規表現は先頭に固定されていないので、
 * そのままだと中の feat を拾って minor に上げ、`x"` という行を出す。
 */
const normalizeRevert = (commit: RawGitCommit): RawGitCommit => {
  const groups = GITHUB_REVERT_RE.exec(commit.message)?.groups;
  return groups ? { ...commit, message: `revert: ${groups.reverted}${groups.rest}` } : commit;
};

/**
 * 文面に出す commit。plan にも同じものを渡し、文面に出ない commit（chore! など）では版を上げない。
 *
 * - types で false にした type と、表にない type を捨てる（changelogen の CLI と同じ）
 * - 作者を消す。generateMarkDown は noAuthors でも、名前のある作者ごとに https://ungh.cc/users/find/<メール> へ問い合わせる
 */
export function selectCommits(rawCommits: readonly RawGitCommit[], config: ResolvedChangelogConfig): GitCommit[] {
  return (
    parseCommits(rawCommits.map(normalizeRevert), config)
      // 見出し（title）を持つ type だけを出す。false と表にない type、Object の組み込みの名前（constructor など）は捨てる
      .filter(({ type }) => Object.hasOwn(config.types, type) && typeof config.types[type] === 'object')
      .map((commit) => ({ ...commit, author: { name: '', email: '' }, authors: [] }))
  );
}

/** 版の見出し（config.newVersion）・比べるリンク・type ごとの節の Markdown */
export async function renderNotes(commits: readonly GitCommit[], config: ResolvedChangelogConfig): Promise<string> {
  // generateMarkDown は可変の配列を受け取る（中で並べ替えるのは自分で作った節ごとの配列で、渡した配列は変えない）
  return generateMarkDown([...commits], config);
}
