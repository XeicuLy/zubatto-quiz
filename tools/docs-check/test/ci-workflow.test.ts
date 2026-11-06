import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Step = {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  'timeout-minutes'?: number;
};
type Job = { uses?: string; env?: Record<string, string>; 'timeout-minutes'?: number; steps?: Step[] };
type Workflow = { env?: Record<string, string>; jobs: Record<string, Job> };

const ciWorkflow = parse(readRepoFile('.github/workflows/ci.yaml')) as Workflow;
const workflowFiles = readdirSync(new URL('../../../.github/workflows/', import.meta.url)).filter((file) =>
  /\.ya?ml$/.test(file),
);

const stepsOf = (jobId: string) => ciWorkflow.jobs[jobId]?.steps ?? [];
const cacheSteps = (steps: Step[]) => steps.filter(({ uses }) => uses?.startsWith('actions/cache@'));
const indexOfRun = (steps: Step[], pattern: RegExp) => steps.findIndex(({ run }) => pattern.test(run ?? ''));

/**
 * run: の中に ${{ }} で直接埋め込んだ、利用者が書ける値（PR の題名、コミットのメッセージ、ブランチ名など）を返す。
 * Actions は ${{ }} をシェルに渡す前に文字列として埋め込むので、題名に `"; curl ... #` と書かれると、そのまま命令として動く
 */
function untrustedExpressionsInRun(text: string): string[] {
  const jobs = Object.values((parse(text) as Workflow).jobs);
  return jobs
    .flatMap(({ steps }) => (steps ?? []).map(({ run }) => run ?? ''))
    .flatMap((run) => [...run.matchAll(/\$\{\{([^}]*)\}\}/g)].map(([, body = '']) => body.trim()))
    .filter((body) => /\bgithub\.(event|head_ref)\b/.test(body));
}

/**
 * gh actions-lock --verify が止めない uses: の書き方を返す（v0.4.1 で、2026-11-05 に確かめた）。
 * 外部の再利用する workflow は lock に載らず、存在しないファイルでも通る。@main や @v7 は lock に載せると通り、動く ref を古いコミットへ戻されても気づけない。
 * コンテナは lock に載らず、タグでも警告だけで通る。digest なら内容は固まるが、使っていないので例外を作らず、同じように止める
 */
function usesThatVerifyMisses(text: string): string[] {
  const jobs = Object.values((parse(text) as Workflow).jobs);
  const isLocal = (uses: string) => uses.startsWith('./');
  const reusableWorkflows = jobs.flatMap(({ uses }) => uses ?? []).filter((uses) => !isLocal(uses));
  const actions = jobs
    .flatMap(({ steps }) => (steps ?? []).flatMap(({ uses }) => uses ?? []))
    .filter((uses) => !isLocal(uses) && !/^[\w.-]+\/[\w./-]+@v\d+\.\d+\.\d+$/.test(uses));
  return [...reusableWorkflows, ...actions];
}

/**
 * step の if の式を、cache-hit の出力だけで評価する。この workflow で使う形だけを知っていて、ほかの形は例外にする。
 * actions/cache の cache-hit は、key がそのまま当たったときだけ 'true' になる（restore-keys で戻したときは 'false'）。
 * 前の step が失敗しない場合を考えるので、failure() は false にする
 */
function evaluateStepIf(expression: string | undefined, cacheHit: Record<string, boolean>): boolean {
  if (expression === undefined) return true;
  const body = expression.replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
  if (body === 'failure()') return false;
  const [, id = '', operator] = body.match(/^steps\.([\w-]+)\.outputs\.cache-hit (==|!=) 'true'$/) ?? [];
  const hit = cacheHit[id];
  if (operator === undefined || hit === undefined) throw new Error(`知らない if の式: ${expression}`);
  return operator === '==' ? hit : !hit;
}

/** e2e の job で、Playwright のキャッシュが当たった（hit）か外れたかに応じて、実際に動く playwright のコマンドを返す */
function playwrightCommandsThatRun(hit: boolean): string[] {
  const steps = stepsOf('e2e');
  const [cache] = cacheSteps(steps).filter(({ with: options }) => options?.path?.includes('ms-playwright'));
  if (cache?.id === undefined) throw new Error('Playwright のキャッシュの step（id 付き）がない');
  return steps
    .filter((step) => evaluateStepIf(step.if, { [cache.id ?? '']: hit }))
    .flatMap(({ run }) => (run ?? '').split('\n'))
    .filter((line) => /\bplaywright install/.test(line));
}

describe('untrustedExpressionsInRun', () => {
  it.each([
    ['PR の題名を埋め込む', 'jobs:\n  a:\n    steps:\n      - run: echo "${{ github.event.pull_request.title }}"\n', 1],
    ['ブランチ名を埋め込む', 'jobs:\n  a:\n    steps:\n      - run: git log ${{ github.head_ref }}\n', 1],
    [
      '環境変数で渡すのはよい',
      'jobs:\n  a:\n    steps:\n      - run: echo "$T"\n        env:\n          T: ${{ github.event.pull_request.title }}\n',
      0,
    ],
    ['利用者が書けない値はよい', 'jobs:\n  a:\n    steps:\n      - run: echo ${{ steps.x.outputs.path }}\n', 0],
  ])('%s', (_, workflow, count) => {
    expect(untrustedExpressionsInRun(workflow)).toHaveLength(count);
  });
});

