import { readdirSync, readFileSync } from 'node:fs';

export const repoRoot = new URL('../../../', import.meta.url);

/** 手順書をたどるときに読む文書。リンクやコマンドが古いと、環境を作り直す途中で迷う（ADR 0005） */
export const documents = [
  'README.md',
  'CONTRIBUTING.md',
  // O2 のリハーサルの手順（README の手順書の表から開く）
  'tools/loadtest/README.md',
  ...readdirSync(new URL('docs/runbooks/', repoRoot))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/runbooks/${name}`),
];

export const read = (url: URL) => readFileSync(url, 'utf8');
