import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { changelogPr, checkDeploy, checkPlan, checkRelease } from '../src/guard.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

describe('checkPlan（verify-ci・承認の前に止める）', () => {
  const ok = { baseTag: 'v1.3.0', sha: SHA, baseCommit: OTHER, baseIsAncestor: true, openBranches: [] };

  it('基準のタグが出すコミットの祖先で、まだ版になっておらず、前の CHANGELOG の PR もなければ、止めない', () => {
    expect(checkPlan(ok)).toEqual([]);
  });

  it('基準のタグが出すコミットの祖先でなければ止める（これまでの版を含まないコミットを出さない）', () => {
    expect(checkPlan({ ...ok, baseIsAncestor: false })).toEqual([expect.stringContaining('祖先でない')]);
  });

  it('基準のタグがすでに出すコミットを指していれば止める（同じコミットに2つ目の版を作らない）', () => {
    expect(checkPlan({ ...ok, baseCommit: SHA })).toEqual([expect.stringContaining('タグの上で動かす')]);
  });

  it('前の CHANGELOG の PR が開いていれば止める（次の PR がその節を持たない main から切られる）', () => {
    expect(checkPlan({ ...ok, openBranches: ['feature/issues/1', 'changelog/v1.3.0'] })).toEqual([
      expect.stringContaining('changelog/v1.3.0'),
    ]);
  });

  it('changelog/ で始まらないブランチの PR は数えない', () => {
    expect(checkPlan({ ...ok, openBranches: ['feature/changelog/v1.3.0', 'changelog-fix'] })).toEqual([]);
  });

  it('止める理由が複数あれば、どれも返す', () => {
    expect(checkPlan({ ...ok, baseIsAncestor: false, openBranches: ['changelog/v1.3.0'] })).toHaveLength(2);
  });
});

describe('checkDeploy（deploy の最初・Re-run failed jobs で verify-ci を通らなかったときの確かめ直し）', () => {
  const ok = { baseTag: 'v1.3.0', latestTag: 'v1.3.0', openBranches: [] };

  it('最新の v* タグがまだ基準のタグで、前の CHANGELOG の PR もなければ、止めない', () => {
    expect(checkDeploy(ok)).toEqual([]);
  });

  it('verify-ci のあとに別の版が出ていれば止める（古い run の Re-run で、あとの版を古いコミットで上書きしない）', () => {
    expect(checkDeploy({ ...ok, latestTag: 'v1.4.0' })).toEqual([expect.stringContaining('v1.4.0')]);
  });

  it('同じコミットが先に別の番号で出されたあとの Re-run も、最新のタグが変わったので止める', () => {
    // 祖先かだけを確かめ直すのでは、v1.4.0 を出したコミットに、古い run が v1.3.1 を作ってしまう（ADR 0012）
    expect(checkDeploy({ baseTag: 'v1.3.0', latestTag: 'v1.4.0', openBranches: [] })).not.toEqual([]);
  });

  it('前の CHANGELOG の PR が開いていれば止める（release が PR を作ったあとで失敗した run が残っている）', () => {
    expect(checkDeploy({ ...ok, openBranches: ['changelog/v1.3.0'] })).toEqual([
      expect.stringContaining('changelog/v1.3.0'),
    ]);
  });

  it('v* のタグが1つもなければ止める', () => {
    expect(checkDeploy({ ...ok, latestTag: null })).not.toEqual([]);
  });
});

describe('checkRelease（release の最初・タグと Release を作る前）', () => {
  const ok = { baseTag: 'v1.3.0', latestTag: 'v1.3.0', tag: 'v1.4.0', tagCommit: null, sha: SHA };

  it('タグがまだなく、最新の v* タグが基準のタグのままなら、続ける', () => {
    expect(checkRelease(ok)).toEqual({ action: 'continue' });
  });

  it('タグがすでに出したコミットにあれば、前の Re-run で終わっているので、残りを飛ばす', () => {
    // 最新のタグはそのタグになっているが、基準のタグと違っても止めない
    expect(checkRelease({ ...ok, latestTag: 'v1.4.0', tagCommit: SHA })).toEqual({
      action: 'skip',
      reason: expect.stringContaining('v1.4.0'),
    });
  });

  it('タグがすでに別のコミットにあれば、飛ばさずに止める', () => {
    expect(checkRelease({ ...ok, latestTag: 'v1.4.0', tagCommit: OTHER })).toEqual({
      action: 'stop',
      reason: expect.stringContaining(OTHER),
    });
  });

  it('タグはないが、最新の v* タグが基準のタグと違えば、PR を作る前に止める（release だけの Re-run も含む）', () => {
    expect(checkRelease({ ...ok, latestTag: 'v1.5.0' })).toEqual({
      action: 'stop',
      reason: expect.stringContaining('v1.5.0'),
    });
  });

  it('PR を作ったあとで失敗した run の Re-run は、タグがまだないので続け、PR と Release の手順が「あれば飛ばす」で進む', () => {
    // PR は開いていても、ここでは止めない。止めるのは次の dispatch の verify-ci と deploy
    expect(checkRelease(ok)).toEqual({ action: 'continue' });
  });
});

describe('changelogPr（CHANGELOG の PR）', () => {
  it('ブランチは changelog/vX.Y.Z、題名は scope のない chore', () => {
    expect(changelogPr('1.4.0')).toEqual({
      branch: 'changelog/v1.4.0',
      title: 'chore: v1.4.0 の CHANGELOG を更新する',
      body: expect.stringContaining('v1.4.0'),
    });
  });

  it('題名は、PR の題名の確認（pr-title）と同じ commitlint の設定を通る', () => {
    // squash マージでは PR の題名が main のコミット名になり、pr-title がそれを確かめる
    const { title } = changelogPr('1.4.0');
    expect(() =>
      execFileSync(`${repoRoot}node_modules/.bin/commitlint`, [], { cwd: repoRoot, input: `${title}\n` }),
    ).not.toThrow();
  });

  it('checkPlan と checkDeploy は、changelogPr のブランチを前の CHANGELOG の PR として数える', () => {
    const { branch } = changelogPr('1.4.0');
    expect(
      checkPlan({ baseTag: 'v1.4.0', sha: SHA, baseCommit: OTHER, baseIsAncestor: true, openBranches: [branch] }),
    ).not.toEqual([]);
    expect(checkDeploy({ baseTag: 'v1.4.0', latestTag: 'v1.4.0', openBranches: [branch] })).not.toEqual([]);
  });
});
