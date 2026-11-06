import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Update = {
  'package-ecosystem': string;
  directory?: string;
  schedule?: { interval?: string };
  'commit-message'?: { prefix?: string; include?: string };
  cooldown?: { 'default-days'?: number };
  groups?: Record<string, { patterns?: string[]; 'update-types'?: string[] }>;
};
type DependabotConfig = { version: number; updates: Update[] };

const config = parse(
  readFileSync(new URL('../../../.github/dependabot.yml', import.meta.url), 'utf8'),
) as DependabotConfig;

describe('Dependabot の github-actions の更新', () => {
  const actions = config.updates.find((update) => update['package-ecosystem'] === 'github-actions');

  it('.github/workflows を、週に1回見に行く', () => {
    expect(config.version).toBe(2);
    // github-actions の directory は / と決まっている。/ で .github/workflows を読む
    expect(actions?.directory).toBe('/');
    expect(actions?.schedule?.interval).toBe('weekly');
  });

  it('題名は scope のない ci: で始まる（pr-title の commitlint を通し、CHANGELOG に載せない）', () => {
    expect(actions?.['commit-message']?.prefix).toBe('ci');
    // include: scope を書くと ci(deps): になる。このリポジトリのコミットは scope を付けない
    expect(actions?.['commit-message']?.include).toBeUndefined();
  });

  it('minor と patch を1つの PR にまとめ、major は action ごとの PR に分ける', () => {
    const groups = Object.values(actions?.groups ?? {});
    expect(groups).toEqual([{ patterns: ['*'], 'update-types': ['minor', 'patch'] }]);
  });

  it('公開から3日以上たった版だけを PR にする', () => {
    // 乗っ取られて公開された新しいタグは --verify を通るので、見つかるまでの時間を待つ。github-actions で使えるのは default-days だけ
    expect(actions?.cooldown?.['default-days']).toBeGreaterThanOrEqual(3);
  });
});
