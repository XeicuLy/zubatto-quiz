import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Step = { if?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = {
  needs?: string | string[];
  if?: string;
  environment?: string;
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  steps?: Step[];
};
type Workflow = {
  on: {
    workflow_dispatch?: { inputs?: Record<string, { type: string; options?: string[]; default?: string }> };
    release?: { types?: string[] };
    pull_request?: { branches?: string[] };
    push?: { branches?: string[] };
  };
  env?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};
type PackageJson = { name: string; scripts?: Record<string, string>; devDependencies?: Record<string, string> };

const workflow = parse(readRepoFile('.github/workflows/deploy.yaml')) as Workflow;
const ciWorkflow = parse(readRepoFile('.github/workflows/ci.yaml')) as Workflow;

const packageJsonOf = (dir: string) => JSON.parse(readRepoFile(`${dir}package.json`)) as PackageJson;
const rootPackage = packageJsonOf('');
const apiPackage = packageJsonOf('apps/api/');
const webPackage = packageJsonOf('apps/web/');

/**
 * root のスクリプトをたどり、最後に動くパッケージのスクリプトの中身を返す。
 * root のスクリプトは `pnpm --filter <パッケージ名> run <スクリプト名>` の形で、パッケージのスクリプトを呼ぶ
 */
function resolveRootScript(name: string): string {
  const script = rootPackage.scripts?.[name];
  if (script === undefined) throw new Error(`root の package.json に ${name} がない`);
  const [, packageName, packageScript = ''] = script.match(/^pnpm --filter (\S+) run (\S+)$/) ?? [];
  const target = [apiPackage, webPackage].find((pkg) => pkg.name === packageName);
  const resolved = target?.scripts?.[packageScript];
  if (resolved === undefined) throw new Error(`root の ${name}（${script}）が呼ぶスクリプトがない`);
  return resolved;
}

/** step が `pnpm run <名前>` で呼ぶ root のスクリプトの名前 */
const rootScriptsOf = ({ run }: Step) => [...(run ?? '').matchAll(/^pnpm run (\S+)$/gm)].map(([, name]) => name ?? '');

/** workflow の step が `pnpm run <名前>` で呼ぶ root のスクリプトの名前を、job ごとに返す */
const rootScriptsRunBy = (job: Job) => (job.steps ?? []).flatMap(rootScriptsOf);

/** job の中で secrets.<名前> として読んでいる secret の名前 */
const secretsReadBy = (job: Job) => [...JSON.stringify(job).matchAll(/secrets\.(\w+)/g)].map(([, name]) => name);

const needsOf = (job: Job) => [job.needs ?? []].flat();

/** job が needs で（直接か、前の job を通して）待つ job の ID */
const ancestorsOf = (id: string): string[] =>
  needsOf(workflow.jobs[id] ?? {}).flatMap((need) => [need, ...ancestorsOf(need)]);

/** CI の結果を確かめるだけの job。本番には触らない */
const VERIFY_CI = 'verify-ci';
const deployJobIds = Object.keys(workflow.jobs).filter((id) => id !== VERIFY_CI);

/** deploy.yaml を動かすきっかけ。手で動かすとき（workflow_dispatch）は target を選ぶ */
type Trigger = { event: 'release' } | { event: 'workflow_dispatch'; target: 'web' | 'all' };

/**
 * workflow の env.TARGET の式を評価する。この workflow で使う形（Release なら決まった値、手で動かしたら選んだ値）だけを知っていて、
 * ほかの形は例外にする。release のイベントでは inputs がない
 */
function targetOf(trigger: Trigger): string {
  const expression = workflow.env?.TARGET ?? '';
  const [, event, value] =
    expression.match(/^\$\{\{\s*github\.event_name == '(\w+)' && '(\w+)' \|\| inputs\.target\s*\}\}$/) ?? [];
  if (event === undefined) throw new Error(`知らない env.TARGET の式: ${expression}`);
  if (trigger.event === event) return value ?? '';
  return trigger.event === 'workflow_dispatch' ? trigger.target : '';
}

/**
 * job か step の if の式を、GitHub Actions の決まりで評価する。この workflow で使う形だけを知っていて、ほかの形は例外にする。
 * 状態の関数（success()・failure()・cancelled()・always()）がない式には、先頭に success() が付いたものとして扱う。
 * job では「needs の相手がどれも成功した」、step では「前の step がどれも成功した」が success() になる
 */
function evaluateIf(
  expression: string | undefined,
  { target, succeeded }: { target: string; succeeded: boolean },
): boolean {
  const body = (expression ?? '').replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
  const terms = body === '' ? [] : body.split(/\s*&&\s*/);
  const values = terms.map((term) => {
    const env = term.match(/^env\.TARGET == '(\w+)'$/);
    if (env) return target === env[1];
    throw new Error(`知らない if の式: ${term}`);
  });
  return succeeded && values.every(Boolean);
}

/** 動いた job か step の結果 */
type Result = 'success' | 'failure' | 'skipped';

/**
 * trigger で動かし、failing（job の ID か、step が呼ぶ root のスクリプトの名前）が失敗したときに、
 * 本番に触る step が呼ぶ root のスクリプトを、動く順に返す。
 * job は workflow に書いた順で、needs の相手がそれより前にあるものとする
 */
function scriptsThatRun(trigger: Trigger, failing?: string): string[] {
  const target = targetOf(trigger);
  const jobResults = new Map<string, Result>();
  const scripts: string[] = [];
  for (const [id, job] of Object.entries(workflow.jobs)) {
    const runs = evaluateIf(job.if, {
      target,
      succeeded: needsOf(job).every((need) => jobResults.get(need) === 'success'),
    });
    if (!runs) {
      jobResults.set(id, 'skipped');
      continue;
    }
    let jobFailed = id === failing;
    for (const step of job.steps ?? []) {
      if (!evaluateIf(step.if, { target, succeeded: !jobFailed })) continue;
      const stepScripts = id === VERIFY_CI ? [] : rootScriptsOf(step);
      scripts.push(...stepScripts);
      if (failing !== undefined && stepScripts.includes(failing)) jobFailed = true;
    }
    jobResults.set(id, jobFailed ? 'failure' : 'success');
  }
  return scripts;
}

const MIGRATE = 'db:migrate:remote';
const DEPLOY_API = 'deploy:api';
const DEPLOY_WEB = 'deploy:web';

describe('本番のデプロイの workflow（.github/workflows/deploy.yaml・ADR 0005・0010）', () => {
  it('手で動かしたときと、Release ができたときだけ動き、main へのマージや push では動かない', () => {
    // 本番中は API の Worker をデプロイしない決まり（ADR 0006）を、マージで破らないため。
    // Release で動いても、production の承認がなければ本番には出ない（ADR 0009・0010）
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch', 'release']);
    // draft を作っただけでは動かさない。published は、draft でない Release ができたときと、draft を公開したときに動く
    expect(workflow.on.release).toEqual({ types: ['published'] });
  });

  it('手で動かすときに「画面だけ」（web）か「API と画面」（all）かを選び、選ばなければ画面だけになる', () => {
    // 既定を web にしておくと、本番中にうっかりそのまま動かしても API の Worker はデプロイされない
    expect(workflow.on.workflow_dispatch?.inputs?.target).toEqual({
      description: expect.any(String),
      type: 'choice',
      options: ['web', 'all'],
      default: 'web',
      required: true,
    });
  });

  it('「画面だけ」では、CI を確かめてから、画面の Worker だけをデプロイする', () => {
    expect(scriptsThatRun({ event: 'workflow_dispatch', target: 'web' })).toEqual([DEPLOY_WEB]);
  });

  it('「API と画面」では、CI を確かめてから、マイグレーション → API の Worker → 画面の Worker の順に行う', () => {
    // Service binding の相手が先にないといけないので、API の Worker を先にする（ADR 0006）
    expect(scriptsThatRun({ event: 'workflow_dispatch', target: 'all' })).toEqual([MIGRATE, DEPLOY_API, DEPLOY_WEB]);
  });

  it('Release で動くときは、「API と画面」と同じ順にすべてを行う', () => {
    // release のイベントには inputs がない。前のタグとの差は見ずに、いつも all にする（ADR 0010 の N1）
    expect(scriptsThatRun({ event: 'release' })).toEqual([MIGRATE, DEPLOY_API, DEPLOY_WEB]);
  });

  it.each([
    [MIGRATE, [MIGRATE]],
    [DEPLOY_API, [MIGRATE, DEPLOY_API]],
  ])('「API と画面」で %s が失敗すると、その後ろは動かない', (failing, expected) => {
    expect(scriptsThatRun({ event: 'release' }, failing)).toEqual(expected);
    expect(scriptsThatRun({ event: 'workflow_dispatch', target: 'all' }, failing)).toEqual(expected);
  });

  it.each<Trigger>([
    { event: 'workflow_dispatch', target: 'web' },
    { event: 'workflow_dispatch', target: 'all' },
    { event: 'release' },
  ])('%o でも、verify-ci が失敗すると、本番には何も出さない', (trigger) => {
    expect(scriptsThatRun(trigger, VERIFY_CI)).toEqual([]);
  });

  it('Environment（production）を使う job は1つだけにする', () => {
    // 承認は production を使う job ごとに求められるので、1つにまとめて、承認を1回にする（ADR 0010 の E3）。
    // reviewers は production に残す。承認だけの job を置いて production から外すと、トークンのそばの守りがなくなる（ADR 0009）
    const production = Object.entries(workflow.jobs).filter(([, job]) => job.environment === 'production');
    expect(production.map(([id]) => id)).toEqual(deployJobIds);
    expect(deployJobIds).toHaveLength(1);
  });

  it('本番に触る job は、どれも needs をたどると verify-ci を待つ', () => {
    // あとから job を足したときに、needs を書き忘れて CI を確かめずに動くことがないように
    expect(deployJobIds.length).toBeGreaterThan(0);
    for (const id of deployJobIds) {
      expect(ancestorsOf(id)).toContain(VERIFY_CI);
    }
  });

  it('本番に触る job の timeout-minutes は、マイグレーション・API・画面の3つを行える長さにする', () => {
    // 2026-10-28 の all では、job ごとに 20 秒ほどだった（job を分けていたときは 15 分ずつ）
    for (const id of deployJobIds) {
      expect(workflow.jobs[id]?.['timeout-minutes']).toBe(30);
    }
  });
});

describe('デプロイの前に CI の結果を確かめる（verify-ci）', () => {
  const verifyCi = workflow.jobs[VERIFY_CI] ?? {};
  const runOf = (job: Job) => (job.steps ?? []).map(({ run }) => run ?? '').join('\n');

  it('Environment を使わず、secret を読まず、読めるのはコードと check run だけにする', () => {
    // 本番のトークンは要らない。checks: read で check run を読み、contents: read でルールセットのファイルを checkout する
    expect(verifyCi.environment).toBeUndefined();
    expect(secretsReadBy(verifyCi)).toEqual([]);
    expect(verifyCi.permissions).toEqual({ contents: 'read', checks: 'read' });
  });

  it('必須のチェックの名前は、ルールセットのファイル（main-ruleset.json）から読み、workflow に書き写さない', () => {
    // 書き写すと、ルールセットにチェックを足したときに、deploy だけが古い名前のまま確かめてしまう
    // 確かめ方は .github/scripts/verify-required-checks.sh に置き、shellcheck とテスト（verify-required-checks.test.ts）で見る
    const scriptPath = '.github/scripts/verify-required-checks.sh';
    const rulesetPath = 'docs/runbooks/main-ruleset.json';
    const checkout = (verifyCi.steps ?? []).find(({ uses }) => uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    expect(String(checkout?.with?.['sparse-checkout']).trim().split('\n')).toEqual([scriptPath, rulesetPath]);
    expect(runOf(verifyCi).trim()).toBe(`bash ${scriptPath} ${rulesetPath}`);
  });

  it('main の CI が終わるまで待つ。job の timeout-minutes は、待つ上限（CI_WAIT_SECONDS）より長くする', () => {
    // Release の run は、リリース PR のマージで動いた main の CI がまだ走っている間に始まる（ADR 0010 の Q1）。
    // job の timeout が先に来ると、上限を過ぎたときの「どのチェックが終わらないか」が出ないまま止まる
    const step = (verifyCi.steps ?? []).find(({ run }) => run?.includes('verify-required-checks.sh'));
    expect(step?.env).toEqual({ GH_TOKEN: '${{ github.token }}', CI_WAIT_SECONDS: '1800', CI_POLL_SECONDS: '30' });
    expect((verifyCi['timeout-minutes'] ?? 0) * 60).toBeGreaterThan(Number(step?.env?.CI_WAIT_SECONDS));
  });

  it('ci.yaml は PR のほか、main への push でも動く（merge commit にも ci と e2e のチェックを付ける）', () => {
    // PR の CI は試しのマージコミット（refs/pull/N/merge）で動くので、main に入ったコミットにはチェックが付かない
    expect(ciWorkflow.on.pull_request?.branches).toEqual(['main']);
    expect(ciWorkflow.on.push?.branches).toEqual(['main']);
  });
});

describe('Cloudflare の API トークン（ADR 0005 の DD4）', () => {
  it('デプロイの job は、どれも Environment（production）の secret から API トークンとアカウント ID を読む', () => {
    // environment: production を書いた job だけが、その Environment の secret を読める。verify-ci は本番に触らないので除く
    for (const id of deployJobIds) {
      const job = workflow.jobs[id] ?? {};
      expect(job.environment).toBe('production');
      expect(secretsReadBy(job)).toEqual(expect.arrayContaining(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']));
    }
  });

  it('PR ごとの CI（ci.yaml）は、Environment を使わず、どこからも secret を読まない', () => {
    // PR のブランチのコードが動くので、トークンを読めると、マージ前のコードで本番を書き換えられてしまう
    for (const job of Object.values(ciWorkflow.jobs)) {
      expect(job.environment).toBeUndefined();
    }
    // job の外（workflow の先頭の env）も見る。secrets.X のほか、secrets['X']・toJSON(secrets)・secrets: inherit でも
    // 読めるので、形を問わず secrets の語がないことを確かめる。コメントは YAML を読んだ時点で消える
    expect(/\bsecrets\b/.test(JSON.stringify(ciWorkflow))).toBe(false);
  });
});

describe('デプロイとマイグレーションのスクリプト', () => {
  it('同じ workflow を同時に2つ動かさず、動いているものは止めず、待つのは最後に頼んだ1つだけにする', () => {
    // 途中で止めると、マイグレーションだけ当たって API がデプロイされない、といった半端な状態が残る。
    // queue: max（すべてを並べる）は付けない。並んだ順に動く保証がなく、古いコミットがあとからデプロイされうる
    expect(workflow.concurrency).toEqual({ group: 'deploy-production', 'cancel-in-progress': false });
  });

  it('本番に触る job は、root の3つのスクリプトをこの順に呼ぶ', () => {
    expect(deployJobIds.flatMap((id) => rootScriptsRunBy(workflow.jobs[id] ?? {}))).toEqual([
      MIGRATE,
      DEPLOY_API,
      DEPLOY_WEB,
    ]);
  });

  it.each([
    [MIGRATE, 'wrangler d1 migrations apply DB --remote --env=""'],
    [DEPLOY_API, 'wrangler deploy --env=""'],
    // ビルドの直後にデプロイする。前に E2E のビルド（--mode e2e）をしていても、その設定でデプロイしない
    [DEPLOY_WEB, 'vite build && wrangler deploy'],
  ])('root の %s は、パッケージの「%s」を動かす', (rootScript, packageScript) => {
    // API の wrangler.jsonc には env.e2e があるので、本番は --env="" で先頭の設定を選ぶ（ADR 0003）
    expect(resolveRootScript(rootScript)).toBe(packageScript);
  });

  it('API の wrangler.jsonc の D1 の binding には database_id を書かない', () => {
    // wrangler は名前（zubakui）で D1 を探す。ID を書くと、ローカルの D1 が別の空のものに替わる（ADR 0005）
    // コメントの「database_id は書かない」には当てず、キーとして書いたときだけ見つける
    expect(readRepoFile('apps/api/wrangler.jsonc').includes('"database_id"')).toBe(false);
  });

  it.each([
    ['apps/api', apiPackage],
    ['apps/web', webPackage],
  ])('%s の wrangler は 4.113.0 以上（ID のない D1 の binding を名前で結びつける版）', (_, pkg) => {
    const [major = 0, minor = 0] = (pkg.devDependencies?.wrangler ?? '').split('.').map(Number);
    expect(major > 4 || (major === 4 && minor >= 113)).toBe(true);
  });
});

describe('scriptsThatRun（GitHub Actions の job と step の決まりの写し）', () => {
  it('状態の関数がない if は、needs の相手か前の step が成功していなければ、飛ばされる', () => {
    expect(evaluateIf(undefined, { target: 'all', succeeded: false })).toBe(false);
    expect(evaluateIf("env.TARGET == 'all'", { target: 'all', succeeded: false })).toBe(false);
    expect(evaluateIf("env.TARGET == 'all'", { target: 'all', succeeded: true })).toBe(true);
    expect(evaluateIf("env.TARGET == 'all'", { target: 'web', succeeded: true })).toBe(false);
  });

  it('知らない式は例外にする（写しにない決まりで、黙って判定しない）', () => {
    expect(() => evaluateIf('${{ always() }}', { target: 'web', succeeded: true })).toThrow('知らない if の式');
  });
});
