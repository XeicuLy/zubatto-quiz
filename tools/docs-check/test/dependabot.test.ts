import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Group = { patterns?: string[]; 'update-types'?: string[] };
type Update = {
  'package-ecosystem': string;
  directory?: string;
  schedule?: { interval?: string };
  'commit-message'?: { prefix?: string; include?: string };
  cooldown?: { 'default-days'?: number; 'semver-major-days'?: number };
  ignore?: { 'dependency-name'?: string; 'update-types'?: string[] }[];
  groups?: Record<string, Group>;
};
type DependabotConfig = { version: number; updates: Update[] };
type PnpmWorkspace = {
  minimumReleaseAge?: number;
  minimumReleaseAgeExclude?: string[];
  trustLockfile?: boolean;
};

const repoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const config = parse(repoFile('.github/dependabot.yml')) as DependabotConfig;

describe('Dependabot の github-actions の更新', () => {
  const actions = config.updates.find((update) => update['package-ecosystem'] === 'github-actions');

  it('.github/workflows を、週に1回見に行く', () => {
    expect(config.version).toBe(2);
    // github-actions の directory は / と決まっている。/ で .github/workflows を読む
    expect(actions?.directory).toBe('/');
    expect(actions?.schedule?.interval).toBe('weekly');
  });

  it('題名は scope のない ci: で始まる（pr-title の commitlint を通し、CHANGELOG に載せない）', () => {
    expect(actions?.['commit-message']?.prefix).toBe('ci');
    // include: scope を書くと ci(deps): になる。このリポジトリのコミットは scope を付けない
    expect(actions?.['commit-message']?.include).toBeUndefined();
  });

  it('minor と patch を1つの PR にまとめ、major は action ごとの PR に分ける', () => {
    const groups = Object.values(actions?.groups ?? {});
    expect(groups).toEqual([{ patterns: ['*'], 'update-types': ['minor', 'patch'] }]);
  });

  it('公開から3日以上たった版だけを PR にする', () => {
    // 乗っ取られて公開された新しいタグは --verify を通るので、見つかるまでの時間を待つ。github-actions で使えるのは default-days だけ
    expect(actions?.cooldown?.['default-days']).toBeGreaterThanOrEqual(3);
  });
});

describe('Dependabot の npm の更新', () => {
  const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm');

  // Dependabot の「先に一致したグループに入る」を写したもの。undefined は、グループに入らず1本の PR になること
  const groupOf = (name: string, updateType: string) =>
    Object.entries(npm?.groups ?? {}).find(
      ([, group]) =>
        group['update-types']?.includes(updateType) &&
        group.patterns?.some((pattern) =>
          pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
        ),
    )?.[0];

  it('workspace 全体を / から、週に1回見に行く', () => {
    // pnpm-lock.yaml は root に1つだけなので、/ だけを指す。apps/* なども更新されることは、最初の PR で確かめる
    expect(npm?.directory).toBe('/');
    expect(npm?.schedule?.interval).toBe('weekly');
  });

  it('題名は scope のない chore: で始まる（pr-title の commitlint を通し、CHANGELOG に載せない）', () => {
    expect(npm?.['commit-message']?.prefix).toBe('chore');
    expect(npm?.['commit-message']?.include).toBeUndefined();
  });

  it.each([
    // minor と patch は1つにまとめる。PR ごとに e2e が約10分かかる
    ['hono', 'minor', 'minor-and-patch'],
    ['hono', 'patch', 'minor-and-patch'],
    ['react', 'minor', 'minor-and-patch'],
    ['@storybook/react', 'patch', 'minor-and-patch'],
    // major は別の PR にする
    ['hono', 'major', undefined],
    // 版をそろえるものは、major のときだけ一緒に別の PR にする
    ['storybook', 'major', 'storybook'],
    ['@storybook/react', 'major', 'storybook'],
    ['react', 'major', 'react'],
    ['@types/react-dom', 'major', 'react'],
    ['tailwindcss', 'major', 'tailwindcss'],
    ['@tailwindcss/vite', 'major', 'tailwindcss'],
    ['@commitlint/cli', 'major', 'commitlint'],
  ])('%s の %s は %s に入る', (name, updateType, group) => {
    expect(groupOf(name, updateType)).toBe(group);
  });

  it('公開から3日（major は7日）以上たった版だけを PR にする', () => {
    // pnpm の公開待ち期間（1日）より長くする。短いと、直接の依存の新しい版で ci の --frozen-lockfile が落ちる
    expect(npm?.cooldown?.['default-days']).toBeGreaterThanOrEqual(3);
    expect(npm?.cooldown?.['semver-major-days']).toBeGreaterThanOrEqual(7);
  });

  it('手で上げる2つは、major の PR を作らない', () => {
    expect(npm?.ignore).toEqual([
      // 8 系では、React Compiler が既定値付き props の部品を黙って飛ばす
      { 'dependency-name': '@babel/core', 'update-types': ['version-update:semver-major'] },
      // .mise.toml の Node の版に合わせる
      { 'dependency-name': '@types/node', 'update-types': ['version-update:semver-major'] },
    ]);
  });

  it('pnpm の公開待ち期間を弱める設定がない', () => {
    // 新しすぎる版を指定すると、pnpm は minimumReleaseAgeExclude を黙って足す。除外を残すと守りを素通りする
    const workspace = parse(repoFile('pnpm-workspace.yaml')) as PnpmWorkspace;
    expect(workspace.minimumReleaseAgeExclude).toBeUndefined();
    expect(workspace.minimumReleaseAge).toBeUndefined();
    expect(workspace.trustLockfile).toBeUndefined();
  });
});

describe('Dependabot の更新の PR', () => {
  const workflows = readdirSync(new URL('../../../.github/workflows/', import.meta.url)).filter((name) =>
    /\.ya?ml$/.test(name),
  );

  it.each(workflows)('%s は自動でマージしない', (name) => {
    expect(repoFile(`.github/workflows/${name}`)).not.toMatch(/gh pr merge|merge --auto|automerge|fetch-metadata/i);
  });
});
