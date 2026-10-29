import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
/** 偽の gh の FAKE_CHECK_RUNS で、その回の check run の読み出しを失敗させる印 */
const API_ERROR = 'api_error';

type CheckRun = { name: string; app_id: number; id: number; status: string; conclusion: string | null };
type Round = CheckRun[] | typeof API_ERROR;

/**
 * 偽の gh。次の2つの呼び方だけを知っていて、ほかの呼び方や、違うリポジトリ・コミットへの呼び出しは失敗にする。
 *
 * - `gh api repos/<repo>/compare/main...<sha> --jq .status`: FAKE_COMPARE_STATUS（main とこのコミットの関係）を返す
 * - `gh api -X GET repos/<repo>/commits/<sha>/check-runs -f check_name=<名前> -F app_id=<ID> ...`:
 *   FAKE_CHECK_RUNS（回ごとの check run の一覧）から、その名前で呼ばれた回数にあたる一覧を選び、名前と app_id が合うものを
 *   GitHub の API と同じ形（{ check_runs: [...] }）で返す。回数が一覧より多ければ、最後の一覧を返し続ける。
 *   一覧の代わりに API_ERROR があれば、その回は GitHub の API が 5xx を返したときの gh と同じく、1 で終わる。
 *   呼ばれた回数は FAKE_STATE_DIR に名前ごとのファイルで数える
 */
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const fields = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-f' || args[i] === '-F') {
    const [key, ...value] = args[++i].split('=');
    fields[key] = value.join('=');
  }
}
const apiPath = args.find((arg) => arg.startsWith('repos/'));
if (args[0] === 'api' && apiPath === 'repos/${REPOSITORY}/compare/main...${SHA}' && args.includes('.status')) {
  console.log(process.env.FAKE_COMPARE_STATUS);
  process.exit(0);
}
if (args[0] !== 'api' || apiPath !== 'repos/${REPOSITORY}/commits/${SHA}/check-runs') {
  console.error('知らない呼び出し: ' + args.join(' '));
  process.exit(1);
}
const counter = path.join(process.env.FAKE_STATE_DIR, fields.check_name);
const calls = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
fs.writeFileSync(counter, String(calls + 1));
const rounds = JSON.parse(process.env.FAKE_CHECK_RUNS);
const round = rounds[Math.min(calls, rounds.length - 1)];
if (round === '${API_ERROR}') {
  console.error('HTTP 502: Bad Gateway');
  process.exit(1);
}
const runs = round.filter(
  (run) => run.name === fields.check_name && String(run.app_id) === fields.app_id,
);
console.log(JSON.stringify({ total_count: runs.length, check_runs: runs }));
`;

const workDir = mkdtempSync(join(tmpdir(), 'verify-required-checks-'));
const fakeBin = join(workDir, 'bin');
mkdirSync(fakeBin);
writeFileSync(join(fakeBin, 'gh'), FAKE_GH);
chmodSync(join(fakeBin, 'gh'), 0o755);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

type Options = { ruleset?: string; compareStatus?: string; waitSeconds?: number };

/**
 * スクリプトを動かす。rounds は、偽の gh が1回目・2回目…に返す check run の一覧（API_ERROR なら、その回は失敗する）。
 * 待つ上限（CI_WAIT_SECONDS）は既定で 0 にして、1回目で終わらなければすぐ止める。確かめる間隔は 0 にして、テストで待たない
 */
function verifyOver(
  rounds: Round[],
  { ruleset = RULESET, compareStatus = 'identical', waitSeconds = 0 }: Options = {},
) {
  const stateDir = mkdtempSync(join(workDir, 'state-'));
  const { status, stdout } = spawnSync('bash', [SCRIPT, ruleset], {
    encoding: 'utf8',
    env: {
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_SHA: SHA,
      CI_WAIT_SECONDS: String(waitSeconds),
      CI_POLL_SECONDS: '0',
      FAKE_CHECK_RUNS: JSON.stringify(rounds),
      FAKE_COMPARE_STATUS: compareStatus,
      FAKE_STATE_DIR: stateDir,
    },
  });
  // check run を確かめた回数（名前ごと）
  const calls = Object.fromEntries(
    readdirSync(stateDir).map((name) => [name, Number(readFileSync(join(stateDir, name), 'utf8'))]),
  );
  return { status, stdout, calls };
}

const verify = (checkRuns: CheckRun[], options?: Options) => verifyOver([checkRuns], options);

let nextId = 1;
const run = (name: string, status: string, conclusion: string | null = null, appId = ACTIONS_APP_ID): CheckRun => ({
  name,
  app_id: appId,
  id: nextId++,
  status,
  conclusion,
});
const passed = (name: string) => run(name, 'completed', 'success');
const allPassed = () => [passed('ci'), passed('e2e'), passed('pr-title')];

describe('verify-required-checks.sh（deploy.yaml の verify-ci）', () => {
  it('ルールセットの必須のチェック（ci・e2e・pr-title）がどれも成功していれば、0 で終わる', () => {
    const { status, stdout } = verify(allPassed());
    expect(status).toBe(0);
    expect(stdout).toContain('ci: success');
    expect(stdout).toContain('e2e: success');
    expect(stdout).toContain('pr-title: success');
  });

  it.each([
    ['失敗した', [passed('ci'), run('e2e', 'completed', 'failure'), passed('pr-title')], 'e2e', 'failure'],
    ['取り消された', [passed('ci'), run('e2e', 'completed', 'cancelled'), passed('pr-title')], 'e2e', 'cancelled'],
  ])('%s必須のチェックがあれば、1 で終わり、名前と状態を出す', (_, checkRuns, name, result) => {
    const { status, stdout } = verify(checkRuns, { waitSeconds: 60 });
    expect(status).toBe(1);
    expect(stdout).toContain(`::error::${SHA} の ${name} が成功していない（${result}）`);
  });

  it('失敗したものがあれば、ほかのチェックがまだ走っていても待たずに止める', () => {
    // 上限まで待っても、失敗した結果は変わらない
    const { status, calls } = verifyOver(
      [[run('ci', 'in_progress'), run('e2e', 'completed', 'failure'), passed('pr-title')], allPassed()],
      { waitSeconds: 60 },
    );
    expect(status).toBe(1);
    expect(calls).toEqual({ ci: 1, e2e: 1, 'pr-title': 1 });
  });

  it.each([
    ['まだ走っている', 'in_progress', run('ci', 'in_progress')],
    ['まだ始まっていない', 'queued', run('ci', 'queued')],
    ['check run がまだない（CI の job が作られる前など）', 'not_found', undefined],
  ])('%s必須のチェックは、終わるまで待ち、成功すれば 0 で終わる', (_, result, pending) => {
    // Release の run は、リリース PR のマージで動いた main の CI がまだ走っている間に始まる（ADR 0010 の Q1）
    const first = [...(pending ? [pending] : []), passed('e2e'), passed('pr-title')];
    const { status, stdout, calls } = verifyOver([first, first, allPassed()], { waitSeconds: 60 });
    expect(status).toBe(0);
    expect(stdout).toContain(`ci: ${result}`);
    expect(stdout).toContain('ci: success');
    expect(calls.ci).toBe(3);
  });

  it.each([
    ['in_progress', run('ci', 'in_progress')],
    ['queued', run('ci', 'queued')],
    ['not_found', undefined],
  ])('待つ上限（CI_WAIT_SECONDS）を過ぎても %s のままなら、1 で終わり、名前と状態を出す', (result, pending) => {
    const { status, stdout } = verify([...(pending ? [pending] : []), passed('e2e'), passed('pr-title')], {
      waitSeconds: 0,
    });
    expect(status).toBe(1);
    expect(stdout).toContain(`::error::${SHA} の ci が 0 秒待っても終わらない（${result}）`);
  });

  it('check run を読む gh api が一時的に失敗しても止まらず、次の周で確かめ直す', () => {
    // 30 分の間に GitHub の API が一度 5xx を返しただけで、Release の run を動かし直すことにならないように
    const { status, stdout, calls } = verifyOver([API_ERROR, allPassed()], { waitSeconds: 60 });
    expect(status).toBe(0);
    expect(stdout).toContain(`ci: ${API_ERROR}`);
    expect(stdout).toContain('ci: success');
    expect(calls.ci).toBe(2);
  });

  it('gh api が失敗し続けたまま待つ上限を過ぎたら、1 で終わり、api_error と出す', () => {
    // 認証のエラーのように、待っても直らない失敗も、上限まで待ってから止まる
    const { status, stdout } = verifyOver([API_ERROR], { waitSeconds: 0 });
    expect(status).toBe(1);
    expect(stdout).toContain(`::error::${SHA} の ci が 0 秒待っても終わらない（${API_ERROR}）`);
  });

  it('GitHub Actions 以外のアプリが同じ名前で付けた成功は数えない', () => {
    // ルールセットの integration_id と同じ条件で見る
    const { status, stdout } = verify([passed('ci'), run('e2e', 'completed', 'success', 999), passed('pr-title')]);
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
    const empty = join(workDir, 'ruleset.json');
    writeFileSync(empty, JSON.stringify({ rules: [{ type: 'deletion' }] }));
    const { status, stdout } = verify(allPassed(), { ruleset: empty });
    expect(status).toBe(1);
    expect(stdout).toContain('::error::');
  });
});

describe('コミットが main の履歴にあるか（ADR 0010）', () => {
  it.each([
    ['main の先頭（手で main の上で動かしたとき）', 'identical'],
    ['main の先頭より前（Release のあとに別の PR が入ったとき・前の版のタグで動かしたとき）', 'behind'],
  ])('%s なら、チェックを確かめに進む', (_, compareStatus) => {
    const { status, stdout } = verify(allPassed(), { compareStatus });
    expect(status).toBe(0);
    expect(stdout).toContain(`main: ${compareStatus}`);
  });

  it.each([
    ['main にまだ入っていない（main より先にある）', 'ahead'],
    ['main から分かれた', 'diverged'],
  ])('%s コミットなら、チェックを見ずに 1 で終わる', (_, compareStatus) => {
    // main にないコミットは、main のルールセット（PR 必須・必須のチェック）を通っていない
    const { status, stdout, calls } = verify(allPassed(), { compareStatus });
    expect(status).toBe(1);
    expect(stdout).toContain(`::error::${SHA} は main の履歴にない（${compareStatus}）`);
    expect(calls).toEqual({});
  });
});
