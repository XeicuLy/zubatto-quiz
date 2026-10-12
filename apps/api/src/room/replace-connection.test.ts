import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  connect,
  joinPlayer,
  messageReader,
  newRoom,
  newToken,
  resumePlayer,
  type RoomStub,
} from '../../test/room-socket';
import { getAttachment } from './attachment';

const replaced = { code: CLOSE_CODES.replaced, reason: 'replaced' };

/** 部屋の DO が受け付けている接続のうち、開いているものの attachment を読む */
const readOpenAttachments = (stub: RoomStub) =>
  runInDurableObject(stub, (_instance, state) =>
    state
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map(getAttachment),
  );

describe('同じ回答者の古い接続の置き換え（ADR 0004 の X1）', () => {
  it('同じ participantId で2本目がつながると、古い接続だけが 4301 replaced で閉じられる', async () => {
    const stub = await newRoom();
    await connect(stub, { role: 'host', ownerId: 'alice' });
    const token = newToken();
    const taro = await joinPlayer(stub, 'たろう', token);
    const hanako = await joinPlayer(stub, 'はなこ');

    const { next } = await resumePlayer(stub, token);

    expect(await next()).toMatchObject({ type: 'resumed', participantId: taro.participantId });
    expect(await taro.closed).toEqual(replaced);
    // ホスト・ほかの回答者・新しい接続は開いたまま
    const open = await readOpenAttachments(stub);
    expect(open).toHaveLength(3);
    expect(open).toEqual(
      expect.arrayContaining([
        { role: 'host', ownerId: 'alice' },
        { role: 'player', participantId: hanako.participantId },
        { role: 'player', participantId: taro.participantId },
      ]),
    );
  });

  it('3本目がつながると、それまでの2本とも閉じられ、最後の1本だけが残る', async () => {
    const stub = await newRoom();
    const token = newToken();
    const first = await joinPlayer(stub, 'たろう', token);
    const second = await resumePlayer(stub, token);
    await second.next();

    const third = await resumePlayer(stub, token);
    await third.next();

    expect(await first.closed).toEqual(replaced);
    expect(await second.closed).toEqual(replaced);
    expect(await readOpenAttachments(stub)).toEqual([{ role: 'player', participantId: first.participantId }]);
  });

  it('未確認の接続は、置き換えで閉じられない', async () => {
    const stub = await newRoom();
    const token = newToken();
    await joinPlayer(stub, 'たろう', token);
    const pendingWs = await connect(stub, { role: 'player' });
    const pending = messageReader(pendingWs);

    await (await resumePlayer(stub, token)).next();

    // 閉じられていなければ、送ったメッセージに応答が返る
    pendingWs.send('not json');
    expect(await pending()).toEqual({ type: 'error', code: 'invalid_message' });
  });
});
