import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const repoPath = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

type Expected = 'blocked' | 'allowed';
/** from は置き場所（apps/web/src からのフォルダー）、to は import する先。テストのファイル（*.test.ts）にするものは test を true にする */
type Case = { from: string; to: string; expected: Expected; test?: boolean };

// 層の向き: routes → features → shared → api・realtime、components/ui は lib だけを読む（docs/architecture/frontend.md）
const cases: Case[] = [
  // feature 同士は読まない。features から routes も読まない
  { from: 'features/admin', to: '@/features/host/host-room', expected: 'blocked' },
  { from: 'features/host', to: '@/features/player', expected: 'blocked' },
  { from: 'features/player', to: '@/routes/__root', expected: 'blocked' },
  { from: 'features/host', to: '@/shared/results/RankingList', expected: 'allowed' },
  { from: 'features/host', to: '@/api/rooms', expected: 'allowed' },
  { from: 'features/host', to: '@/realtime/client', expected: 'allowed' },
  { from: 'features/host', to: '@/components/ui/button', expected: 'allowed' },
  // shared は features と routes を読まない
  { from: 'shared/sound', to: '@/features/host/host-room', expected: 'blocked' },
  { from: 'shared/auth', to: '@/routes/__root', expected: 'blocked' },
  { from: 'shared/sound', to: '@/components/ui/button', expected: 'allowed' },
  { from: 'shared/connection', to: '@/realtime/client', expected: 'allowed' },
  { from: 'shared/auth', to: '@/api/auth-client', expected: 'allowed' },
  // api と realtime はデータの入口。画面の層を読まない
  { from: 'api', to: '@/features/admin', expected: 'blocked' },
  { from: 'api', to: '@/shared/auth/require-host', expected: 'blocked' },
  { from: 'realtime', to: '@/components/ui/button', expected: 'blocked' },
  { from: 'realtime', to: '@/routes/__root', expected: 'blocked' },
  { from: 'api', to: '@zubatto-quiz/protocol', expected: 'allowed' },
  // components/ui は lib（cn）と自分のほかを読まない
  { from: 'components/ui', to: '@/lib/tailwind', expected: 'allowed' },
  { from: 'components/ui', to: '@/components/ui/button', expected: 'allowed' },
  { from: 'components/ui', to: '@base-ui/react/button', expected: 'allowed' },
  { from: 'components/ui', to: '@/components/a11y/announce', expected: 'blocked' },
  { from: 'components/ui', to: '@/shared/sound/sound-player', expected: 'blocked' },
  { from: 'components/ui', to: '@/features/host', expected: 'blocked' },
  { from: 'components/ui', to: '@/api/rooms', expected: 'blocked' },
  // 層の上書きは全体の no-restricted-imports を置き換えるので、全体の禁止を書き写してあること
  ...['features/admin', 'shared/sound', 'api', 'realtime', 'components/ui'].flatMap((from): Case[] => [
    { from, to: './helper.test', expected: 'blocked' },
    { from, to: 'cloudflare:test', expected: 'blocked' },
    { from, to: 'better-auth/test', expected: 'blocked' },
  ]),
  ...['features/admin', 'shared/sound', 'api', 'realtime'].map((from): Case => ({
    from,
    to: '@base-ui/react/button',
    expected: 'blocked',
  })),
  // テストのコードは柵の外。テストの上書きが、層の上書きより後ろにあること
  { from: 'features/admin', to: '@/features/host/host-room', expected: 'allowed', test: true },
  { from: 'features/host', to: '../../../test/fake-sound', expected: 'allowed', test: true },
  { from: 'components/ui', to: '../../../test/live-region', expected: 'allowed', test: true },
  { from: 'components/ui', to: '@/shared/sound/sound-player', expected: 'allowed', test: true },
];

const workDir = mkdtempSync(join(tmpdir(), 'oxlint-layers-'));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeWorkFile(path: string, source: string) {
  mkdirSync(dirname(join(workDir, path)), { recursive: true });
  writeFileSync(join(workDir, path), source);
}

/** ケースごとに、import を1行だけ書いたファイルを作る。override の files は設定のある場所から読むので、同じ形に並べる */
const caseFiles = cases.map(({ test, ...rest }, index) => ({
  ...rest,
  path: `apps/web/src/${rest.from}/case-${index}${test ? '.test' : ''}.ts`,
}));
writeWorkFile('.oxlintrc.json', readFileSync(repoPath('.oxlintrc.json'), 'utf8'));
for (const { path, to } of caseFiles) {
  writeWorkFile(path, `import '${to}';\n`);
}
// ./ どうしで読み合う輪
writeWorkFile('apps/web/src/lib/cycle-a.ts', "import { b } from './cycle-b';\nexport const a = () => b;\n");
writeWorkFile('apps/web/src/lib/cycle-b.ts', "import { a } from './cycle-a';\nexport const b = () => a;\n");

type Diagnostic = { code: string; filename: string };

const lint = spawnSync(repoPath('node_modules/.bin/oxlint'), ['-c', '.oxlintrc.json', '--format', 'json', '.'], {
  cwd: workDir,
  encoding: 'utf8',
});
/** 設定が読めないと、oxlint は JSON でなく理由を出す。そのまま見せる */
function parseReport(): { diagnostics: Diagnostic[] } {
  try {
    return JSON.parse(lint.stdout) as { diagnostics: Diagnostic[] };
  } catch {
    throw new Error(`oxlint の結果が JSON でない:\n${lint.stdout}${lint.stderr}`);
  }
}
const { diagnostics } = parseReport();

/** そのファイルが受けた診断のコード（eslint(no-restricted-imports) など） */
const codesOf = (path: string) => diagnostics.filter((d) => d.filename === path).map((d) => d.code);

describe('.oxlintrc.json の層の柵（apps/web/src）', () => {
  it.for(caseFiles)('$path から $to を import すると $expected', ({ path, expected }) => {
    const restricted = codesOf(path).includes('eslint(no-restricted-imports)');
    expect(restricted ? 'blocked' : 'allowed').toBe(expected);
  });
});

describe('.oxlintrc.json の import/no-cycle', () => {
  it('読み合う2つのファイルを、どちらも落とす', () => {
    expect(codesOf('apps/web/src/lib/cycle-a.ts')).toContain('import(no-cycle)');
    expect(codesOf('apps/web/src/lib/cycle-b.ts')).toContain('import(no-cycle)');
  });
});
