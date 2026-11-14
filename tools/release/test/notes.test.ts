import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadChangelogConfig, type RawGitCommit } from 'changelogen';
import { describe, expect, it } from 'vitest';

import { renderNotes, selectCommits } from '../src/notes.ts';
import { plan } from '../src/plan.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// from と to を渡すので、git describe も git rev-parse も動かない。repo は changelog.config.ts にある
const config = await loadChangelogConfig(repoRoot, { from: 'v1.3.0', to: 'HEAD', newVersion: '1.4.0' });

/** CI（pr-title.yaml）と同じ commitlint の CLI で、リポジトリの設定が許す type を読む */
const commitTypes = () => {
  const printed = execFileSync(`${repoRoot}node_modules/.bin/commitlint`, ['--print-config', 'json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const { rules } = JSON.parse(printed) as { rules: Record<string, unknown[]> };
  return rules['type-enum']?.[2] as string[];
};

const raw = (message: string, shortHash = 'abc1234'): RawGitCommit => ({
  message,
  body: '',
  shortHash,
  author: { name: 'KAKI', email: '106128913+XeicuLy@users.noreply.github.com' },
});

describe('changelog.config.ts（ADR 0012）', () => {
  it('commitlint が許すどの type も、既定の表と合わせた types に、出すか false かの決まりがある', () => {
    // 表にない type は黙って捨てられる。commitlint に type を足したら、changelog.config.ts にも足す
    expect(Object.keys(config.types)).toEqual(expect.arrayContaining(commitTypes()));
  });

  it('出すのは feat・perf・fix・refactor・docs・revert で、見出しは changelogen の既定（revert だけ足す）', () => {
    // 見出しの並びは既定の表の順で、足した revert が最後に来る。changelogen を上げて既定が変わったら、ここで気づく
    const visible = Object.entries(config.types).flatMap(([type, value]) =>
      typeof value === 'object' ? [[type, value.title]] : [],
    );
    expect(visible).toEqual([
      ['feat', '🚀 Enhancements'],
      ['perf', '🔥 Performance'],
      ['fix', '🩹 Fixes'],
      ['refactor', '💅 Refactors'],
      ['docs', '📖 Documentation'],
      ['revert', '⏪ Reverts'],
    ]);
  });

  it('出す type は、どれも commitlint が許す type（既定の表の types・examples は外す）', () => {
    const visible = Object.entries(config.types).flatMap(([type, value]) => (value ? [type] : []));
    expect(commitTypes()).toEqual(expect.arrayContaining(visible));
  });

  it('Contributors の節を出さない', () => {
    expect(config.noAuthors).toBe(true);
  });
});

describe('selectCommits（文面と版の判定に使う commit）', () => {
  it('false にした type、表にない type、Conventional Commits の形でない commit を捨てる', () => {
    const commits = selectCommits(
      [
        raw('feat: 新しい画面を足す (#1)'),
        raw('chore: bump the minor-and-patch group (#2)'),
        raw('ci: workflow を直す (#3)'),
        raw('test: テストを足す (#4)'),
        raw('build: ビルドを直す (#5)'),
        raw('style: 書式を直す (#6)'),
        raw('docs: 手順を足す (#7)'),
        raw('Merge branch main'),
        // Object の組み込みの名前は、表にあるように見えても捨てる
        raw('constructor: 組み込みの名前 (#14)'),
      ],
      config,
    );
    expect(commits.map(({ type }) => type)).toEqual(['feat', 'docs']);
  });

  it('出さない type の破壊的変更は、版の判定にも数えない', () => {
    const commits = selectCommits([raw('chore!: Node の対応版を上げる (#8)')], config);
    expect(commits).toEqual([]);
    expect(plan({ currentTag: 'v1.3.0', commits, bump: 'auto' }).next).toBeNull();
  });

  it('GitHub の Revert ボタンの commit は、feat ではなく revert として読む', () => {
    // commitlint は既定で Revert "…" を確かめずに通す。changelogen の正規表現は先頭に固定されていないので、
    // そのままだと中の feat を拾い、minor に上げて `x"` という行を出す
    const commits = selectCommits([raw('Revert "feat: 新しい画面を足す (#1)" (#9)')], config);
    expect(commits).toMatchObject([
      {
        type: 'revert',
        isBreaking: false,
        references: expect.arrayContaining([{ type: 'pull-request', value: '#9' }]),
      },
    ]);
    expect(plan({ currentTag: 'v1.3.0', commits, bump: 'auto' }).next).toBeNull();
  });

  it('作者を消す（generateMarkDown は noAuthors でも、作者ごとに ungh.cc へ問い合わせるため）', () => {
    const body = 'Co-Authored-By: Claude <noreply@anthropic.com>';
    const commits = selectCommits([{ ...raw('fix: 直す (#10)'), body }], config);
    expect(commits).toMatchObject([{ author: { name: '', email: '' }, authors: [] }]);
  });
});

describe('renderNotes（リリースノートの文面）', () => {
  it('版の見出し・比べるリンク・type ごとの節を、PR へのリンク付きで出す', async () => {
    const commits = selectCommits(
      [
        raw('fix: 部屋の上限を直す (#12)', 'ccc3333'),
        raw('feat: 使い方のページを足す (#11)', 'bbb2222'),
        raw('chore: 依存を上げる (#13)', 'ddd4444'),
        raw('feat!: 古い API をやめる (#10)', 'aaa1111'),
      ],
      config,
    );
    expect(await renderNotes(commits, config)).toBe(
      [
        '## v1.4.0',
        '',
        '[compare changes](https://github.com/XeicuLy/zubatto-quiz/compare/v1.3.0...v1.4.0)',
        '',
        '### 🚀 Enhancements',
        '',
        '- ⚠️  古い API をやめる ([#10](https://github.com/XeicuLy/zubatto-quiz/pull/10))',
        '- 使い方のページを足す ([#11](https://github.com/XeicuLy/zubatto-quiz/pull/11))',
        '',
        '### 🩹 Fixes',
        '',
        '- 部屋の上限を直す ([#12](https://github.com/XeicuLy/zubatto-quiz/pull/12))',
        '',
        '#### ⚠️ Breaking Changes',
        '',
        '- ⚠️  古い API をやめる ([#10](https://github.com/XeicuLy/zubatto-quiz/pull/10))',
      ].join('\n'),
    );
  });
});
