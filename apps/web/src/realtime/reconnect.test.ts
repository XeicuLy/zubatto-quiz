import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { reconnectDelay, shouldReconnect } from './reconnect';

describe('reconnectDelay', () => {
  it.each([
    // [何回目のつなぎ直しか, Math.random の値, 待つミリ秒]
    // 基準は 500 * 2 ** attempt で、random によってその半分から全部までばらつく
    [0, 0, 250],
    [0, 0.5, 375],
    [1, 0, 500],
    [2, 0, 1_000],
    // 500 * 2 ** 5 = 16_000 は上限の30秒より短い
    [5, 0.5, 12_000],
    // 500 * 2 ** 6 = 32_000 は上限を超えるので、30秒を基準にする
    [6, 0.5, 22_500],
    [100, 0.5, 22_500],
  ])('%i 回目で random が %d なら、%i ミリ秒待つ', (attempt, random, expected) => {
    expect(reconnectDelay(attempt, () => random)).toBe(expected);
  });
});

describe('shouldReconnect', () => {
  it.each([
    // アプリの code でないもの。デプロイ・回線切れ・サーバーの再起動などで、一時的に切れただけ
    [1001, true],
    [1006, true],
    [1011, true],
    [1012, true],
    // 一時的に断られたので、間を空ければつながる（ADR 0004）
    [CLOSE_CODES.join_timeout, true],
    [CLOSE_CODES.connection_limit, true],
    // つなぎ直しても同じ理由で閉じられるので、画面に理由を出して止まる
    [CLOSE_CODES.replaced, false],
    [CLOSE_CODES.resume_failed, false],
    [CLOSE_CODES.room_full, false],
    [CLOSE_CODES.name_taken, false],
    [CLOSE_CODES.room_ended, false],
  ])('code %i なら %s', (code, expected) => {
    expect(shouldReconnect(code)).toBe(expected);
  });
});
