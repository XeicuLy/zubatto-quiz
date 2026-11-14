import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  needs?: string | string[];
  if?: string;
  environment?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
};
type Workflow = { permissions?: Record<string, string>; jobs: Record<string, Job> };

const workflowFiles = readdirSync(new URL('../../../.github/workflows/', import.meta.url)).filter((file) =>
  file.endsWith('.yaml'),
);
const workflows = Object.fromEntries(
  workflowFiles.map((file) => [file, parse(readRepoFile(`.github/workflows/${file}`)) as Workflow]),
);
const deployWorkflow = workflows['deploy.yaml'] ?? { jobs: {} };
const release = deployWorkflow.jobs.release ?? {};
const steps = release.steps ?? [];

const APP_TOKEN_ACTION = 'actions/create-github-app-token@';

describe('デプロイのあとのタグ・Release・CHANGELOG の PR（deploy.yaml の release・ADR 0012）', () => {
  it('ブランチの上の run で、deploy が成功したあとにだけ動き、main だけに絞った Environment（release）を使う', () => {
    // タグの上の run（前の版に戻すとき）では、タグを作らない。verify-ci の outputs を読むので verify-ci も needs に書く
    expect(release.if).toBe("github.ref_type == 'branch'");
    expect(release.needs).toEqual(['verify-ci', 'deploy']);
    expect(release.environment).toBe('release');
  });

  it('依存パッケージを入れず、ほかの job が書き込めるキャッシュも読まない（node だけを入れる）', () => {
    // 書き込みの token を持つ job で、依存の install スクリプトや、キャッシュの中身が動かないようにする（ADR 0012 の DD2）
    expect(steps.some(({ run }) => /\bpnpm\b|\bnpm\b/.test(run ?? ''))).toBe(false);
    expect(steps.some(({ uses }) => uses?.startsWith('actions/cache@'))).toBe(false);
    const mise = steps.filter(({ uses }) => uses?.startsWith('jdx/mise-action@'));
    expect(mise.map((step) => step.with)).toEqual([expect.objectContaining({ cache: false, install_args: 'node' })]);
  });

  it('checkout は token を残さず、タグと履歴ごと取る（最新の v* タグとタグが指すコミットを読む）', () => {
    const checkout = steps.find(({ uses }) => uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toEqual({ 'persist-credentials': false, 'fetch-depth': 0 });
  });

  it('App の token に頼む権限は、contents と pull-requests の書き込みだけ（ラベルを使わないので issues は渡さない）', () => {
    const token = steps.find(({ uses }) => uses?.startsWith(APP_TOKEN_ACTION));
    const permissions = Object.entries(token?.with ?? {}).filter(([key]) => key.startsWith('permission-'));
    expect(Object.fromEntries(permissions)).toEqual({
      'permission-contents': 'write',
      'permission-pull-requests': 'write',
    });
    expect(token?.with?.['client-id']).toBe('${{ vars.RELEASE_APP_CLIENT_ID }}');
    expect(token?.with?.['private-key']).toBe('${{ secrets.RELEASE_APP_PRIVATE_KEY }}');
  });

  it('App の token を作る step は、すべての workflow の中で release job にだけある', () => {
    const owners = Object.entries(workflows).flatMap(([file, { jobs }]) =>
      Object.entries(jobs)
        .filter(([, job]) => (job.steps ?? []).some(({ uses }) => uses?.startsWith(APP_TOKEN_ACTION)))
        .map(([id]) => `${file}:${id}`),
    );
    expect(owners).toEqual(['deploy.yaml:release']);
  });

  it('App の token は release.sh publish の step にだけ渡し、verify-ci の版と文面は env で受け取る', () => {
    const token = steps.find(({ uses }) => uses?.startsWith(APP_TOKEN_ACTION));
    const publish = steps.find(({ run }) => run?.includes('release.sh publish'));
    expect(publish).toEqual({
      name: 'Publish release',
      run: 'bash .github/scripts/release.sh publish',
      env: {
        GH_TOKEN: `\${{ steps.${token?.id}.outputs.token }}`,
        BASE_TAG: '${{ needs.verify-ci.outputs.base-tag }}',
        VERSION: '${{ needs.verify-ci.outputs.version }}',
        NOTES_BASE64: '${{ needs.verify-ci.outputs.notes-base64 }}',
      },
    });
    const usesToken = steps.filter((step) => JSON.stringify(step).includes(`steps.${token?.id}.outputs.token`));
    expect(usesToken).toEqual([publish]);
  });

  it.each(workflowFiles)('%s は、どの job でも GITHUB_TOKEN に書き込みの権限を渡さない', (file) => {
    // タグ・Release・PR を書くのは App の token だけ（ADR 0012 の DD2）
    const { permissions = {}, jobs } = workflows[file] ?? { jobs: {} };
    expect(Object.keys(permissions).length).toBeGreaterThan(0);
    const all = [permissions, ...Object.values(jobs).map((job) => job.permissions ?? {})];
    expect(all.flatMap((perms) => Object.values(perms)).filter((value) => value !== 'read')).toEqual([]);
  });
});

describe('前の CHANGELOG の PR を探す（.github/scripts/release.sh）', () => {
  // 行末の \ で続けた行を1行にしてから読む
  const commands = readRepoFile('.github/scripts/release.sh').replaceAll('\\\n', ' ').split('\n');
  const prLists = commands.filter((line) => line.includes('gh pr list'));

  it('gh pr list は、どれも fork からの PR を数えない', () => {
    // 誰でも changelog/ で始まるブランチの PR を fork から開ける。数えると、dispatch を止めたり、
    // 同じ名前の閉じた PR で CHANGELOG の PR を作らずに飛ばさせたりできてしまう
    expect(prLists.length).toBeGreaterThanOrEqual(2);
    for (const line of prLists) {
      expect(line).toContain('isCrossRepository');
      expect(line).toContain('select(.isCrossRepository | not)');
    }
  });
});

describe('release job が書き換えるファイル', () => {
  it('CHANGELOG.md は oxfmt の対象から外す（release job は oxfmt を動かさずに書き足す）', () => {
    // changelogen の文面は、oxfmt が整える形（空行など）と合わないことがある。外さないと CHANGELOG の PR の fmt:check が落ちる
    const { ignorePatterns } = JSON.parse(readRepoFile('.oxfmtrc.json').replace(/^\s*\/\/.*$/gm, '')) as {
      ignorePatterns: string[];
    };
    expect(ignorePatterns).toContain('CHANGELOG.md');
    expect(ignorePatterns).not.toContain('.release-please-manifest.json');
  });

  it('ルートの package.json は、oxfmt が並べる位置（name のすぐ下）に version を持つ', () => {
    // release job は version の値だけを書き換える（tools/release の setPackageVersion）。ないと書き換えずに止まる
    const pkg = JSON.parse(readRepoFile('package.json')) as Record<string, unknown>;
    expect(Object.keys(pkg).slice(0, 2)).toEqual(['name', 'version']);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('release-please の設定・manifest・workflow は残っていない（2つの仕組みが同時にタグを打たない）', () => {
    const root = readdirSync(new URL('../../../', import.meta.url));
    expect(root).not.toContain('release-please-config.json');
    expect(root).not.toContain('.release-please-manifest.json');
    expect(workflowFiles).not.toContain('release-please.yaml');
  });
});
