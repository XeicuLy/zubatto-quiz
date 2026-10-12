import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { RoomInit } from './room-do';

const init = {
  ownerId: 'alice',
  title: '忘年会クイズ',
  questions: [
    { id: 'q-1', text: '社長の好物は？', choices: ['寿司', '焼肉', 'カレー'], correctIndex: 2, limitMs: 10_000 },
    { id: 'q-2', text: '会社の創立は何年？', choices: ['1999', '2005'], correctIndex: 0, limitMs: 20_000 },
  ],
} satisfies RoomInit;

/** テストごとに新しい部屋の DO を作る。newUniqueId なので、ほかのテストの部屋と混ざらない */
const newRoom = () => env.ROOM.get(env.ROOM.newUniqueId());

/**
 * RPC の戻り値（RpcPromise）を、then だけを呼ぶふつうの Promise に包む。
 * RpcPromise は、読んだプロパティをどれも DO への呼び出しとして扱う。expect(...).rejects にそのまま渡すと、
 * then 以外のプロパティも読まれることがあり、その呼び出しの失敗が Unhandled Rejection になってテストの実行が失敗する
 */
const settle = <T>(rpc: PromiseLike<T>) => new Promise<T>((resolve, reject) => rpc.then(resolve, reject));

/** 部屋の DO の SQLite に入っている部屋と問題を読む */
const readRoom = (stub: DurableObjectStub) =>
  runInDurableObject(stub, (_instance, state) => {
    const { sql } = state.storage;
    return {
      room: sql.exec('SELECT owner_id, title, phase, current_position, ended_at FROM room').toArray(),
      questions: sql
        .exec('SELECT id, position, text, choices, correct_index, limit_ms, closed_at FROM questions ORDER BY position')
        .toArray(),
    };
  });

describe('部屋の DO の initialize（ADR 0002）', () => {
  it('持ち主と問題セットの写しを書く。問題は渡した順番どおりで、正解も含む', async () => {
    const stub = newRoom();

    await stub.initialize(init);

    expect(await readRoom(stub)).toEqual({
      room: [{ owner_id: 'alice', title: '忘年会クイズ', phase: 'lobby', current_position: null, ended_at: null }],
      questions: [
        {
          id: 'q-1',
          position: 0,
          text: '社長の好物は？',
          choices: JSON.stringify(['寿司', '焼肉', 'カレー']),
          correct_index: 2,
          limit_ms: 10_000,
          closed_at: null,
        },
        {
          id: 'q-2',
          position: 1,
          text: '会社の創立は何年？',
          choices: JSON.stringify(['1999', '2005']),
          correct_index: 0,
          limit_ms: 20_000,
          closed_at: null,
        },
      ],
    });
  });

  it('2回目の初期化は断り、1回目の中身を変えない', async () => {
    const stub = newRoom();
    await stub.initialize(init);
    const before = await readRoom(stub);

    await expect(
      settle(stub.initialize({ ownerId: 'mallory', title: '乗っ取り', questions: [init.questions[0]] })),
    ).rejects.toThrow('部屋はもう作られている');

    expect(await readRoom(stub)).toEqual(before);
  });

  it('途中の問題で書き込みに失敗したら、部屋も問題も何も残らない', async () => {
    const stub = newRoom();
    // 2問目の制限時間が CHECK（5〜60秒）に合わないので、2問目の INSERT で失敗する
    const broken = { ...init, questions: [init.questions[0], { ...init.questions[1], limitMs: 1_000 }] };

    await expect(settle(stub.initialize(broken))).rejects.toThrow(/CHECK constraint failed/);

    expect(await readRoom(stub)).toEqual({ room: [], questions: [] });
  });
});
