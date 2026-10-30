import { readdirSync, readFileSync } from 'node:fs';

export const repoRoot = new URL('../../../', import.meta.url);

const markdownIn = (dir: string) =>
  readdirSync(new URL(dir, repoRoot))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${dir}${name}`);

/** 手順書や設計資料をたどるときに読む文書。リンクやコマンドが古いと、環境を作り直す途中や設計を読み返すときに迷う（ADR 0005） */
export const documents = [
  'README.md',
  'CONTRIBUTING.md',
  // 文書の入口。ほとんどの文書へリンクし、見出しのアンカーも多い
  'docs/README.md',
  // いちばん読まれる設計資料。ADR は互いにリンクし、要件の ID から読み返される
  ...markdownIn('docs/adr/'),
  'docs/requirements/zubatto-quiz.md',
  // モックの作り方。mock:build などのスクリプト名を書いている
  'docs/design/README.md',
  // O2 のリハーサルの手順（README の手順書の表から開く）
  'tools/loadtest/README.md',
  // O2 のリハーサルの記録。本番の前に読み返し、手順書へのリンクから止め方や使用量の見方に戻る
  'docs/rehearsal/o2-rehearsal.md',
  ...markdownIn('docs/runbooks/'),
];

export const read = (url: URL) => readFileSync(url, 'utf8');
