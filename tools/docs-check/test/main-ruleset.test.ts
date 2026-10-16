import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Rule = { type: string; parameters?: Record<string, unknown> };
type Ruleset = { enforcement: string; bypass_actors: unknown[]; rules: Rule[] } & Record<string, unknown>;

const ruleset = JSON.parse(readRepoFile('docs/runbooks/main-ruleset.json')) as Ruleset;

/** ci.yaml の jobs: の直下にある job の名前。必須のチェックの名前は、この job 名になる */
function ciJobNames(): string[] {
  const [, jobs = ''] = readRepoFile('.github/workflows/ci.yaml').split(/^jobs:$/m);
  return [...jobs.matchAll(/^ {2}([\w-]+):$/gm)].map(([, name]) => name ?? '');
}

const requiredChecks = () => {
  const rule = ruleset.rules.find(({ type }) => type === 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []) as { context: string; integration_id?: number }[];
};

describe('main のルールセット（docs/runbooks/main-ruleset.json・M1）', () => {
  it('必須のチェックの名前が、ci.yaml の job の名前と一致する', () => {
    // ci.yaml の job 名だけを変えると、必須のチェックがいつまでも来なくなり、どの PR もマージできなくなる
    expect(requiredChecks().map(({ context }) => context)).toEqual(['ci']);
    expect(ciJobNames()).toContain('ci');
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
