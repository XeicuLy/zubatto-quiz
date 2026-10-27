import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type ChangelogSection = { type: string; section: string; hidden?: boolean };
type ReleasePleaseConfig = {
  'release-type'?: string;
  'include-component-in-tag'?: boolean;
  'pull-request-title-pattern'?: string;
  'changelog-sections'?: ChangelogSection[];
  packages?: Record<string, Record<string, unknown>>;
} & Record<string, unknown>;

const config = JSON.parse(readRepoFile('release-please-config.json')) as ReleasePleaseConfig;

/** CI（pr-title.yaml）と同じ commitlint の CLI に、リポジトリの設定で通す */
const commitlint = (args: string[], input?: string) =>
  execFileSync(`${repoRoot}node_modules/.bin/commitlint`, args, { cwd: repoRoot, encoding: 'utf8', input });

/** リポジトリの commitlint の設定（config-conventional を解決したもの）で許している type */
const commitTypes = () => {
  const resolved = JSON.parse(commitlint(['--print-config', 'json'])) as { rules: Record<string, unknown[]> };
  return resolved.rules['type-enum']?.[2] as string[];
};

describe('release-please の設定（release-please-config.json・ADR 0009）', () => {
  it('commitlint が許すどの type にも、CHANGELOG の節の決まりがある', () => {
    // 決まりのない type は、release-please の既定（英語の見出し、または黙って捨てる）になる。commitlint に type を足したら、ここも足す
    const configured = (config['changelog-sections'] ?? []).map(({ type }) => type);
    expect([...configured].sort()).toEqual([...commitTypes()].sort());
  });

  it('CHANGELOG に出すのは feat・fix・perf だけで、見出しは日本語', () => {
    const visible = (config['changelog-sections'] ?? []).filter(({ hidden }) => hidden !== true);
    expect(visible).toEqual([
      { type: 'feat', section: '新機能' },
      { type: 'fix', section: '修正' },
      { type: 'perf', section: '性能' },
    ]);
  });

  it('リポジトリ全体で1つの番号を、ルートの package.json に持つ', () => {
    expect(config['release-type']).toBe('node');
    expect(Object.keys(config.packages ?? {})).toEqual(['.']);
  });

  it('タグはパッケージ名を付けない v1.2.3 の形にする', () => {
    // 付けないと zubatto-quiz-v1.2.3 になる（2026-10-27、release-please 17.11.2 の dry-run で確かめた）
    expect(config['include-component-in-tag']).toBe(false);
  });

  it('リリース PR の題名は、PR の題名の確認（pr-title）を通る', () => {
    // squash マージでは PR の題名が main のコミット名になり、pr-title がそれを確かめる
    const pattern = config['pull-request-title-pattern'] ?? '';
    expect(pattern).toContain('${version}');
    expect(() => commitlint([], `${pattern.replaceAll('${version}', '1.2.3')}\n`)).not.toThrow();
  });
});

type Step = { id?: string; uses?: string; with?: Record<string, string> };
type Job = { environment?: string; permissions?: unknown; steps?: Step[] };
type Workflow = { on: Record<string, unknown>; permissions?: unknown; jobs: Record<string, Job> };

const workflowText = readRepoFile('.github/workflows/release-please.yaml');
const workflow = parse(workflowText) as Workflow;
const stepOf = (action: string) =>
  Object.values(workflow.jobs)
    .flatMap(({ steps }) => steps ?? [])
    .find(({ uses }) => uses?.startsWith(`${action}@`));

describe('release-please の workflow（release-please.yaml・ADR 0009）', () => {
  it('main への push だけで動く（マージのたびにリリース PR を更新し、リリース PR のマージでタグと Release を作る）', () => {
    expect(workflow.on).toEqual({ push: { branches: ['main'] } });
  });

  it('GITHUB_TOKEN は読むだけにする（書き込みは App の token が持つ）', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(Object.values(workflow.jobs).every(({ permissions }) => permissions === undefined)).toBe(true);
  });

  it('App の秘密鍵を読む job は、main だけに絞った Environment（release）で動く', () => {
    // Environment の secret は、その Environment の job からしか読めない。main 以外のブランチの workflow には渡らない
    const jobsWithSecrets = Object.entries(workflow.jobs).filter(([, job]) => JSON.stringify(job).includes('secrets.'));
    expect(jobsWithSecrets.map(([, { environment }]) => environment)).toEqual(['release']);
  });

  it('App の token に頼む権限は、contents・pull-requests・issues の書き込みだけ', () => {
    // issues は、リリース PR に付けるラベル（autorelease: pending）のため。release-please はラベルでマージ済みのリリース PR を探す
    const permissions = Object.entries(stepOf('actions/create-github-app-token')?.with ?? {}).filter(([key]) =>
      key.startsWith('permission-'),
    );
    expect(Object.fromEntries(permissions)).toEqual({
      'permission-contents': 'write',
      'permission-pull-requests': 'write',
      'permission-issues': 'write',
    });
  });

  it('release-please に、App の token と、リポジトリの設定と manifest を渡す', () => {
    // GITHUB_TOKEN で作った PR では ci / e2e が承認待ちになるので、App の token を使う
    const tokenStep = stepOf('actions/create-github-app-token');
    const options = stepOf('googleapis/release-please-action')?.with ?? {};
    expect(options.token).toBe(`\${{ steps.${tokenStep?.id}.outputs.token }}`);
    expect(options['config-file']).toBe('release-please-config.json');
    expect(options['manifest-file']).toBe('.release-please-manifest.json');
    expect(() => readRepoFile(options['manifest-file'] ?? '')).not.toThrow();
  });
});
