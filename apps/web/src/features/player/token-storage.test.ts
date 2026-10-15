import { playerTokenSchema } from '@zubatto-quiz/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearToken, createToken, loadToken, saveToken, tokenKey } from './token-storage';

const ROOM_ID = 'a'.repeat(64);
const OTHER_ROOM_ID = 'b'.repeat(64);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('秘密を作る（ADR 0004）', () => {
  it('32バイトの乱数を base64url（= なし）の43文字にする', () => {
    const token = createToken();

    expect(token).toHaveLength(43);
    expect(playerTokenSchema.safeParse(token).success).toBe(true);
  });

  it('crypto.getRandomValues の32バイトをそのまま使う', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      // 0xfb 0xff は base64 で「+」「/」になる並び。base64url では「-」「_」にする
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0xfb).set([0xff, 0xff, 0xff], 0);
      return array;
    });

    expect(createToken()).toBe('____-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_s');
  });

  it('作るたびに違う', () => {
    expect(createToken()).not.toBe(createToken());
  });
});

describe('秘密を部屋ごとに保存する', () => {
  it('部屋ごとのキーに保存し、読み出せる', () => {
    const token = createToken();

    expect(saveToken(ROOM_ID, token)).toBe(true);

    expect(localStorage.getItem(tokenKey(ROOM_ID))).toBe(token);
    expect(loadToken(ROOM_ID)).toBe(token);
    expect(loadToken(OTHER_ROOM_ID)).toBeNull();
  });

  it('キーは zubakui:room:<部屋 ID>:token', () => {
    expect(tokenKey(ROOM_ID)).toBe(`zubakui:room:${ROOM_ID}:token`);
  });

  it('消すと、その部屋の秘密だけがなくなる', () => {
    saveToken(ROOM_ID, createToken());
    const other = createToken();
    saveToken(OTHER_ROOM_ID, other);

    clearToken(ROOM_ID);

    expect(loadToken(ROOM_ID)).toBeNull();
    expect(loadToken(OTHER_ROOM_ID)).toBe(other);
  });

  it('形の違う値が入っていたら、無いものとして扱う', () => {
    localStorage.setItem(tokenKey(ROOM_ID), 'not-a-token');

    expect(loadToken(ROOM_ID)).toBeNull();
  });
});

describe('localStorage が使えないとき（プライベートブラウズなど）', () => {
  it('保存できなければ false を返し、例外を投げない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(saveToken(ROOM_ID, createToken())).toBe(false);
  });

  it('読めなければ null を返し、消せなくても例外を投げない', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(loadToken(ROOM_ID)).toBeNull();
    expect(() => clearToken(ROOM_ID)).not.toThrow();
  });
});
