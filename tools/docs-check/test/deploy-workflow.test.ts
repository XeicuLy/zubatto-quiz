import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Step = {
  id?: string;
  name?: string;
  if?: string;
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
  outputs?: Record<string, string>;
  'timeout-minutes'?: number;
  steps?: Step[];
};
type Workflow = {
  on: {
    workflow_dispatch?: { inputs?: Record<string, { type: string; options?: string[]; default?: string }> };
    pull_request?: { branches?: string[] };
    push?: { branches?: string[] };
  } & Record<string, unknown>;
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

/** job か step の中で secrets.<名前> として読んでいる secret の名前 */
const secretsReadBy = (target: Job | Step) =>
  [...JSON.stringify(target).matchAll(/secrets\.(\w+)/g)].map(([, name]) => name);

const needsOf = (job: Job) => [job.needs ?? []].flat();

/** job が needs で（直接か、前の job を通して）待つ job の ID */
const ancestorsOf = (id: string): string[] =>
  needsOf(workflow.jobs[id] ?? {}).flatMap((need) => [need, ...ancestorsOf(need)]);

/** CI の結果を確かめ、版を決めるだけの job。本番には触らない */
const VERIFY_CI = 'verify-ci';
/** デプロイのあとにタグ・Release・CHANGELOG の PR を作る job。production ではなく release の Environment を使う */
const RELEASE = 'release';
const deployJobIds = Object.keys(workflow.jobs).filter((id) => id !== VERIFY_CI && id !== RELEASE);

/** deploy.yaml を動かすところ。ブランチ（ふつうは main）か、前の版に戻すときのタグ */
type RefType = 'branch' | 'tag';

/**
 * job か step の if の式を、GitHub Actions の決まりで評価する。この workflow で使う形だけを知っていて、ほかの形は例外にする。
 * 状態の関数（success()・failure()・cancelled()・always()）がない式には、先頭に success() が付いたものとして扱う。
 * job では「needs の相手がどれも成功した」、step では「前の step がどれも成功した」が success() になる
 */
function evaluateIf(expression: string | undefined, { refType, succeeded }: { refType: RefType; succeeded: boolean }) {
  const body = (expression ?? '').replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
  const terms = body === '' ? [] : body.split(/\s*&&\s*/);
  const values = terms.map((term) => {
    const ref = term.match(/^github\.ref_type == '(\w+)'$/);
    if (ref) return refType === ref[1];
    throw new Error(`知らない if の式: ${term}`);
  });
  return succeeded && values.every(Boolean);
}

/** 動いた job か step の結果 */
type Result = 'success' | 'failure' | 'skipped';

/**
 * refType の上で動かし、failing（job の ID か、step の name か、step が呼ぶ root のスクリプトの名前）が失敗したときに、
 * 動く job と、本番に触る step が呼ぶ root のスクリプトを、動く順に返す。
 * job は workflow に書いた順で、needs の相手がそれより前にあるものとする
 */
function simulate(refType: RefType, failing?: string) {
  const jobResults = new Map<string, Result>();
  const jobs: string[] = [];
  const scripts: string[] = [];
  for (const [id, job] of Object.entries(workflow.jobs)) {
    const runs = evaluateIf(job.if, {
      refType,
      succeeded: needsOf(job).every((need) => jobResults.get(need) === 'success'),
    });
    if (!runs) {
      jobResults.set(id, 'skipped');
      continue;
    }
    jobs.push(id);
    let jobFailed = id === failing;
    for (const step of job.steps ?? []) {
      if (!evaluateIf(step.if, { refType, succeeded: !jobFailed })) continue;
      const stepScripts = deployJobIds.includes(id) ? rootScriptsOf(step) : [];
      scripts.push(...stepScripts);
      if (failing !== undefined && (step.name === failing || stepScripts.includes(failing))) jobFailed = true;
    }
    jobResults.set(id, jobFailed ? 'failure' : 'success');
  }
  return { jobs, scripts };
}

const MIGRATE = 'db:migrate:remote';
const DEPLOY_API = 'deploy:api';
const DEPLOY_WEB = 'deploy:web';
const ALL = [MIGRATE, DEPLOY_API, DEPLOY_WEB];

const deploy = workflow.jobs.deploy ?? {};
const verifyCi = workflow.jobs[VERIFY_CI] ?? {};
const stepNamed = (job: Job, name: string) => (job.steps ?? []).find((step) => step.name === name);

describe('本番のデプロイの workflow（.github/workflows/deploy.yaml・ADR 0005・0012）', () => {
  it('手で動かしたときだけ動き、Release ができたときや、main へのマージや push では動かない', () => {
    // 本番の最中は何もデプロイしない決まり（ADR 0006・0012）を、マージで破らないため。
    // release: published は外した（ADR 0012）。タグと Release は、デプロイが成功したあとに release job が作る
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  });

  it('手で動かすときは版の上げ方（auto / major / minor / patch）だけを選び、既定は auto', () => {
    // target（画面だけ・全体）はなくした。いつも全体を出す（ADR 0012 の K1）
    expect(workflow.on.workflow_dispatch?.inputs).toEqual({
      bump: {
        description: expect.any(String),
        type: 'choice',
        options: ['auto', 'major', 'minor', 'patch'],
        default: 'auto',
        required: true,
      },
    });
  });

  it('TARGET の env も、step の if での出し分けもない', () => {
    expect(workflow.env).toBeUndefined();
    expect(JSON.stringify(workflow)).not.toMatch(/TARGET|inputs\.target/);
  });

  it.each<RefType>(['branch', 'tag'])(
    '%s の上でも、CI を確かめてから、マイグレーション → API の Worker → 画面の Worker の順に行う',
    (refType) => {
      // Service binding の相手が先にないといけないので、API の Worker を先にする（ADR 0006）
      expect(simulate(refType).scripts).toEqual(ALL);
    },
  );

  it('ブランチの上では、デプロイのあとに release job が動き、タグの上（前の版に戻すとき）では動かない', () => {
    expect(simulate('branch').jobs).toEqual([VERIFY_CI, 'deploy', RELEASE]);
    expect(simulate('tag').jobs).toEqual([VERIFY_CI, 'deploy']);
  });

  it.each([
    [MIGRATE, [MIGRATE]],
    [DEPLOY_API, [MIGRATE, DEPLOY_API]],
    [DEPLOY_WEB, ALL],
  ])('%s が失敗すると、その後ろは動かず、release job も動かない（タグも Release も作らない）', (failing, expected) => {
    expect(simulate('branch', failing)).toEqual({ jobs: [VERIFY_CI, 'deploy'], scripts: expected });
  });

  it.each<RefType>(['branch', 'tag'])('%s の上でも、verify-ci が失敗すると、本番には何も出さない', (refType) => {
    expect(simulate(refType, VERIFY_CI)).toEqual({ jobs: [VERIFY_CI], scripts: [] });
  });

  it('Environment（production）を使う job は1つだけにする', () => {
    // 承認は production を使う job ごとに求められるので、1つにまとめて、承認を1回にする（ADR 0010 の E3）。
    // reviewers は production に残す。承認だけの job を置いて production から外すと、トークンのそばの守りがなくなる（ADR 0009）
    const production = Object.entries(workflow.jobs).filter(([, job]) => job.environment === 'production');
    expect(production.map(([id]) => id)).toEqual(deployJobIds);
    expect(deployJobIds).toEqual(['deploy']);
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

  it('run: には ${{ }} を埋め込まず、outputs や inputs は env で渡す', () => {
    // verify-ci の outputs の文面は commit の題名を含む。埋め込むと、題名に書いたシェルの命令が動く
    const runs = Object.values(workflow.jobs).flatMap(({ steps }) => (steps ?? []).map(({ run }) => run ?? ''));
    expect(runs.filter((run) => run.includes('${{'))).toEqual([]);
  });
});

describe('deploy の最初の確かめ直し（Recheck release base・ADR 0012）', () => {
  const steps = deploy.steps ?? [];
  const guard = stepNamed(deploy, 'Recheck release base');
  const guardIndex = steps.indexOf(guard ?? {});

  it('ブランチの上の run でだけ、release.sh guard で、verify-ci が決めた基準のタグを確かめ直す', () => {
    // Re-run failed jobs は成功済みの verify-ci を動かし直さないので、古い run の Re-run を、本番に出す直前に止める
    expect(guard).toEqual({
      name: 'Recheck release base',
      if: "github.ref_type == 'branch'",
      run: 'bash .github/scripts/release.sh guard',
      env: { GH_TOKEN: '${{ github.token }}', BASE_TAG: '${{ needs.verify-ci.outputs.base-tag }}' },
    });
  });

  it('secret を読むどの step よりも前、依存のコードが動く pnpm install よりも前にある', () => {
    const firstSecretStep = steps.findIndex((step) => secretsReadBy(step).length > 0);
    const install = steps.findIndex(({ run }) => run?.startsWith('pnpm install'));
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(firstSecretStep).toBeGreaterThan(guardIndex);
    expect(install).toBeGreaterThan(guardIndex);
  });

  it('確かめ直しが失敗すると、本番には何も出さない', () => {
    expect(simulate('branch', 'Recheck release base')).toEqual({ jobs: [VERIFY_CI, 'deploy'], scripts: [] });
  });

  it('最新の v* タグを読めるよう、タグごと checkout し、開いた PR を読む権限だけを足す', () => {
    const checkout = steps.find(({ uses }) => uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toEqual({ 'persist-credentials': false, 'fetch-depth': 0 });
    expect(deploy.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
  });
});

describe('デプロイの前に CI の結果を確かめ、版を決める（verify-ci）', () => {
  const steps = verifyCi.steps ?? [];
  const plan = stepNamed(verifyCi, 'Plan release');
  const verify = stepNamed(verifyCi, 'Verify required checks');

  it('Environment を使わず、secret を読まず、読めるのはコード・check run・PR だけにする', () => {
    // 本番のトークンは要らない。checks: read で check run を、pull-requests: read で前の CHANGELOG の PR を読む
    expect(verifyCi.environment).toBeUndefined();
    expect(secretsReadBy(verifyCi)).toEqual([]);
    expect(verifyCi.permissions).toEqual({ contents: 'read', checks: 'read', 'pull-requests': 'read' });
  });

  it('ブランチの上の run でだけ版を決め、CI を待つ前に決める（上げるものがなければ 30 分待たずに止まる）', () => {
    expect(plan).toEqual({
      name: 'Plan release',
      id: 'plan',
      if: "github.ref_type == 'branch'",
      run: 'bash .github/scripts/release.sh plan',
      env: { GH_TOKEN: '${{ github.token }}', BUMP: '${{ inputs.bump }}' },
    });
    expect(steps.indexOf(plan ?? {})).toBeLessThan(steps.indexOf(verify ?? {}));
  });

  it('基準のタグ・版・文面を、outputs で後ろの job に渡す', () => {
    expect(verifyCi.outputs).toEqual({
      'base-tag': '${{ steps.plan.outputs.base-tag }}',
      version: '${{ steps.plan.outputs.version }}',
      'notes-base64': '${{ steps.plan.outputs.notes-base64 }}',
    });
  });

  it('タグと履歴を取り、ci と e2e が書き込めるキャッシュは読まない', () => {
    // 出す版と文面は、App の token を持つ release job にそのまま渡る
    const checkout = steps.find(({ uses }) => uses?.startsWith('actions/checkout@'));
    const mise = steps.find(({ uses }) => uses?.startsWith('jdx/mise-action@'));
    expect(checkout?.with).toEqual({ 'persist-credentials': false, 'fetch-depth': 0 });
    expect(String(mise?.with?.cache)).toBe('false');
    expect(steps.some(({ uses }) => uses?.startsWith('actions/cache@'))).toBe(false);
  });

  it('タグの上の run（前の版に戻すとき）は、版を決めず、CI の確かめだけをする', () => {
    const ran = steps.filter((step) => evaluateIf(step.if, { refType: 'tag', succeeded: true }));
    expect(ran.map(({ name }) => name)).toEqual(['Checkout', 'Verify required checks']);
  });

  it('必須のチェックの名前は、ルールセットのファイル（main-ruleset.json）から読み、workflow に書き写さない', () => {
    // 書き写すと、ルールセットにチェックを足したときに、deploy だけが古い名前のまま確かめてしまう
    // 確かめ方は .github/scripts/verify-required-checks.sh に置き、shellcheck とテスト（verify-required-checks.test.ts）で見る
    expect(verify?.run).toBe('bash .github/scripts/verify-required-checks.sh docs/runbooks/main-ruleset.json');
  });

  it('main の CI が終わるまで待つ。job の timeout-minutes は、待つ上限（CI_WAIT_SECONDS）より長くする', () => {
    // main の上で動かした run は、直前のマージで動いた main の CI がまだ走っている間に始まりうる（ADR 0010 の Q1）。
    // job の timeout が先に来ると、上限を過ぎたときの「どのチェックが終わらないか」が出ないまま止まる
    expect(verify?.env).toEqual({ GH_TOKEN: '${{ github.token }}', CI_WAIT_SECONDS: '1800', CI_POLL_SECONDS: '30' });
    expect((verifyCi['timeout-minutes'] ?? 0) * 60).toBeGreaterThan(Number(verify?.env?.CI_WAIT_SECONDS));
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

  it('Cloudflare の secret を読むのは deploy だけ', () => {
    // release は App の鍵だけを持ち、Cloudflare のトークンと同じ job に入れない（ADR 0012 の J2）
    const readers = Object.entries(workflow.jobs).filter(([, job]) =>
      secretsReadBy(job).some((name) => name?.startsWith('CLOUDFLARE_')),
    );
    expect(readers.map(([id]) => id)).toEqual(['deploy']);
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
    expect(deployJobIds.flatMap((id) => rootScriptsRunBy(workflow.jobs[id] ?? {}))).toEqual(ALL);
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

describe('simulate（GitHub Actions の job と step の決まりの写し）', () => {
  it('状態の関数がない if は、needs の相手か前の step が成功していなければ、飛ばされる', () => {
    const branchOnly = "github.ref_type == 'branch'";
    expect(evaluateIf(undefined, { refType: 'branch', succeeded: false })).toBe(false);
    expect(evaluateIf(branchOnly, { refType: 'branch', succeeded: false })).toBe(false);
    expect(evaluateIf(branchOnly, { refType: 'branch', succeeded: true })).toBe(true);
    expect(evaluateIf(branchOnly, { refType: 'tag', succeeded: true })).toBe(false);
  });

  it('知らない式は例外にする（写しにない決まりで、黙って判定しない）', () => {
    expect(() => evaluateIf('${{ always() }}', { refType: 'branch', succeeded: true })).toThrow('知らない if の式');
  });
});
