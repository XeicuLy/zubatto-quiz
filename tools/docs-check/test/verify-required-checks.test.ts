import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const repoPath = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const SCRIPT = repoPath('.github/scripts/verify-required-checks.sh');
const RULESET = repoPath('docs/runbooks/main-ruleset.json');
const REPOSITORY = 'owner/repo';
const SHA = 'a'.repeat(40);
const ACTIONS_APP_ID = 15368;

type CheckRun = { name: string; app_id: number; id: number; status: string; conclusion: string | null };

/**
 * 偽の gh。`gh api -X GET repos/<repo>/commits/<sha>/check-runs -f check_name=<名前> -F app_id=<ID> ...` だけを知っていて、
 * FAKE_CHECK_RUNS の中から名前と app_id が合う check run を、GitHub の API と同じ形（{ check_runs: [...] }）で返す。
 * ほかの呼び方や、違うリポジトリ・コミットへの呼び出しは失敗にする
 */
const FAKE_GH = `#!/usr/bin/env node
const args = process.argv.slice(2);
const fields = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-f' || args[i] === '-F') {
    const [key, ...value] = args[++i].split('=');
    fields[key] = value.join('=');
  }
}
const path = args.find((arg) => arg.startsWith('repos/'));
if (args[0] !== 'api' || path !== 'repos/${REPOSITORY}/commits/${SHA}/check-runs') {
  console.error('知らない呼び出し: ' + args.join(' '));
  process.exit(1);
}
const runs = JSON.parse(process.env.FAKE_CHECK_RUNS ?? '[]').filter(
  (run) => run.name === fields.check_name && String(run.app_id) === fields.app_id,
);
console.log(JSON.stringify({ total_count: runs.length, check_runs: runs }));
`;

const fakeBin = mkdtempSync(join(tmpdir(), 'verify-required-checks-'));
writeFileSync(join(fakeBin, 'gh'), FAKE_GH);
chmodSync(join(fakeBin, 'gh'), 0o755);

afterAll(() => {
  rmSync(fakeBin, { recursive: true, force: true });
});

function verify(checkRuns: CheckRun[], ruleset = RULESET) {
  const { status, stdout } = spawnSync('bash', [SCRIPT, ruleset], {
    encoding: 'utf8',
    env: {
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_SHA: SHA,
      FAKE_CHECK_RUNS: JSON.stringify(checkRuns),
    },
  });
  return { status, stdout };
}

let nextId = 1;
const run = (name: string, status: string, conclusion: string | null = null, appId = ACTIONS_APP_ID): CheckRun => ({
  name,
  app_id: appId,
  id: nextId++,
  status,
  conclusion,
});
const passed = (name: string) => run(name, 'completed', 'success');

describe('verify-required-checks.sh（deploy.yaml の verify-ci）', () => {
  it('ルールセットの必須のチェック（ci・e2e・pr-title）がどれも成功していれば、0 で終わる', () => {
    const { status, stdout } = verify([passed('ci'), passed('e2e'), passed('pr-title')]);
    expect(status).toBe(0);
    expect(stdout).toContain('ci: success');
    expect(stdout).toContain('e2e: success');
    expect(stdout).toContain('pr-title: success');
  });

  it.each([
    ['失敗した', [passed('ci'), run('e2e', 'completed', 'failure')], 'e2e', 'failure'],
    ['取り消された', [passed('ci'), run('e2e', 'completed', 'cancelled')], 'e2e', 'cancelled'],
    ['まだ走っている', [run('ci', 'in_progress'), passed('e2e')], 'ci', 'in_progress'],
    ['まだ始まっていない', [run('ci', 'queued'), passed('e2e')], 'ci', 'queued'],
    ['check run のない（main に push される前のコミットなど）', [passed('ci')], 'e2e', 'not_found'],
  ])('%s必須のチェックがあれば、1 で終わり、名前と状態を出す', (_, checkRuns, name, result) => {
    const { status, stdout } = verify(checkRuns);
    expect(status).toBe(1);
    expect(stdout).toContain(`::error::${SHA} の ${name} が成功していない（${result}）`);
  });

  it('GitHub Actions 以外のアプリが同じ名前で付けた成功は数えない', () => {
    // ルールセットの integration_id と同じ条件で見る
    const { status, stdout } = verify([passed('ci'), run('e2e', 'completed', 'success', 999)]);
    expect(status).toBe(1);
    expect(stdout).toContain('e2e: not_found');
  });

  it.each([
    ['失敗のあとに動かし直して成功すれば、通す', 'failure', 'success', 0],
    ['成功のあとに動かし直して失敗すれば、止める', 'success', 'failure', 1],
  ])('同じ名前の check run が2つあれば、新しいほうを見る: %s', (_, older, newer, expected) => {
    const checkRuns = [
      passed('ci'),
      passed('pr-title'),
      run('e2e', 'completed', older),
      run('e2e', 'completed', newer),
    ];
    expect(verify(checkRuns).status).toBe(expected);
  });

  it('ルールセットに必須のチェックがなければ、何も確かめていないので 1 で終わる', () => {
    const empty = join(fakeBin, 'ruleset.json');
    writeFileSync(empty, JSON.stringify({ rules: [{ type: 'deletion' }] }));
    const { status, stdout } = verify([passed('ci'), passed('e2e')], empty);
    expect(status).toBe(1);
    expect(stdout).toContain('::error::');
  });
});
