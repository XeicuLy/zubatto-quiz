import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { RoomDurableObject } from './room-do';

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
