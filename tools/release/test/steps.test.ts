import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { changelogPr } from '../src/guard.ts';
import { parseStepArgs } from '../src/steps.ts';

const STEPS = fileURLToPath(new URL('../src/steps.ts', import.meta.url));

/**
 * 次の履歴の git リポジトリを、一時ディレクトリに作る。
 *
 *   root ─ first（v1.0.0）─ second（v1.1.0）─ third
 *     └─ side（main の外に分かれたコミット）
 */
let repo = '';
const commits: Record<'first' | 'second' | 'third' | 'side', string> = { first: '', second: '', third: '', side: '' };

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const commit = (message: string) => {
  git('commit', '--allow-empty', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'release-steps-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  commit('chore: root');
  git('switch', '-q', '-c', 'side');
  commits.side = commit('feat: side');
  git('switch', '-q', 'main');
  commits.first = commit('feat: first');
  git('tag', 'v1.0.0');
  commits.second = commit('feat: second');
  // release-please のタグは軽量のタグだが、注釈付きのタグもコミットまでたどる
  git('tag', '-a', 'v1.1.0', '-m', 'v1.1.0');
  commits.third = commit('fix: third');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

const steps = (args: string[], input?: string) => {
  const { status, stdout, stderr } = spawnSync('node', [STEPS, ...args], { cwd: repo, encoding: 'utf8', input });
  return { status, stdout, stderr };
};

describe('parseStepArgs', () => {
  it.each([
    ['--base-tag', 'v1.3.0; rm -rf /'],
    ['--base-tag', '1.3.0'],
    ['--sha', 'HEAD'],
    ['--sha', 'A'.repeat(40)],
    ['--version', 'v1.4.0'],
  ])('%s に形の違う値（%j）は受け付けない', (flag, value) => {
    expect(() => parseStepArgs(['check-plan', flag, value])).toThrow(flag.slice(2));
  });

  it('知らないサブコマンドは受け付けない', () => {
    expect(() => parseStepArgs(['deploy'])).toThrow('deploy');
  });

  it('--open-branch は何度でも書ける', () => {
    expect(parseStepArgs(['check-deploy', '--base-tag', 'v1.0.0', '--open-branch', 'a', '--open-branch', 'b'])).toEqual(
      expect.objectContaining({ command: 'check-deploy', openBranches: ['a', 'b'] }),
    );
  });

  it('サブコマンドに要る引数がなければ受け付けない', () => {
    expect(() => parseStepArgs(['check-release', '--base-tag', 'v1.0.0'])).toThrow('--version');
  });
});

describe('check-plan（verify-ci）', () => {
  it('基準のタグが祖先で、まだ版になっていなければ 0 で終わる', () => {
    expect(steps(['check-plan', '--base-tag', 'v1.1.0', '--sha', commits.third]).status).toBe(0);
  });

  it('基準のタグがすでに出すコミットを指していれば、1 で終わり、::error:: で理由を出す', () => {
    const { status, stdout } = steps(['check-plan', '--base-tag', 'v1.1.0', '--sha', commits.second]);
    expect(status).toBe(1);
    expect(stdout).toContain('::error::v1.1.0 はすでにこのコミットを指している');
  });

  it('基準のタグが祖先でなければ 1 で終わる', () => {
    const { status, stdout } = steps(['check-plan', '--base-tag', 'v1.1.0', '--sha', commits.side]);
    expect(status).toBe(1);
    expect(stdout).toContain('祖先でない');
  });

  it('前の CHANGELOG の PR が開いていれば 1 で終わる', () => {
    const { branch } = changelogPr('1.1.0');
    const args = ['check-plan', '--base-tag', 'v1.1.0', '--sha', commits.third, '--open-branch', branch];
    expect(steps(args).status).toBe(1);
  });
});

describe('check-deploy（deploy の最初）', () => {
  it('最新の v* タグが基準のタグのままなら 0 で終わる', () => {
    expect(steps(['check-deploy', '--base-tag', 'v1.1.0']).status).toBe(0);
  });

  it('あとから別の版が出ていれば 1 で終わる', () => {
    const { status, stdout } = steps(['check-deploy', '--base-tag', 'v1.0.0']);
    expect(status).toBe(1);
    expect(stdout).toContain('::error::最新の v* タグ（v1.1.0）');
  });
});

describe('check-release（release の最初）', () => {
  const checkRelease = (version: string, sha: string, baseTag = 'v1.1.0') =>
    steps(['check-release', '--base-tag', baseTag, '--version', version, '--sha', sha]);

  it('タグがまだなく、最新の v* タグが基準のタグなら、continue を出して 0 で終わる', () => {
    expect(checkRelease('1.2.0', commits.third)).toMatchObject({ status: 0, stdout: 'continue\n' });
  });

  it('タグがすでに出したコミットにあれば、skip を出して 0 で終わる（注釈付きのタグも、コミットまでたどる）', () => {
    expect(checkRelease('1.1.0', commits.second, 'v1.0.0')).toMatchObject({ status: 0, stdout: 'skip\n' });
  });

  it('タグがすでに別のコミットにあれば、1 で終わる', () => {
    const { status, stdout } = checkRelease('1.1.0', commits.third, 'v1.0.0');
    expect(status).toBe(1);
    expect(stdout).toContain(`::error::v1.1.0 はすでに別のコミット（${commits.second}）にある`);
  });

  it('タグはないが、最新の v* タグが基準のタグと違えば、1 で終わる', () => {
    expect(checkRelease('1.1.1', commits.third, 'v1.0.0').status).toBe(1);
  });
});

describe('ファイルと PR の文字列', () => {
  const notesFile = () => {
    const path = join(repo, '..', `notes-${Date.now()}.md`);
    writeFileSync(path, '## v1.2.0\n\n### 🚀 Enhancements\n\n- 足す\n');
    return path;
  };

  it('changelog は、標準入力の CHANGELOG.md に文面を足して、標準出力に出す', () => {
    const { status, stdout } = steps(['changelog', '--notes-file', notesFile()], '# Changelog\n\n## [1.1.0](x)\n');
    expect(status).toBe(0);
    expect(stdout).toBe('# Changelog\n\n## v1.2.0\n\n### 🚀 Enhancements\n\n- 足す\n\n## [1.1.0](x)\n');
  });

  it('package-version は、標準入力の package.json の version を書き換える', () => {
    const { stdout } = steps(['package-version', '--version', '1.2.0'], '{\n  "name": "x",\n  "version": "1.1.0"\n}\n');
    expect(stdout).toBe('{\n  "name": "x",\n  "version": "1.2.0"\n}\n');
  });

  it('release-body は、版の見出しを外した文面を出す', () => {
    expect(steps(['release-body', '--notes-file', notesFile()]).stdout).toBe('### 🚀 Enhancements\n\n- 足す\n');
  });

  it('pr は、ブランチ・題名・本文を JSON で出す', () => {
    expect(JSON.parse(steps(['pr', '--version', '1.2.0']).stdout)).toEqual(changelogPr('1.2.0'));
  });

  it('引数の誤りは 2 で終わる', () => {
    expect(steps(['pr', '--version', 'latest']).status).toBe(2);
  });
});
