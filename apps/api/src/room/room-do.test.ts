import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { closeOf, connect, newRoom, type RoomStub } from '../../test/room-socket';
import { getAttachment } from './attachment';
import type { RoomEntry } from './connections';
import { RoomDurableObject } from './room-do';

/** 部屋の DO が受け付けている接続の attachment を、すべて読む */
const readAttachments = (stub: RoomStub) =>
  runInDurableObject(stub, (_instance, state) => state.getWebSockets().map(getAttachment));

const roomNotFound = { code: CLOSE_CODES.room_not_found, reason: 'room_not_found' };

describe('部屋の DO（ROOM）', () => {
  it('部屋ごとに RoomDurableObject のインスタンスができる', async () => {
    const stub = env.ROOM.getByName('room-a');

    await runInDurableObject(stub, (instance) => {
      expect(instance).toBeInstanceOf(RoomDurableObject);
    });
  });

  // new_sqlite_classes で宣言していないと ctx.storage.sql が使えず、ここで例外になる
  it('DO の SQLite に書いた行を読み戻せる', async () => {
    const stub = env.ROOM.getByName('room-b');

    const rows = await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('CREATE TABLE probe (value TEXT NOT NULL)');
      state.storage.sql.exec('INSERT INTO probe (value) VALUES (?)', 'hello');
      return state.storage.sql.exec<{ value: string }>('SELECT value FROM probe').toArray();
    });

    expect(rows).toEqual([{ value: 'hello' }]);
  });
});

describe('ない部屋・他人の部屋への接続（S1・ADR 0004）', () => {
  it.each<[string, RoomEntry]>([
    ['ホスト用', { role: 'host', ownerId: 'alice' }],
    ['回答者用', { role: 'player' }],
  ])('作られていない部屋に%sの入口でつなぐと、受け付けてから 4404 で閉じ、接続を残さない', async (_, entry) => {
    // initialize していない DO。room の表が空になる
    const stub = env.ROOM.get(env.ROOM.newUniqueId());

    const ws = await connect(stub, entry);

    expect(await closeOf(ws)).toEqual(roomNotFound);
    expect(await readAttachments(stub)).toEqual([]);
  });

  it('持ち主でないホストは、ない部屋と同じ 4404 で閉じる', async () => {
    const stub = await newRoom('alice');

    const ws = await connect(stub, { role: 'host', ownerId: 'mallory' });

    expect(await closeOf(ws)).toEqual(roomNotFound);
    expect(await readAttachments(stub)).toEqual([]);
  });

  it('持ち主でないホストは、部屋が終わっていても 4410 ではなく 4404 で閉じる。終わったかどうかも知らせない', async () => {
    const stub = await newRoom('alice');
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE room SET ended_at = ?', Date.now());
    });

    const ws = await connect(stub, { role: 'host', ownerId: 'mallory' });

    expect(await closeOf(ws)).toEqual(roomNotFound);
  });
});
