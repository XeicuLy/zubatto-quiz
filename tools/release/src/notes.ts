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

/** GitHub の Revert ボタンと git revert が作る題名。squash では後ろに ` (#N)` が付く */
const REVERT_RE = /^(?<verb>[Rr]evert|[Rr]eapply) "(?<inner>.+)"(?<rest>.*)$/;

/**
 * `Revert "feat: x (#1)" (#2)` を `revert: feat: x (#1) (#2)` に、`Reapply "feat: x (#1)" (#2)`（取り消しの取り消し）を
 * `feat: x (#1) (#2)` に書き換える。commitlint はどちらも確かめずに通すので、ここで Conventional Commits の形にする。
 */
const normalizeRevert = (commit: RawGitCommit): RawGitCommit => {
  const groups = REVERT_RE.exec(commit.message)?.groups;
  if (!groups) {
    return commit;
  }
  const prefix = groups.verb?.toLowerCase() === 'revert' ? 'revert: ' : '';
  return { ...commit, message: `${prefix}${groups.inner}${groups.rest}` };
};

/**
 * 先頭が Conventional Commits の形（`type(scope)!: `）の題名。changelogen の正規表現は先頭に固定されていないので、
 * commitlint が確かめずに通す題名（`fixup! feat: x`、`Merge pull request #1 from a/feat: x` など）から、途中の feat を拾ってしまう
 */
const CONVENTIONAL_HEADER_RE = /^[a-z]+(\(.+\))?!?: /i;

/** 本文の行頭の `BREAKING-CHANGE:` */
const HYPHENATED_BREAKING_RE = /^BREAKING-CHANGE:/gim;

/**
 * 本文のフッターの `BREAKING-CHANGE:` を `BREAKING CHANGE:` に書き換える。
 * Conventional Commits は2つを同じ意味とするが、changelogen は本文を `/breaking change:/i` でしか調べないので、
 * そのままだとハイフン付きの破壊的変更を見落とし、major ではなく patch や minor に上げる
 */
const normalizeBreakingFooter = (commit: RawGitCommit): RawGitCommit => ({
  ...commit,
  body: commit.body.replace(HYPHENATED_BREAKING_RE, 'BREAKING CHANGE:'),
});

/** changelogen の解析が Conventional Commits や GitHub の書き方とずれるところを、解析の前にそろえる */
const normalize = (commit: RawGitCommit): RawGitCommit => normalizeBreakingFooter(normalizeRevert(commit));

/**
 * 文面に出す commit。plan にも同じものを渡し、文面に出ない commit（chore! など）では版を上げない。
 *
 * - Revert・Reapply の題名と、本文の `BREAKING-CHANGE:` を、解析の前にそろえる（normalize）
 * - 先頭が Conventional Commits の形でない題名を捨てる
 * - types で false にした type と、表にない type を捨てる（changelogen の CLI と同じ）
 * - 作者を消す。generateMarkDown は noAuthors でも、名前のある作者ごとに https://ungh.cc/users/find/<メール> へ問い合わせる
 */
export function selectCommits(rawCommits: readonly RawGitCommit[], config: ResolvedChangelogConfig): GitCommit[] {
  return (
    parseCommits(
      rawCommits.map(normalize).filter(({ message }) => CONVENTIONAL_HEADER_RE.test(message)),
      config,
    )
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
