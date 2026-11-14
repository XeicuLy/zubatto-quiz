/**
 * deploy.yaml の job が .github/scripts/release.sh から呼ぶ小さな手順（ADR 0012）。
 *
 *   node tools/release/src/steps.ts check-plan    --base-tag v1.3.0 --sha "$GITHUB_SHA" [--open-branch <ブランチ>]...
 *   node tools/release/src/steps.ts check-deploy  --base-tag v1.3.0 [--open-branch <ブランチ>]...
 *   node tools/release/src/steps.ts check-release --base-tag v1.3.0 --version 1.4.0 --sha "$GITHUB_SHA"   → continue か skip
 *   node tools/release/src/steps.ts changelog     --notes-file notes.md < CHANGELOG.md
 *   node tools/release/src/steps.ts package-version --version 1.4.0 < package.json
 *   node tools/release/src/steps.ts release-body  --notes-file notes.md
 *   node tools/release/src/steps.ts pr            --version 1.4.0                                            → {branch,title,body}
 *
 * - git の事実（v* のタグ・タグが指すコミット・祖先か）は、今のディレクトリのリポジトリから読む。
 *   GitHub の事実（開いている PR のブランチ）は、呼ぶ側のシェルが gh で読んで --open-branch で渡す
 * - changelogen を読み込まない。依存パッケージを入れない release job でも、node だけで動く
 * - 止めるときは、理由を ::error:: で標準出力に出して 1 で終える。引数の誤りは 2
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { prependNotes, releaseBody, setPackageVersion } from './files.ts';
import { changelogPr, checkDeploy, checkPlan, checkRelease } from './guard.ts';
import { latestTag } from './plan.ts';

const commands = [
  'check-plan',
  'check-deploy',
  'check-release',
  'changelog',
  'package-version',
  'release-body',
  'pr',
] as const;
type Command = (typeof commands)[number];

type Option = 'base-tag' | 'sha' | 'version' | 'notes-file';

/** サブコマンドごとに要る引数 */
const required: Record<Command, readonly Option[]> = {
  'check-plan': ['base-tag', 'sha'],
  'check-deploy': ['base-tag'],
  'check-release': ['base-tag', 'version', 'sha'],
  changelog: ['notes-file'],
  'package-version': ['version'],
  'release-body': ['notes-file'],
  pr: ['version'],
};

/** 引数の形。git に渡す値は、ref の書き方（`^{commit}`・`..` など）やオプション（`-`）に読まれない形だけを通す */
const formats: Partial<Record<Option, RegExp>> = {
  'base-tag': /^v\d+\.\d+\.\d+$/,
  sha: /^[0-9a-f]{40}$/,
  version: /^\d+\.\d+\.\d+$/,
};

export type StepArgs = {
  command: Command;
  baseTag: string;
  sha: string;
  version: string;
  notesFile: string;
  openBranches: string[];
};

const isCommand = (value: string | undefined): value is Command =>
  (commands as readonly (string | undefined)[]).includes(value);

export function parseStepArgs(args: readonly string[]): StepArgs {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      'base-tag': { type: 'string' },
      sha: { type: 'string' },
      version: { type: 'string' },
      'notes-file': { type: 'string' },
      'open-branch': { type: 'string', multiple: true, default: [] },
    },
    strict: true,
    allowPositionals: true,
  });
  const [command, ...rest] = positionals;
  if (!isCommand(command) || rest.length > 0) {
    throw new Error(`サブコマンドは ${commands.join(' / ')} のどれか1つ: ${positionals.join(' ')}`);
  }
  for (const [option, format] of Object.entries(formats) as [Option, RegExp][]) {
    const value = values[option];
    if (value !== undefined && !format.test(value)) {
      throw new Error(`--${option} の形が違う: ${JSON.stringify(value)}`);
    }
  }
  for (const option of required[command]) {
    if (values[option] === undefined) {
      throw new Error(`${command} には --${option} が要る`);
    }
  }
  return {
    command,
    baseTag: values['base-tag'] ?? '',
    sha: values.sha ?? '',
    version: values.version ?? '',
    notesFile: values['notes-file'] ?? '',
    openBranches: values['open-branch'],
  };
}

/** git を動かし、終了コードと標準出力を返す。0 と 1 のほか（リポジトリがない、ref が壊れているなど）は例外にする */
const git = (...args: string[]): { found: boolean; stdout: string } => {
  const { status, stdout, stderr } = spawnSync('git', args, { encoding: 'utf8' });
  if (status !== 0 && status !== 1) {
    throw new Error(`git ${args.join(' ')} が失敗した（${status}）: ${stderr}`);
  }
  return { found: status === 0, stdout: stdout.trim() };
};

/** タグが指すコミット。注釈付きのタグも、タグのオブジェクトではなくコミットまでたどる。なければ null */
const commitOfTag = (tag: string): string | null => {
  const { found, stdout } = git('rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`);
  return found ? stdout : null;
};

const latestTagInRepo = () => latestTag(git('tag', '--list', 'v*').stdout.split('\n'));

/** 止める理由を GitHub Actions の注釈にして出し、1 で終える */
const stop = (problems: readonly string[]): never => {
  for (const problem of problems) {
    console.log(`::error::${problem}`);
  }
  process.exit(1);
};

function run(args: StepArgs): string | undefined {
  switch (args.command) {
    case 'check-plan': {
      const baseCommit = commitOfTag(args.baseTag);
      if (baseCommit === null) {
        return stop([`基準のタグ ${args.baseTag} がない。タグと履歴を取ったか（fetch-depth: 0）を確かめる`]);
      }
      const baseIsAncestor = git('merge-base', '--is-ancestor', baseCommit, args.sha).found;
      const problems = checkPlan({ ...args, baseCommit, baseIsAncestor });
      return problems.length > 0 ? stop(problems) : undefined;
    }
    case 'check-deploy': {
      const problems = checkDeploy({ ...args, latestTag: latestTagInRepo() });
      return problems.length > 0 ? stop(problems) : undefined;
    }
    case 'check-release': {
      const tag = `v${args.version}`;
      const decision = checkRelease({ ...args, tag, tagCommit: commitOfTag(tag), latestTag: latestTagInRepo() });
      if (decision.action === 'stop') {
        return stop([decision.reason]);
      }
      if (decision.action === 'skip') {
        console.error(decision.reason);
      }
      return `${decision.action}\n`;
    }
    case 'changelog':
      return prependNotes(readFileSync(0, 'utf8'), readFileSync(args.notesFile, 'utf8'));
    case 'package-version':
      return setPackageVersion(readFileSync(0, 'utf8'), args.version);
    case 'release-body':
      return releaseBody(readFileSync(args.notesFile, 'utf8'));
    case 'pr':
      return `${JSON.stringify(changelogPr(args.version))}\n`;
  }
}

const parseOrExit = (args: readonly string[]): StepArgs => {
  try {
    return parseStepArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
};

if (import.meta.main) {
  const output = run(parseOrExit(process.argv.slice(2)));
  if (output !== undefined) {
    process.stdout.write(output);
  }
}
