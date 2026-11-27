import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { account, session } from '@/db/schema';

import { EMPTIED_ACCOUNT_FIELDS, EMPTIED_SESSION_FIELDS, hostUserFromGithub, syntheticEmail } from './host-data-policy';

describe('合成の email（ADR 0016 の E1）', () => {
  it('GitHub の ID から、届かない .invalid の宛先を作る', () => {
    expect(syntheticEmail('12345')).toBe('12345@users.zubakui.invalid');
  });
});

describe('GitHub のプロフィールから user の行に入れる値', () => {
  it('name は login、email は合成の値、image は空にし、本名・email・アバターを使わない', () => {
    const profile = {
      id: 12345,
      login: 'octocat',
      name: '山田 太郎',
      email: 'taro@example.com',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
    };

    // toStrictEqual で、image のキーがあることまで確かめる。キーが無いと、Better Auth の既定のアバターが残る
    expect(hostUserFromGithub(profile)).toStrictEqual({
      name: 'octocat',
      email: '12345@users.zubakui.invalid',
      emailVerified: false,
      image: undefined,
    });
  });

  it('ID が文字列でも数値でも、同じ email になる（Better Auth の型は string、GitHub の応答は number）', () => {
    expect(hostUserFromGithub({ id: '12345', login: 'octocat' }).email).toBe(
      hostUserFromGithub({ id: 12345, login: 'octocat' }).email,
    );
  });
});

describe('空にする列', () => {
  // 既にある行の書き換え（scripts/scrub-host-data.ts）も同じ定数から SQL を作るので、キーが表の列で、NULL を入れられることを確かめておく
  it.each([
    ['account', EMPTIED_ACCOUNT_FIELDS, getTableColumns(account)],
    ['session', EMPTIED_SESSION_FIELDS, getTableColumns(session)],
  ] as const)('%s の列はどれも表にあり、NULL を許し、null にする', (_, fields, columns) => {
    for (const [key, value] of Object.entries(fields)) {
      expect(value).toBeNull();
      expect(Object.hasOwn(columns, key)).toBe(true);
      expect(columns[key as keyof typeof columns].notNull).toBe(false);
    }
  });

  it('account はトークンと scope、session は IP と User-Agent を空にする', () => {
    expect(Object.keys(EMPTIED_ACCOUNT_FIELDS)).toEqual(['accessToken', 'refreshToken', 'idToken', 'scope']);
    expect(Object.keys(EMPTIED_SESSION_FIELDS)).toEqual(['ipAddress', 'userAgent']);
  });
});
