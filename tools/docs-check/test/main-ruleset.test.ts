import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

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
  it('必須のチェックがあり、どれも ci.yaml の job が送るチェックの名前と一致する', () => {
    // ci.yaml の job 名だけを変えると、必須のチェックがいつまでも来なくなり、どの PR もマージできなくなる
    const contexts = requiredChecks().map(({ context }) => context);
    expect(contexts.length).toBeGreaterThan(0);
    expect(jobCheckNames(readRepoFile('.github/workflows/ci.yaml'))).toEqual(expect.arrayContaining(contexts));
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
