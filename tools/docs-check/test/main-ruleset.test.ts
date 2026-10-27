import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Rule = { type: string; parameters?: Record<string, unknown> };
type Ruleset = { enforcement: string; bypass_actors: unknown[]; rules: Rule[] } & Record<string, unknown>;

const ruleset = JSON.parse(readRepoFile('docs/runbooks/main-ruleset.json')) as Ruleset;

/**
 * workflow の各 job が送るチェックの名前。`jobs.<job_id>.name` があればその値、なければ job ID になる。
 * YAML のパーサーは入れず、jobs: の直下（2字下げ）を job ID、その中の4字下げの name: を表示名として読む
 */
function jobCheckNames(workflow: string): string[] {
  const [, jobs = ''] = workflow.split(/^jobs:$/m);
  return jobs
    .split(/^ {2}(?=[\w-]+:$)/m)
    .slice(1)
    .map((job) => {
      const id = job.slice(0, job.indexOf(':'));
      const name = job.match(/^ {4}name:\s*(.+?)\s*$/m)?.[1]?.replace(/^(['"])(.*)\1$/, '$2');
      return name ?? id;
    });
}

const workflowFiles = readdirSync(new URL('../../../.github/workflows/', import.meta.url)).filter((file) =>
  /\.ya?ml$/.test(file),
);

/** チェックの名前ごとに、それを送る job を持つ workflow のファイル名 */
const workflowsByCheck = (): Record<string, string[]> => {
  const byCheck: Record<string, string[]> = {};
  for (const file of workflowFiles) {
    for (const check of jobCheckNames(readRepoFile(`.github/workflows/${file}`))) {
      (byCheck[check] ??= []).push(file);
    }
  }
  return byCheck;
};

type Triggers = { pull_request?: { branches?: string[] } | null; push?: { branches?: string[] } | null };
const triggersOf = (file: string) => (parse(readRepoFile(`.github/workflows/${file}`)) as { on: Triggers }).on;

const requiredChecks = () => {
  const rule = ruleset.rules.find(({ type }) => type === 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []) as { context: string; integration_id?: number }[];
};

describe('jobCheckNames', () => {
  it.each([
    ['name: がなければ job ID', 'jobs:\n  ci:\n    runs-on: ubuntu-latest\n', ['ci']],
    ['name: があればその値', 'jobs:\n  ci:\n    name: Check\n    runs-on: ubuntu-latest\n', ['Check']],
    ['引用符を外す', "jobs:\n  ci:\n    name: 'CI / check'\n", ['CI / check']],
    [
      'steps の - name: は job の名前にしない',
      'jobs:\n  ci:\n    steps:\n      - name: Checkout\n  e2e:\n    name: E2E\n',
      ['ci', 'E2E'],
    ],
    ['jobs: より前の name: は読まない', 'name: CI\non:\n  pull_request:\njobs:\n  ci:\n    runs-on: x\n', ['ci']],
  ])('%s', (_, workflow, expected) => {
    expect(jobCheckNames(workflow)).toEqual(expected);
  });
});

describe('main のルールセット（docs/runbooks/main-ruleset.json・M1）', () => {
  it('必須のチェックがあり、どれも1つの workflow の job が送るチェックの名前と一致する', () => {
    // job 名だけを変えると、必須のチェックがいつまでも来なくなり、どの PR もマージできなくなる。
    // 2つの workflow が同じ名前を送ると、どちらの結果で通ったのか分からなくなる
    const contexts = requiredChecks().map(({ context }) => context);
    expect(contexts.length).toBeGreaterThan(0);
    // チェックの名前ごとに数を並べて比べるので、落ちたときにどの名前かが分かる
    const byCheck = workflowsByCheck();
    const counts = Object.fromEntries(contexts.map((context) => [context, byCheck[context]?.length ?? 0]));
    expect(counts).toEqual(Object.fromEntries(contexts.map((context) => [context, 1])));
  });

  it('必須のチェックを送る workflow は、main への PR と main への push の両方で動く', () => {
    // deploy.yaml の verify-ci は、必須のチェックが main のコミットで成功しているかを見る。
    // PR だけで動く workflow を必須にすると、どのデプロイも「チェックがない」で止まる
    const byCheck = workflowsByCheck();
    const contexts = requiredChecks().map(({ context }) => context);
    const branchesByCheck = Object.fromEntries(
      contexts.map((context) => {
        const { pull_request: pullRequest, push } = triggersOf(byCheck[context]?.[0] ?? '');
        return [context, { pullRequest: pullRequest?.branches, push: push?.branches }];
      }),
    );
    expect(branchesByCheck).toEqual(
      Object.fromEntries(contexts.map((context) => [context, { pullRequest: ['main'], push: ['main'] }])),
    );
  });

  it('マージは squash だけにする（PR 1つが main の1コミットになり、CHANGELOG の1行になる・ADR 0009）', () => {
    // マージコミットは本文に PR の題名を入れ、release-please がそれと PR の中のコミットの両方を数えて、同じ変更が2行ずつ出る
    const rule = ruleset.rules.find(({ type }) => type === 'pull_request');
    expect(rule?.parameters?.allowed_merge_methods).toEqual(['squash']);
  });

  it('必須のチェックは GitHub Actions から来たものだけを使う', () => {
    // 15368 は GitHub Actions のアプリの ID。ほかの仕組みが同じ ci という名前で成功を送っても使わない
    expect(requiredChecks().every(({ integration_id }) => integration_id === 15368)).toBe(true);
  });

  it('有効で、bypass がない（admin も例外にしない）', () => {
    expect(ruleset.enforcement).toBe('active');
    expect(ruleset.bypass_actors).toEqual([]);
  });

  it('GitHub が付ける項目を含まず、そのまま POST に渡せる', () => {
    for (const key of ['id', 'node_id', 'source', 'source_type', 'created_at', 'updated_at', '_links']) {
      expect(ruleset).not.toHaveProperty(key);
    }
  });
});
