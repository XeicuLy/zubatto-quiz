import { CLOSE_CODES, type Participants } from '@zubatto-quiz/protocol';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connect, joinPlayer, messageReader, newRoom, newToken, resumePlayer } from '../../../test/room-socket';
import { getAttachment } from '../attachment';
import { handleResume, RESUME_WINDOW_MS } from './resume';

const lobby = { title: 'テストの部屋', questionCount: 1, phase: 'lobby', questionIndex: null };

describe('resume（F19・ADR 0004）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('join と同じ秘密で戻ると、同じ participantId と名前・得点・部屋の要約が届き、回答者として扱われる', async () => {
    const stub = await newRoom();
    const token = newToken();
    const { participantId } = await joinPlayer(stub, 'たろう', token);

    const { ws, next } = await resumePlayer(stub, token);

    expect(await next()).toEqual({ type: 'resumed', participantId, name: 'たろう', score: 0, room: lobby });
    // 戻った接続は確認済みになるので、join は断られる
    ws.send(JSON.stringify({ type: 'join', name: 'じろう', token: newToken() }));
    expect(await next()).toEqual({ type: 'error', code: 'invalid_state' });
  });

  it('間違った秘密では 4401 resume_failed で閉じる', async () => {
    const stub = await newRoom();
    await joinPlayer(stub, 'たろう', newToken());

    const { closed } = await resumePlayer(stub, newToken());

    expect(await closed).toEqual({ code: CLOSE_CODES.resume_failed, reason: 'resume_failed' });
  });

  it('部屋が終わったあとは 4410 room_ended で閉じる', async () => {
    const stub = await newRoom();
    const token = newToken();
    await joinPlayer(stub, 'たろう', token);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE room SET ended_at = ?', Date.now());
    });

    const { closed } = await resumePlayer(stub, token);

    expect(await closed).toEqual({ code: CLOSE_CODES.room_ended, reason: 'room_ended' });
  });

  it('入室から6時間ちょうどまでは戻れ、それを過ぎると 4401 resume_failed で閉じる', async () => {
    // 部屋の DO もテストと同じ isolate で動くので、Date.now() の値をテストから進められる
    vi.useFakeTimers({ toFake: ['Date'] });
    const joinedAt = Date.now();
    const stub = await newRoom();
    const token = newToken();
    const { participantId } = await joinPlayer(stub, 'たろう', token);

    vi.setSystemTime(joinedAt + RESUME_WINDOW_MS);
    expect(await (await resumePlayer(stub, token)).next()).toMatchObject({ type: 'resumed', participantId });

    vi.setSystemTime(joinedAt + RESUME_WINDOW_MS + 1);
    expect(await (await resumePlayer(stub, token)).closed).toEqual({
      code: CLOSE_CODES.resume_failed,
      reason: 'resume_failed',
    });
  });

  it('確認済みの接続から resume を送ると invalid_state が返る', async () => {
    const stub = await newRoom();
    const token = newToken();
    const { ws, next } = await joinPlayer(stub, 'たろう', token);
    await next(); // 参加者一覧

    ws.send(JSON.stringify({ type: 'resume', token }));

    expect(await next()).toEqual({ type: 'error', code: 'invalid_state' });
  });

  it('秘密のハッシュを求めているあいだに接続が閉じられたら、回答者として扱わない', async () => {
    const stub = await newRoom();
    const token = newToken();
    await joinPlayer(stub, 'たろう', token);
    await connect(stub, { role: 'player' });

    const attachment = await runInDurableObject(stub, async (_instance, state) => {
      const pending = state.getWebSockets().find((ws) => getAttachment(ws) === null);
      if (!pending) {
        throw new Error('未確認の接続がない');
      }
      // handleResume は hashToken の await で止まる。そのすきに、時間切れの alarm と同じように接続を閉じる
      const resuming = handleResume(state, pending, { type: 'resume', token });
      pending.close(CLOSE_CODES.join_timeout, 'join_timeout');
      await resuming;
      return getAttachment(pending);
    });

    expect(attachment).toBeNull();
  });
});

describe('つなぎ直し（A1・A3・ADR 0004）', () => {
  it('join の応答が届く前に接続が切れても、保存した秘密の resume で同じ participantId に戻れる', async () => {
    const stub = await newRoom();
    const host = messageReader(await connect(stub, { role: 'host', ownerId: 'alice' }));
    const token = newToken();
    const ws = await connect(stub, { role: 'player' });

    // 端末は秘密を保存してから join を送る。joined を読む前に回線が切れたことにする
    ws.send(JSON.stringify({ type: 'join', name: 'たろう', token }));
    const { participants } = (await host()) as Participants;
    ws.close();

    const { next } = await resumePlayer(stub, token);

    expect(await next()).toMatchObject({ type: 'resumed', participantId: participants[0]?.participantId });
  });

  it.each([
    // 休止では接続が残るので、resume の置き換えで閉じられる
    ['休止（接続は残る）', undefined, CLOSE_CODES.replaced],
    // 再起動では、DO が落ちたときに close を送らずに切れる
    ['DO の再起動（接続も閉じる）', { webSockets: 'close' } as const, 1006],
  ])('%s のあとも、同じ participantId で戻れる', async (_case, options, oldCloseCode) => {
    const stub = await newRoom();
    const token = newToken();
    const { participantId, closed } = await joinPlayer(stub, 'たろう', token);

    await evictDurableObject(stub, options);
    const { next } = await resumePlayer(stub, token);

    expect(await next()).toMatchObject({ type: 'resumed', participantId, name: 'たろう' });
    expect((await closed).code).toBe(oldCloseCode);
  });
});

describe('得点と部屋の今の状態（ADR 0001）', () => {
  it('resume で、その回答者の確定した得点の合計と、部屋の今の段階が返る', async () => {
    const stub = await newRoom();
    const token = newToken();
    const taro = await joinPlayer(stub, 'たろう', token);
    const hanako = await joinPlayer(stub, 'はなこ');
    await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      sql.exec(
        "INSERT INTO questions (id, position, text, choices, correct_index, limit_ms) VALUES ('q-2', 1, '2問目', '[\"a\",\"b\"]', 0, 10000)",
      );
      for (const [questionId, participantId, points] of [
        ['q-1', taro.participantId, 800],
        ['q-2', taro.participantId, 300],
        ['q-1', hanako.participantId, 500],
      ] as const) {
        sql.exec(
          'INSERT INTO question_scores (question_id, participant_id, points) VALUES (?, ?, ?)',
          questionId,
          participantId,
          points,
        );
      }
      sql.exec("UPDATE room SET phase = 'revealed', current_position = 1");
    });

    const { next } = await resumePlayer(stub, token);

    expect(await next()).toEqual({
      type: 'resumed',
      participantId: taro.participantId,
      name: 'たろう',
      score: 1_100,
      room: { title: 'テストの部屋', questionCount: 2, phase: 'revealed', questionIndex: 1 },
    });
  });
});
