import { describe, expect, it } from 'vitest';

import { REDACTED, redactToken } from './redact.ts';

const token = 'q0Zt8m3yH1bQ9wXcV2nL5kR7pJ4sD6fG0aU1eI3oY2E';

describe('redactToken（ADR 0004: 秘密をログに出さない）', () => {
  it('join の token を伏せ、名前は残す', () => {
    expect(redactToken({ type: 'join', name: 'たろう', token })).toEqual({
      type: 'join',
      name: 'たろう',
      token: REDACTED,
    });
  });

  it('resume の token を伏せる', () => {
    expect(redactToken({ type: 'resume', token })).toEqual({ type: 'resume', token: REDACTED });
  });

  it('仕様に合わないメッセージでも、入れ子の token を伏せる', () => {
    // 検査に通らなかったメッセージこそログに出したくなるので、形を決めつけない
    expect(redactToken({ type: 'join', data: { token }, list: [{ token }, 'x'] })).toEqual({
      type: 'join',
      data: { token: REDACTED },
      list: [{ token: REDACTED }, 'x'],
    });
  });

  it('token が文字列でなくても伏せる', () => {
    expect(redactToken({ type: 'resume', token: [token] })).toEqual({ type: 'resume', token: REDACTED });
  });

  it('渡したオブジェクトは書き換えない（部屋の DO がこのあとも使う）', () => {
    const message = { type: 'resume', token };
    redactToken(message);
    expect(message.token).toBe(token);
  });

  it('オブジェクトでない値は、そのまま返す', () => {
    expect(redactToken('hello')).toBe('hello');
    expect(redactToken(42)).toBe(42);
    expect(redactToken(null)).toBeNull();
  });
});
