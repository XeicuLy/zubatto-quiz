import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/cli.ts';

describe('parseCliArgs', () => {
  it('既定は auto で、HEAD までを読む', () => {
    expect(parseCliArgs([])).toEqual({ bump: 'auto', to: 'HEAD' });
  });

  it('bump と to を受け取る', () => {
    const sha = '1275262b0a5e5c3f7d1e9a8b6c4d2e0f1a3b5c7d';
    expect(parseCliArgs(['--bump', 'minor', '--to', sha])).toEqual({ bump: 'minor', to: sha });
  });

  it('auto・major・minor・patch のほかの bump は受け付けない', () => {
    expect(() => parseCliArgs(['--bump', 'prerelease'])).toThrow('bump');
  });

  it.each(['main"; touch pwned; "', '$(id)', 'a b', '-n', ''])(
    'git log にシェルの文字列として渡るので、ref に使わない文字を含む to（%j）は受け付けない',
    (to) => {
      expect(() => parseCliArgs(['--to', to])).toThrow('to');
    },
  );

  it('知らない引数は受け付けない', () => {
    expect(() => parseCliArgs(['--from', 'v1.0.0'])).toThrow('--from');
  });
});
