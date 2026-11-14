import { describe, expect, it } from 'vitest';

import { latestTag, plan, type Bump, type Change } from '../src/plan.ts';

const commit = (type: string, isBreaking = false): Change => ({ type, isBreaking });

describe('latestTag（基準のタグ）', () => {
  it('v* のタグのうち、版がいちばん大きいものを選ぶ', () => {
    expect(latestTag(['v1.2.1', 'v1.3.0', 'v1.0.0'])).toBe('v1.3.0');
  });

  it('版は文字列ではなく数で比べる', () => {
    expect(latestTag(['v1.9.0', 'v1.10.0', 'v1.2.0'])).toBe('v1.10.0');
    expect(latestTag(['v2.0.0', 'v10.0.0'])).toBe('v10.0.0');
  });

  it('vX.Y.Z の形でないタグは数えない', () => {
    expect(latestTag(['v1.3.0', 'v9.0.0-beta.1', 'v9', 'vnext', '9.0.0', 'zubatto-quiz-v9.0.0'])).toBe('v1.3.0');
  });

  it('数えるタグがなければ null', () => {
    expect(latestTag([])).toBeNull();
    expect(latestTag(['vnext'])).toBeNull();
  });
});

describe('plan（次の版）', () => {
  describe('auto', () => {
    it('破壊的変更があれば major に上げ、minor と patch を 0 に戻す', () => {
      expect(
        plan({ currentTag: 'v1.3.2', commits: [commit('fix'), commit('refactor', true)], bump: 'auto' }).next,
      ).toBe('2.0.0');
    });

    it('破壊的変更がなく feat があれば minor に上げ、patch を 0 に戻す', () => {
      expect(plan({ currentTag: 'v1.3.2', commits: [commit('fix'), commit('feat')], bump: 'auto' }).next).toBe('1.4.0');
    });

    it.each(['fix', 'perf'])('feat がなく %s があれば patch に上げる', (type) => {
      expect(plan({ currentTag: 'v1.3.2', commits: [commit('docs'), commit(type)], bump: 'auto' }).next).toBe('1.3.3');
    });

    it.each([[[]], [[commit('docs'), commit('refactor'), commit('revert')]]])(
      '上げる理由になる commit がなければ、patch に落とさず null（%j）',
      (commits) => {
        const result = plan({ currentTag: 'v1.3.0', commits, bump: 'auto' });
        expect(result.next).toBeNull();
        expect(result.reason).toContain('patch');
      },
    );

    it('理由には、決め手になった commit の種類を書く', () => {
      expect(plan({ currentTag: 'v1.3.0', commits: [commit('feat'), commit('feat')], bump: 'auto' }).reason).toContain(
        'feat',
      );
      expect(plan({ currentTag: 'v1.3.0', commits: [commit('feat', true)], bump: 'auto' }).reason).toContain('破壊的');
    });
  });

  describe.each<[Exclude<Bump, 'auto'>, string]>([
    ['major', '2.0.0'],
    ['minor', '1.4.0'],
    ['patch', '1.3.3'],
  ])('%s を選んだとき', (bump, expected) => {
    it('commit がなくても、その分だけ上げる', () => {
      expect(plan({ currentTag: 'v1.3.2', commits: [], bump })).toEqual({ next: expected, reason: expect.any(String) });
    });

    it('auto の判定より小さくても、選んだほうに従う', () => {
      expect(plan({ currentTag: 'v1.3.2', commits: [commit('feat', true)], bump }).next).toBe(expected);
    });
  });

  it.each<Bump>(['auto', 'major', 'minor', 'patch'])(
    'タグが一度もなければ（%s）、版を作らずに null を返し、タグを取り忘れていないかを理由に書く',
    (bump) => {
      // このリポジトリには v1.3.0 まであるので、タグがないのは取り忘れ（fetch-depth: 0 など）とみなす
      const result = plan({ currentTag: null, commits: [commit('feat')], bump });
      expect(result.next).toBeNull();
      expect(result.reason).toContain('タグ');
    },
  );

  it('vX.Y.Z の形でない基準のタグは受け付けない', () => {
    expect(() => plan({ currentTag: 'v1.3', commits: [], bump: 'patch' })).toThrow('vX.Y.Z');
  });
});
