/**
 * 次の版を決める（ADR 0012）。
 *
 * changelogen の bumpVersion は使わない。上げるものがなくても patch に落ち、docs なども patch に数え、
 * 基準が package.json の version になるため。ここでは「上げる理由がなければ止める」「基準は最新の v* タグ」にする。
 */

/** deploy.yaml の dispatch の欄 bump の選択肢 */
export const bumps = ['auto', 'major', 'minor', 'patch'] as const;
export type Bump = (typeof bumps)[number];

/** 判定に要る commit の中身。changelogen の GitCommit はこの形を満たす */
export type Change = { type: string; isBreaking: boolean };

/** next は v を付けない x.y.z。null なら版を作らない（cli は終了コード 1） */
export type Plan = { next: string | null; reason: string };

type Version = readonly [major: number, minor: number, patch: number];

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

const parseTag = (tag: string): Version | null => {
  const match = TAG_RE.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const compareVersions = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** v* のタグのうち、版がいちばん大きいもの。vX.Y.Z の形でないタグ（pre-release など）は数えない */
export function latestTag(tags: readonly string[]): string | null {
  let latest: { tag: string; version: Version } | null = null;
  for (const tag of tags) {
    const version = parseTag(tag);
    if (version && (!latest || compareVersions(version, latest.version) > 0)) {
      latest = { tag, version };
    }
  }
  return latest?.tag ?? null;
}

const increment = ([major, minor, patch]: Version, level: Exclude<Bump, 'auto'>): string => {
  switch (level) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
};

/** auto のときに上げる大きさと、その理由。上げる理由になる commit がなければ null */
const detectLevel = (commits: readonly Change[]): { level: Exclude<Bump, 'auto'>; reason: string } | null => {
  if (commits.some(({ isBreaking }) => isBreaking)) {
    return { level: 'major', reason: '破壊的変更（!）がある' };
  }
  if (commits.some(({ type }) => type === 'feat')) {
    return { level: 'minor', reason: 'feat がある' };
  }
  const fix = commits.find(({ type }) => type === 'fix' || type === 'perf');
  if (fix) {
    return { level: 'patch', reason: `${fix.type} がある` };
  }
  return null;
};

export function plan({
  currentTag,
  commits,
  bump,
}: {
  /** 最新の v* タグ（latestTag）。一度もなければ null */
  currentTag: string | null;
  /** 基準のタグから出すコミットまでの commit。CHANGELOG に出すものと同じ（selectCommits） */
  commits: readonly Change[];
  bump: Bump;
}): Plan {
  if (currentTag === null) {
    return {
      next: null,
      reason: 'v* のタグが見つからない。タグと履歴を取ったか（fetch-depth: 0）を確かめる',
    };
  }
  const current = parseTag(currentTag);
  if (!current) {
    throw new Error(`基準のタグが vX.Y.Z の形でない: ${currentTag}`);
  }

  if (bump !== 'auto') {
    return { next: increment(current, bump), reason: `${bump} を選んだ（${currentTag} から）` };
  }
  const detected = detectLevel(commits);
  if (!detected) {
    return {
      next: null,
      reason: `${currentTag} のあとに feat・fix・perf・破壊的変更がない。それでも出すなら patch などを選ぶ`,
    };
  }
  return {
    next: increment(current, detected.level),
    reason: `auto: ${detected.reason}ので ${detected.level}（${currentTag} から）`,
  };
}