describe('run: への埋め込み（すべての workflow）', () => {
  it.each(workflowFiles)('%s の run: は、github.event や github.head_ref を ${{ }} で直接埋め込まない', (file) => {
    // 題名などは env: で環境変数にして、シェルの変数として読む
    expect(untrustedExpressionsInRun(readRepoFile(`.github/workflows/${file}`))).toEqual([]);
  });
});

describe('usesThatVerifyMisses', () => {
  const stepUses = (uses: string) => `jobs:\n  a:\n    steps:\n      - uses: ${uses}\n`;
  const jobUses = (uses: string) => `jobs:\n  a:\n    uses: ${uses}\n`;

  it.each([
    ['全桁のタグの action はよい', stepUses('actions/checkout@v7.0.1'), []],
    ['サブフォルダーの action も全桁のタグならよい', stepUses('a/b/c@v1.2.3'), []],
    ['ローカルの action はよい', stepUses('./.github/actions/x'), []],
    ['ローカルの再利用する workflow はよい', jobUses('./.github/workflows/x.yaml'), []],
    ['短いタグの action は止める', stepUses('actions/checkout@v7'), ['actions/checkout@v7']],
    ['ブランチの action は止める', stepUses('actions/checkout@main'), ['actions/checkout@main']],
    [
      'SHA の action は止める（タグに書き換わるので書かない）',
      stepUses(`a/b@${'0'.repeat(40)}`),
      [`a/b@${'0'.repeat(40)}`],
    ],
    ['コンテナの action は止める', stepUses('docker://alpine:3'), ['docker://alpine:3']],
    ['コンテナは digest を付けても止める', stepUses('docker://alpine@sha256:abc'), ['docker://alpine@sha256:abc']],
    [
      '外部の再利用する workflow は全桁のタグでも止める',
      jobUses('a/b/.github/workflows/x.yaml@v1.2.3'),
      ['a/b/.github/workflows/x.yaml@v1.2.3'],
    ],
  ])('%s', (_, workflow, expected) => {
    expect(usesThatVerifyMisses(workflow)).toEqual(expected);
  });
});

describe('uses: の書き方（すべての workflow）', () => {
  it.each(workflowFiles)('%s は、--verify が止めない uses: を書かない', (file) => {
    expect(usesThatVerifyMisses(readRepoFile(`.github/workflows/${file}`))).toEqual([]);
  });
});

describe('mise-action の設定（すべての workflow）', () => {
  const miseSteps = workflowFiles.flatMap((file) => {
    const workflow = parse(readRepoFile(`.github/workflows/${file}`)) as Workflow;
    return Object.entries(workflow.jobs).flatMap(([jobId, job]) =>
      (job.steps ?? [])
        .filter(({ uses }) => uses?.startsWith('jdx/mise-action@'))
        .map((step) => ({ file, jobId, step })),
    );
  });

  it('mise 本体の版を固定し、どの job でも同じ版を使う', () => {
    expect(miseSteps.length).toBeGreaterThan(0);
    const versions = miseSteps.map(({ step }) => step.with?.version);
    for (const version of versions) {
      expect(version).toMatch(/^\d{4}\.\d+\.\d+$/);
    }
    expect(new Set(versions).size).toBe(1);
  });

  it('本番の deploy は、ほかの job が書き込めるキャッシュを読まない', () => {
    const deploy = miseSteps.filter(({ file, jobId }) => file === 'deploy.yaml' && jobId === 'deploy');
    expect(deploy).toHaveLength(1);
    expect(String(deploy[0]?.step.with?.cache)).toBe('false');
  });
});

