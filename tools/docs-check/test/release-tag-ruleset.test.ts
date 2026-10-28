import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

type Ruleset = {
  target: string;
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: { type: string }[];
  bypass_actors: { actor_id: number | null; actor_type: string; bypass_mode?: string }[];
} & Record<string, unknown>;

const ruleset = JSON.parse(readRepoFile('docs/runbooks/release-tag-ruleset.json')) as Ruleset;

describe('v* のタグのルールセット（docs/runbooks/release-tag-ruleset.json・ADR 0010）', () => {
  it('対象は v* のタグだけ', () => {
    // production が許すのは v* のタグだけなので、守るのもそれだけでよい。ほかのタグまで含めると、版でない印も App しか打てなくなる
    expect(ruleset.target).toBe('tag');
    expect(ruleset.conditions.ref_name).toEqual({ include: ['refs/tags/v*'], exclude: [] });
  });

  it('タグを作る・動かす・消すのを、どれも禁止する', () => {
    // v* のタグは本番への入口になる。1つでも欠けると、好きなコミットに v* を打てる（または付け直せる）
    expect(ruleset.rules.map(({ type }) => type).sort()).toEqual(['creation', 'deletion', 'update']);
  });

  it('有効で、bypass は release-please の App だけ', () => {
    // actor_id は App の ID（Client ID ではない）。admin も例外にしないので、タグはリリース PR のマージでしかできない
    expect(ruleset.enforcement).toBe('active');
    expect(ruleset.bypass_actors).toEqual([
      { actor_id: expect.any(Number), actor_type: 'Integration', bypass_mode: 'always' },
    ]);
  });

  it('GitHub が付ける項目を含まず、そのまま POST に渡せる', () => {
    // branch-protection.md の jq で書き出す項目と同じ。id や _links が入っていると作れない
    expect(Object.keys(ruleset).sort()).toEqual([
      'bypass_actors',
      'conditions',
      'enforcement',
      'name',
      'rules',
      'target',
    ]);
  });
});
