import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Step = { run?: string };
type Job = { needs?: string | string[]; if?: string; environment?: string; steps?: Step[] };
type Workflow = {
  on: { workflow_dispatch?: { inputs?: Record<string, { type: string; options?: string[]; default?: string }> } };
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

/** workflow の step が `pnpm run <名前>` で呼ぶ root のスクリプトの名前を、job ごとに返す */
const rootScriptsRunBy = (job: Job) =>
  (job.steps ?? []).flatMap(({ run }) => [...(run ?? '').matchAll(/^pnpm run (\S+)$/gm)].map(([, name]) => name ?? ''));

/** job の中で secrets.<名前> として読んでいる secret の名前 */
const secretsReadBy = (job: Job) => [...JSON.stringify(job).matchAll(/secrets\.(\w+)/g)].map(([, name]) => name);

const needsOf = (job: Job) => [job.needs ?? []].flat();

/**
 * job の if の式を、GitHub Actions の決まりで評価する。この workflow で使う形だけを知っていて、ほかの形は例外にする。
 * 状態の関数（success()・failure()・cancelled()・always()）がない式には、先頭に success() が付いたものとして扱う
 */
function evaluateIf(
  expression: string | undefined,
  {
    target,
    anyAncestorFailed,
    allNeedsSucceeded,
  }: { target: string; anyAncestorFailed: boolean; allNeedsSucceeded: boolean },
): boolean {
  const body = (expression ?? '').replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
  const terms = body === '' ? [] : body.split(/\s*&&\s*/);
  const usesStatus = terms.some((term) => /\b(success|failure|cancelled|always)\(\)/.test(term));
  const values = terms.map((term) => {
    const input = term.match(/^inputs\.target == '(\w+)'$/);
    if (input) return target === input[1];
    if (term === '!failure()') return !anyAncestorFailed;
    // 手で取り消したときだけ true になる。ここでは取り消さない場合を考える
    if (term === '!cancelled()') return true;
    throw new Error(`知らない if の式: ${term}`);
  });
  return (usesStatus || allNeedsSucceeded) && values.every(Boolean);
}

/**
 * target を選んで動かし、failing の job が失敗したときに、実際に動く job を順に返す。
 * job は workflow に書いた順で、needs の相手がそれより前にあるものとする
 */
function jobsThatRun(target: string, failing?: string): string[] {
  const results = new Map<string, 'success' | 'failure' | 'skipped'>();
  const ancestorsOf = (id: string): string[] =>
    needsOf(workflow.jobs[id] ?? {}).flatMap((need) => [need, ...ancestorsOf(need)]);
  for (const [id, job] of Object.entries(workflow.jobs)) {
    const runs = evaluateIf(job.if, {
      target,
      anyAncestorFailed: ancestorsOf(id).some((ancestor) => results.get(ancestor) === 'failure'),
      allNeedsSucceeded: needsOf(job).every((need) => results.get(need) === 'success'),
    });
    results.set(id, !runs ? 'skipped' : id === failing ? 'failure' : 'success');
  }
  return [...results].filter(([, result]) => result !== 'skipped').map(([id]) => id);
}

describe('本番のデプロイの workflow（.github/workflows/deploy.yaml・ADR 0005）', () => {
  it('手で動かしたときだけ動き、main へのマージや push では動かない', () => {
    // 本番中は API の Worker をデプロイしない決まり（ADR 0006）を、マージで破らないため
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  });

  it('動かすときに「画面だけ」（web）か「API と画面」（all）かを選び、選ばなければ画面だけになる', () => {
    // 既定を web にしておくと、本番中にうっかりそのまま動かしても API の Worker はデプロイされない
    expect(workflow.on.workflow_dispatch?.inputs?.target).toEqual({
      description: expect.any(String),
      type: 'choice',
      options: ['web', 'all'],
      default: 'web',
      required: true,
    });
  });

  it('「画面だけ」では、画面の Worker だけをデプロイする', () => {
    expect(jobsThatRun('web')).toEqual(['deploy-web']);
  });

  it('「API と画面」では、マイグレーション → API の Worker → 画面の Worker の順に行う', () => {
    // Service binding の相手が先にないといけないので、API の Worker を先にする（ADR 0006）
    expect(jobsThatRun('all')).toEqual(['migrate', 'deploy-api', 'deploy-web']);
  });

  it.each([
    ['migrate', ['migrate']],
    ['deploy-api', ['migrate', 'deploy-api']],
  ])('「API と画面」で %s が失敗すると、その後ろは動かない', (failing, expected) => {
    expect(jobsThatRun('all', failing)).toEqual(expected);
  });
});

describe('Cloudflare の API トークン（ADR 0005 の DD4）', () => {
  it('デプロイの job は、どれも Environment（production）の secret から API トークンとアカウント ID を読む', () => {
    // environment: production を書いた job だけが、その Environment の secret を読める
    for (const job of Object.values(workflow.jobs)) {
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

  it.each([
    ['migrate', 'db:migrate:remote', 'wrangler d1 migrations apply DB --remote --env=""'],
    ['deploy-api', 'deploy:api', 'wrangler deploy --env=""'],
    // ビルドの直後にデプロイする。前に E2E のビルド（--mode e2e）をしていても、その設定でデプロイしない
    ['deploy-web', 'deploy:web', 'vite build && wrangler deploy'],
  ])('%s は root の %s を通して、パッケージの「%s」を動かす', (jobId, rootScript, packageScript) => {
    // API の wrangler.jsonc には env.e2e があるので、本番は --env="" で先頭の設定を選ぶ（ADR 0003）
    expect(rootScriptsRunBy(workflow.jobs[jobId] ?? {})).toEqual([rootScript]);
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

describe('jobsThatRun（GitHub Actions の job の決まりの写し）', () => {
  it('状態の関数がない if は、needs の相手が飛ばされると、自分も飛ばされる', () => {
    expect(evaluateIf(undefined, { target: 'web', anyAncestorFailed: false, allNeedsSucceeded: false })).toBe(false);
  });

  it('知らない式は例外にする（写しにない決まりで、黙って判定しない）', () => {
    expect(() =>
      evaluateIf('${{ always() }}', { target: 'web', anyAncestorFailed: false, allNeedsSucceeded: true }),
    ).toThrow('知らない if の式');
  });
});
