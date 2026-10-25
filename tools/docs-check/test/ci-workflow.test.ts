import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Step = { id?: string; name?: string; if?: string; uses?: string; run?: string; with?: Record<string, string> };
type Job = { uses?: string; steps?: Step[] };
type Workflow = { jobs: Record<string, Job> };

const ciWorkflow = parse(readRepoFile('.github/workflows/ci.yaml')) as Workflow;
const workflowFiles = readdirSync(new URL('../../../.github/workflows/', import.meta.url)).filter((file) =>
  /\.ya?ml$/.test(file),
);

const stepsOf = (jobId: string) => ciWorkflow.jobs[jobId]?.steps ?? [];
const cacheSteps = (steps: Step[]) => steps.filter(({ uses }) => uses?.startsWith('actions/cache@'));
const indexOfRun = (steps: Step[], pattern: RegExp) => steps.findIndex(({ run }) => pattern.test(run ?? ''));

/**
 * workflow の uses: の値と、その行の版のコメント（# の後ろ）を、書いた順に返す。
 * コメントは YAML を読むと消えるので、ファイルの文字列から読む。読み落としがないように、YAML から集めた uses と同じ並びでなければ例外にする
 */
function actionRefsOf(text: string): { uses: string; comment?: string }[] {
  const fromYaml = Object.values((parse(text) as Workflow).jobs).flatMap((job) =>
    [job.uses, ...(job.steps ?? []).map(({ uses }) => uses)].filter((uses) => uses !== undefined),
  );
  const fromText = [
    ...text.matchAll(/^\s*(?:-\s+)?uses\s*:\s*(['"]?)([^\s'"#]+)\1[ \t]*(?:#[ \t]*(.*?))?[ \t]*$/gm),
  ].map(([, , uses = '', comment]) => (comment === undefined ? { uses } : { uses, comment }));
  if (JSON.stringify(fromText.map(({ uses }) => uses)) !== JSON.stringify(fromYaml)) {
    throw new Error(`uses: を文字列から読みきれない: ${JSON.stringify(fromYaml)}`);
  }
  return fromText;
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

describe('actionRefsOf', () => {
  it.each([
    [
      '版のコメントを読む',
      'jobs:\n  ci:\n    steps:\n      - uses: a/b@c # v1.2.0\n',
      [{ uses: 'a/b@c', comment: 'v1.2.0' }],
    ],
    ['コメントがなければ undefined', 'jobs:\n  ci:\n    steps:\n      - uses: a/b@v4\n', [{ uses: 'a/b@v4' }]],
    ['コロンの前の空白も読む', 'jobs:\n  ci:\n    steps:\n      - uses : a/b@v4\n', [{ uses: 'a/b@v4' }]],
    ['引用符を外す', "jobs:\n  ci:\n    steps:\n      - uses: 'a/b@c' # v1\n", [{ uses: 'a/b@c', comment: 'v1' }]],
    [
      'job の uses（再利用する workflow）も読む',
      'jobs:\n  ci:\n    uses: a/b/.github/workflows/x.yaml@c # v1\n',
      [{ uses: 'a/b/.github/workflows/x.yaml@c', comment: 'v1' }],
    ],
  ])('%s', (_, workflow, expected) => {
    expect(actionRefsOf(workflow)).toEqual(expected);
  });

  it('文字列から読めない書き方（flow の形など）は例外にする（読めなかった uses を黙って飛ばさない）', () => {
    expect(() => actionRefsOf('jobs:\n  ci:\n    steps:\n      - { uses: a/b@v4 }\n')).toThrow('読みきれない');
  });
});

describe('action の固定（すべての workflow）', () => {
  it.each(workflowFiles)('%s の uses: は、どれもコミットの SHA で固定し、版をコメントに書く', (file) => {
    // タグは付け替えられるので、SHA で固定する
    const refs = actionRefsOf(readRepoFile(`.github/workflows/${file}`));
    expect(refs.length).toBeGreaterThan(0);
    for (const { uses, comment } of refs) {
      expect(uses).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      expect(comment).toMatch(/^v\d+(\.\d+)*$/);
    }
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
