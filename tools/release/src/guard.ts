/**
 * deploy.yaml の3つの job が、続けるか止めるかを決める（ADR 0012）。
 *
 * どれも、git と GitHub から読んだ事実だけを受け取る純粋関数にする。読み出しは steps.ts と .github/scripts/release.sh が行う。
 * changelogen を読み込まないので、依存パッケージを入れない release job でも node だけで動く。
 *
 * - checkPlan: verify-ci（承認の前）。だめな run は承認の画面まで来ない
 * - checkDeploy: deploy の最初。Re-run failed jobs は成功済みの verify-ci を動かし直さないので、本番に出す直前に確かめ直す
 * - checkRelease: release の最初。前の Re-run で終わっていれば飛ばし、続けられない状態なら PR を作る前に止まる
 */

/** CHANGELOG の PR のブランチは changelog/vX.Y.Z。開いた PR のうち、このブランチのものを「前の CHANGELOG の PR」として数える */
const CHANGELOG_BRANCH_PREFIX = 'changelog/';

export function changelogPr(version: string): { branch: string; title: string; body: string } {
  const tag = `v${version}`;
  return {
    branch: `${CHANGELOG_BRANCH_PREFIX}${tag}`,
    // squash マージで main のコミット名になる。chore は CHANGELOG に出ず、次の版も上げない
    title: `chore: ${tag} の CHANGELOG を更新する`,
    body: [
      `deploy.yaml が ${tag} を本番に出したあとに作った PR。CHANGELOG.md とルートの package.json の version を ${tag} に合わせる。`,
      '',
      `マージは、${tag} の Release ができたことを確かめてからにする。Release より先にマージすると、release job が途中で失敗した run を、次の dispatch が止められなくなる（docs/runbooks/release.md）。`,
    ].join('\n'),
  };
}

const openChangelogPrProblems = (openBranches: readonly string[]): string[] =>
  openBranches
    .filter((branch) => branch.startsWith(CHANGELOG_BRANCH_PREFIX))
    .map(
      (branch) =>
        `前の CHANGELOG の PR（${branch}）が開いている。その版の Release ができたことを確かめてからマージし、もう一度 dispatch する`,
    );

export function checkPlan({
  baseTag,
  sha,
  baseCommit,
  baseIsAncestor,
  openBranches,
}: {
  /** 最新の v* タグ */
  baseTag: string;
  /** 出すコミット（github.sha） */
  sha: string;
  /** 基準のタグが指すコミット */
  baseCommit: string;
  /** 基準のタグが sha の祖先か（同じコミットも祖先に数える） */
  baseIsAncestor: boolean;
  /** 開いている PR の head のブランチ */
  openBranches: readonly string[];
}): string[] {
  const problems: string[] = [];
  if (baseCommit === sha) {
    problems.push(
      `${baseTag} はすでにこのコミットを指している。同じコミットに2つ目の版は作らない。出し直すときはタグの上で動かす`,
    );
  } else if (!baseIsAncestor) {
    problems.push(`${baseTag} がこのコミットの祖先でない。これまでの版を含まないコミットは出さない`);
  }
  return [...problems, ...openChangelogPrProblems(openBranches)];
}

export function checkDeploy({
  baseTag,
  latestTag,
  openBranches,
}: {
  /** verify-ci が版を決めたときの基準のタグ */
  baseTag: string;
  /** 今の最新の v* タグ */
  latestTag: string | null;
  openBranches: readonly string[];
}): string[] {
  const problems: string[] = [];
  if (latestTag !== baseTag) {
    problems.push(
      `最新の v* タグ（${latestTag ?? 'なし'}）が、verify-ci が版を決めたときの基準のタグ（${baseTag}）と違う。` +
        'あとから別の版が出ているので、この run は出さない。いちばん新しい run だけを Re-run する',
    );
  }
  return [...problems, ...openChangelogPrProblems(openBranches)];
}

export type ReleaseDecision = { action: 'continue' } | { action: 'skip' | 'stop'; reason: string };

export function checkRelease({
  baseTag,
  latestTag,
  tag,
  tagCommit,
  sha,
}: {
  baseTag: string;
  latestTag: string | null;
  /** これから作るタグ（vX.Y.Z） */
  tag: string;
  /** そのタグがすでに指しているコミット。なければ null */
  tagCommit: string | null;
  sha: string;
}): ReleaseDecision {
  if (tagCommit === sha) {
    return { action: 'skip', reason: `${tag} はすでにこのコミットにある。前の run で終わっているので、何もしない` };
  }
  if (tagCommit !== null) {
    return { action: 'stop', reason: `${tag} はすでに別のコミット（${tagCommit}）にある。飛ばさずに止める` };
  }
  if (latestTag !== baseTag) {
    return {
      action: 'stop',
      reason:
        `最新の v* タグ（${latestTag ?? 'なし'}）が、基準のタグ（${baseTag}）と違う。` +
        'あとから別の版が出ているので、PR も Release も作らない',
    };
  }
  return { action: 'continue' };
}
