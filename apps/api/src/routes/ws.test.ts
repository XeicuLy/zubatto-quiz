import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { apiRequest, loginAs, ORIGIN, resetHosts } from '../../test/host-request';
import { newRoom, openSocket } from '../../test/room-socket';
import { getAttachment } from '../room/attachment';

beforeEach(resetHosts);

type Entry = 'host' | 'play';
const ENTRIES = ['host', 'play'] as const satisfies Entry[];

/**
 * ブラウザが WebSocket を開くときと同じ形で、部屋の入口へ要求を送る。
 * ブラウザは WebSocket に必ず Origin を付ける。as を渡すと、そのホストのログイン Cookie も付ける
 */
async function wsRequest(roomId: string, entry: Entry, options: { origin?: string | null; as?: string } = {}) {
  const headers = options.as ? await loginAs(options.as) : new Headers();
  headers.set('upgrade', 'websocket');
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) {
    headers.set('origin', origin);
  }
  return apiRequest(`/rooms/${roomId}/ws/${entry}`, { headers });
}

/** alice の部屋を作り、その部屋の ID を返す */
const newRoomId = async () => (await newRoom('alice')).id.toString();

/** roomId の部屋の DO が受け付けている接続の attachment を、すべて読む */
const readAttachments = (roomId: string) =>
  runInDurableObject(env.ROOM.get(env.ROOM.idFromString(roomId)), (_instance, state) =>
    state.getWebSockets().map(getAttachment),
  );

describe('ホスト用の入口 /api/rooms/:roomId/ws/host（ADR 0003）', () => {
  it('部屋の持ち主が同じオリジンの画面から開くと、host として受け付ける', async () => {
    const roomId = await newRoomId();

    openSocket(await wsRequest(roomId, 'host', { as: 'alice' }));

    expect(await readAttachments(roomId)).toEqual([{ role: 'host', ownerId: 'alice' }]);
  });

  it('部屋の持ち主でないホストは受け付けず、ない部屋と同じ 404 を返す（S1）', async () => {
    const roomId = await newRoomId();

    const response = await wsRequest(roomId, 'host', { as: 'mallory' });

    expect(response.status).toBe(404);
    expect(await readAttachments(roomId)).toEqual([]);
  });

  it('ログインしていなければ 401 を返す。ownerId のヘッダーを自分で付けても、ホストにはなれない', async () => {
    const roomId = await newRoomId();
    const headers = new Headers({ upgrade: 'websocket', origin: ORIGIN, 'x-zubakui-owner-id': 'alice' });

    const response = await apiRequest(`/rooms/${roomId}/ws/host`, { headers });

    expect(response.status).toBe(401);
    expect(await readAttachments(roomId)).toEqual([]);
  });
});

describe('回答者用の入口 /api/rooms/:roomId/ws/play（ADR 0004）', () => {
  it('ログインしていなくても受け付け、attachment は null（未確認）にする', async () => {
    const roomId = await newRoomId();

    openSocket(await wsRequest(roomId, 'play'));

    expect(await readAttachments(roomId)).toEqual([null]);
  });

  it('持ち主のログイン Cookie と ownerId のヘッダーが付いていても、DO には渡らず未確認のままになる（ADR 0003）', async () => {
    const roomId = await newRoomId();
    const headers = await loginAs('alice');
    headers.set('upgrade', 'websocket');
    headers.set('origin', ORIGIN);
    headers.set('x-zubakui-owner-id', 'alice');

    openSocket(await apiRequest(`/rooms/${roomId}/ws/play`, { headers }));

    expect(await readAttachments(roomId)).toEqual([null]);
  });
});

describe.each(ENTRIES)('どちらの入口でも断る接続（%s）', (entry) => {
  it.each([
    ['別のサイト', 'https://evil.example'],
    // 同じアカウントの別の Worker は、workers.dev の上で同じサイトになる。SameSite=Lax では止まらない（ADR 0003）
    ['同じサイトの別の Worker', 'https://other.example.workers.dev'],
    ['localhost の別のポート', 'http://localhost:5174'],
    ['https にしただけのオリジン', 'https://localhost:5173'],
  ])('%sの Origin からの接続は、ログイン Cookie が付いていても 403 を返す（S1）', async (_, origin) => {
    const roomId = await newRoomId();

    const response = await wsRequest(roomId, entry, { origin, as: 'alice' });

    expect(response.status).toBe(403);
    expect(await readAttachments(roomId)).toEqual([]);
  });

  it('Origin のない接続は 403 を返す', async () => {
    const roomId = await newRoomId();

    const response = await wsRequest(roomId, entry, { origin: null, as: 'alice' });

    expect(response.status).toBe(403);
  });

  it('Origin は Cookie を読む前に確かめる。ログインしていなくても、401 ではなく 403 になる（ADR 0003）', async () => {
    const roomId = await newRoomId();

    const response = await wsRequest(roomId, entry, { origin: 'https://evil.example' });

    expect(response.status).toBe(403);
  });

  it('Upgrade: websocket のない要求には 426 を返す', async () => {
    const roomId = await newRoomId();
    const headers = await loginAs('alice');
    headers.set('origin', ORIGIN);

    const response = await apiRequest(`/rooms/${roomId}/ws/${entry}`, { headers });

    expect(response.status).toBe(426);
  });

  it.each([
    ['64桁の16進でない', 'not-a-room-id'],
    ['大文字の16進', 'A'.repeat(64)],
    // 形は正しいが、この DO の名前空間で作った ID ではないので、idFromString が例外を投げる
    ['ほかの名前空間の ID', 'f'.repeat(64)],
  ])('部屋 ID が%sときは 404 を返す', async (_, roomId) => {
    const response = await wsRequest(roomId, entry, { as: 'alice' });

    expect(response.status).toBe(404);
  });

  it('作られていない部屋（initialize していない DO）には 404 を返す', async () => {
    const roomId = env.ROOM.newUniqueId().toString();

    const response = await wsRequest(roomId, entry, { as: 'alice' });

    expect(response.status).toBe(404);
    expect(await readAttachments(roomId)).toEqual([]);
  });
});