describe('actions.lock の確認（ci.yaml の ci）', () => {
  const steps = stepsOf('ci');
  const install = steps.find(({ run }) => /gh extension install github\/gh-actions-lock/.test(run ?? ''));
  const verify = steps.find(({ run }) => /gh actions-lock/.test(run ?? ''));

  it('版を指定して入れた拡張の --verify で確かめる', () => {
    expect(install?.run).toMatch(/^gh extension install github\/gh-actions-lock --pin v\d+\.\d+\.\d+$/);
    // --verify-local は、lock の commit をタグの履歴の古いコミットにすり替えても通す（operations.md の表）
    expect(verify?.run).toBe('gh actions-lock --verify');
    expect(steps.indexOf(install ?? {})).toBeLessThan(steps.indexOf(verify ?? {}));
  });

  it('依存パッケージのコードが動く pnpm install より前に確かめる', () => {
    expect(steps.indexOf(verify ?? {})).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf(verify ?? {})).toBeLessThan(indexOfRun(steps, /^pnpm install --frozen-lockfile$/));
  });

  it('GH_TOKEN は github.token を、この2つの step だけに渡す', () => {
    // job や workflow の env に置くと、pnpm install の postinstall やテストのコードからも読める
    expect(steps.filter(({ env }) => env?.GH_TOKEN !== undefined)).toEqual([install, verify]);
    expect(install?.env?.GH_TOKEN).toBe(`\${{ github.token }}`);
    expect(verify?.env?.GH_TOKEN).toBe(`\${{ github.token }}`);
    expect(ciWorkflow.jobs.ci?.env?.GH_TOKEN).toBeUndefined();
    expect(ciWorkflow.env?.GH_TOKEN).toBeUndefined();
  });

  it('通信の不調で ci の時間を使い切らないように、2つの step の時間を短く区切る', () => {
    // いつもは数秒で終わる。api.github.com の TLS handshake timeout で、1つの step に9分かかったことがある（#221）
    const limits = [install, verify].map((step) => step?.['timeout-minutes'] ?? Number.POSITIVE_INFINITY);
    const jobLimit = ciWorkflow.jobs.ci?.['timeout-minutes'] ?? 0;
    expect(limits.reduce((sum, limit) => sum + limit, 0)).toBeLessThan(jobLimit / 2);
  });

  it('operations.md の手順と同じ版を入れる', () => {
    const version = install?.run?.match(/--pin (\S+)$/)?.[1];
    expect(version).toBeDefined();
    expect(readRepoFile('docs/architecture/operations.md')).toContain(
      `gh extension install github/gh-actions-lock --pin ${version}`,
    );
  });
});

describe('pnpm の store のキャッシュ（ci.yaml）', () => {
  it.each(['ci', 'e2e'])('%s の job は、lockfile の hash を鍵にして、pnpm install の前に store を戻す', (jobId) => {
    const steps = stepsOf(jobId);
    const [cache, ...rest] = cacheSteps(steps).filter(({ with: options }) => options?.key?.includes('pnpm'));
    expect(rest).toEqual([]);
    expect(cache?.with?.key).toContain("hashFiles('pnpm-lock.yaml')");
    // store の場所は pnpm の版で変わる（v10・v11…）ので、書き写さずに pnpm store path で読む
    const storePath = steps.find(({ run }) => /pnpm store path/.test(run ?? ''));
    expect(storePath?.id).toBeDefined();
    expect(cache?.with?.path).toBe(`\${{ steps.${storePath?.id}.outputs.path }}`);
    // step の出力は、それより後ろの step からしか読めない
    expect(steps.indexOf(storePath ?? {})).toBeLessThan(steps.indexOf(cache ?? {}));
    expect(steps.indexOf(cache ?? {})).toBeLessThan(indexOfRun(steps, /^pnpm install --frozen-lockfile$/));
  });
});

describe('Playwright のブラウザのキャッシュ（ci.yaml の e2e）', () => {
  it('Playwright の版を鍵にして ~/.cache/ms-playwright を戻し、restore-keys は使わない', () => {
    // 版が違うと、入っているブラウザの revision も違うので、古いキャッシュを戻しても使えない
    const steps = stepsOf('e2e');
    const [cache] = cacheSteps(steps).filter(({ with: options }) => options?.path?.includes('ms-playwright'));
    const version = steps.find(({ run }) => /playwright --version/.test(run ?? ''));
    expect(version?.id).toBeDefined();
    expect(cache?.with?.path).toBe('~/.cache/ms-playwright');
    expect(cache?.with?.key).toContain(`\${{ steps.${version?.id}.outputs.version }}`);
    expect(cache?.with?.['restore-keys']).toBeUndefined();
    // 版は node_modules の playwright から読むので、pnpm install のあとに置く
    expect(steps.indexOf(version ?? {})).toBeGreaterThan(indexOfRun(steps, /^pnpm install --frozen-lockfile$/));
    expect(steps.indexOf(version ?? {})).toBeLessThan(steps.indexOf(cache ?? {}));
  });

  it('外れたときは、ブラウザと OS のライブラリを両方入れる', () => {
    expect(playwrightCommandsThatRun(false)).toEqual(['pnpm exec playwright install --with-deps chromium']);
  });

  it('当たったときは、OS のライブラリだけを入れる（OS のライブラリはキャッシュできない）', () => {
    expect(playwrightCommandsThatRun(true)).toEqual(['pnpm exec playwright install-deps chromium']);
  });
});

describe('evaluateStepIf（GitHub Actions の step の決まりの写し）', () => {
  it.each([
    ["steps.pw.outputs.cache-hit != 'true'", true, false],
    ["${{ steps.pw.outputs.cache-hit != 'true' }}", false, true],
    ["steps.pw.outputs.cache-hit == 'true'", true, true],
    ['failure()', true, false],
  ])('%s は、cache-hit が %s のとき %s', (expression, hit, expected) => {
    expect(evaluateStepIf(expression, { pw: hit })).toBe(expected);
  });

  it('知らない式や知らない step の id は例外にする（写しにない決まりで、黙って判定しない）', () => {
    expect(() => evaluateStepIf('${{ always() }}', { pw: true })).toThrow('知らない if の式');
    expect(() => evaluateStepIf("steps.other.outputs.cache-hit == 'true'", { pw: true })).toThrow('知らない if の式');
  });
});
