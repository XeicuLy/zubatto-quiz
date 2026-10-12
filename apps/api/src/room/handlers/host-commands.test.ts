import { CLOSE_CODES, type ClientMessage, type RoomPhase } from '@zubatto-quiz/protocol';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeOf, connect, connectHost, exchange, joinPlayer, newRoom, type RoomStub } from '../../../test/room-socket';
import { JOIN_TIMEOUT_MS } from '../pending-timeout';

const LIMIT_MS = 10_000;

/** alice の部屋のホスト用の入口につなぎ、hostReady と参加者一覧を読み終えた状態で返す */
async function connectHostWithSend(stub: RoomStub) {
  const host = await connectHost(stub);
  return { ...host, send: (message: ClientMessage) => exchange(host, message) };
}

/** 回答者を入室させ、入室のときの参加者一覧を読み終えた状態で返す */
async function connectPlayer(stub: RoomStub, name = 'たろう') {
  const player = await joinPlayer(stub, name);
  await player.next();
  return { ...player, send: (message: ClientMessage) => exchange(player, message) };
}

/** 部屋の DO の進行の状態を読む */
const readRoom = (stub: RoomStub) =>
  runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec<{ phase: RoomPhase; questionIndex: number | null; deadlineAt: number | null; endedAt: number | null }>(
        'SELECT phase, current_position AS questionIndex, deadline_at AS deadlineAt, ended_at AS endedAt FROM room',
      )
      .one(),
  );

const readAlarm = (stub: RoomStub) => runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());

const questionShown = (n: number, questionCount: number) => ({
  type: 'questionShown',
  questionId: `q-${n}`,
  questionIndex: n - 1,
  questionCount,
  text: n === 1 ? '社長の好物は？' : `第${n}問`,
  limitMs: LIMIT_MS,
});

const answeringStarted = (n: number) => ({
  type: 'answeringStarted',
  questionId: `q-${n}`,
  choices: ['寿司', '焼肉'],
  limitMs: LIMIT_MS,
  remainingMs: LIMIT_MS,
});

const notHost = { type: 'error', code: 'not_host' };
const invalidState = { type: 'error', code: 'invalid_state' };

describe('進行操作を受け付ける接続（S1・ADR 0003）', () => {
  it.each<ClientMessage>([
    { type: 'showQuestion', questionIndex: 0 },
    { type: 'retryQuestion', questionIndex: 0 },
    { type: 'showFinalRanking' },
    { type: 'endRoom' },
  ])('回答者用の接続から $type を送ると not_host で断り、状態を変えない', async (command) => {
    const stub = await newRoom();
    // 部屋の持ち主の alice が、回答者用の入口から入っても、ホストとしては扱わない
    const player = await connectPlayer(stub, 'alice');

    expect(await player.send(command)).toEqual([notHost]);
    expect(await readRoom(stub)).toEqual({ phase: 'lobby', questionIndex: null, deadlineAt: null, endedAt: null });
  });

  it('ホスト用の接続からの進行操作は受け付ける', async () => {
    const stub = await newRoom();
    const host = await connectHostWithSend(stub);

    expect(await host.send({ type: 'showQuestion', questionIndex: 0 })).toEqual([questionShown(1, 1)]);
    expect(await readRoom(stub)).toMatchObject({ phase: 'question', questionIndex: 0 });
  });
});

describe('出題と受付開始（F8・S2）', () => {
  it('出題では問題文だけを全員に配り、受付開始で初めて選択肢を配る', async () => {
    const stub = await newRoom();
    const player = await connectPlayer(stub);
    const host = await connectHostWithSend(stub);

    await host.send({ type: 'showQuestion', questionIndex: 0 });
    expect(await player.next()).toEqual(questionShown(1, 1));
    expect(await readRoom(stub)).toMatchObject({ phase: 'question', deadlineAt: null });

    await host.send({ type: 'startAnswering', questionIndex: 0 });
    expect(await player.next()).toEqual(answeringStarted(1));
    expect(await readRoom(stub)).toMatchObject({ phase: 'accepting' });
  });

  it('締切の前に回答者に届くメッセージに、正解が含まれない（S2・ADR 0002）', async () => {
    const stub = await newRoom();
    const player = await joinPlayer(stub, 'たろう');
    const host = await connectHostWithSend(stub);

    await host.send({ type: 'showQuestion', questionIndex: 0 });
    await host.send({ type: 'startAnswering', questionIndex: 0 });
    // 入室から受付開始までに届いたものを、すべて読む（参加者一覧・出題・受付開始）
    const received = [await player.next(), await player.next(), await player.next()];

    expect(received.at(-1)).toMatchObject({ type: 'answeringStarted' });
    expect(JSON.stringify(received)).not.toMatch(/correct/i);
  });

  it('今の段階と合わない操作は、送った人に invalid_state を返し、状態を変えない', async () => {
    const stub = await newRoom();
    const host = await connectHostWithSend(stub);

    // 出題の前に受付を始める
    expect(await host.send({ type: 'startAnswering', questionIndex: 0 })).toEqual([invalidState]);
    expect(await readRoom(stub)).toMatchObject({ phase: 'lobby', questionIndex: null });
  });
});

describe('締切（F9）', () => {
  let now: number;

  beforeEach(() => {
    // 部屋の DO もテストと同じ isolate で動くので、Date.now() の値をテストから進められる
    vi.useFakeTimers({ toFake: ['Date'] });
    now = Date.now();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => vi.setSystemTime((now += ms));

  /** 第1問を出して受付を始めたホスト */
  async function startAnswering(stub: RoomStub) {
    const host = await connectHostWithSend(stub);
    await host.send({ type: 'showQuestion', questionIndex: 0 });
    await host.send({ type: 'startAnswering', questionIndex: 0 });
    return host;
  }

  it('受付開始で「今 + 制限時間」を締切として保存し、その時刻に alarm を予定する', async () => {
    const stub = await newRoom();

    await startAnswering(stub);

    expect(await readRoom(stub)).toMatchObject({ phase: 'accepting', deadlineAt: now + LIMIT_MS });
    expect(await readAlarm(stub)).toBe(now + LIMIT_MS);
  });

  it('制限時間が来ると、alarm で自動で締め切られる。来る前の alarm では締め切らない', async () => {
    const stub = await newRoom();
    await startAnswering(stub);

    advance(LIMIT_MS - 1);
    await runDurableObjectAlarm(stub);
    expect(await readRoom(stub)).toMatchObject({ phase: 'accepting' });

    advance(1);
    await runDurableObjectAlarm(stub);
    expect(await readRoom(stub)).toMatchObject({ phase: 'revealed', questionIndex: 0, deadlineAt: null });
  });

  it('ホストは時間切れの前に締め切れる。そのあとに alarm が動いても何も変わらない', async () => {
    const stub = await newRoom();
    const host = await startAnswering(stub);

    await host.send({ type: 'closeAnswering', questionIndex: 0 });
    expect(await readRoom(stub)).toMatchObject({ phase: 'revealed', deadlineAt: null });

    advance(LIMIT_MS);
    await runDurableObjectAlarm(stub);
    await host.send({ type: 'revealFastest', questionIndex: 0 });
    // alarm が締切をもう一度当てていれば、② へは進めない
    expect(await readRoom(stub)).toMatchObject({ phase: 'fastest' });
  });

  it('未確認の接続のほうが早いとき、alarm はその時刻に予定される（ADR 0004）', async () => {
    const stub = await newRoom();
    await connect(stub, { role: 'player' });
    const pendingDeadline = now + JOIN_TIMEOUT_MS;

    advance(3_000);
    await startAnswering(stub);

    expect(await readAlarm(stub)).toBe(pendingDeadline);
  });

  it('締切のほうが早いとき、未確認の接続を受け付けても、alarm は締切の時刻のままになる（ADR 0004）', async () => {
    const stub = await newRoom();
    await startAnswering(stub);
    const deadline = now + LIMIT_MS;

    advance(3_000);
    await connect(stub, { role: 'player' });

    expect(await readAlarm(stub)).toBe(deadline);
  });

  it('締切を過ぎたら、alarm が遅れていても、その問題はやり直せず、そのまま ② へ進める（A3）', async () => {
    const stub = await newRoom();
    const player = await connectPlayer(stub);
    const host = await startAnswering(stub);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        'INSERT INTO answers (question_id, participant_id, choice_index, elapsed_ms, received_at) VALUES (?, ?, 0, 1230, ?)',
        'q-1',
        player.participantId,
        Date.now(),
      );
    });

    // alarm は最大1分ほど遅れることがある。締切を過ぎても、alarm はまだ動かさない
    advance(LIMIT_MS);

    // 操作の前に締め切るので、① の結果が先に届き、そのあとにやり直しが断られる
    expect(await host.send({ type: 'retryQuestion', questionIndex: 0 })).toEqual([
      expect.objectContaining({ type: 'revealed' }),
      invalidState,
    ]);
    const answers = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec('SELECT question_id FROM answers').toArray(),
    );
    expect(answers).toEqual([{ question_id: 'q-1' }]);
    expect(await host.send({ type: 'revealFastest', questionIndex: 0 })).toEqual([
      expect.objectContaining({ type: 'fastest' }),
    ]);
    expect(await readRoom(stub)).toMatchObject({ phase: 'fastest', deadlineAt: null });
  });

  it('受付中に休止しても、締切が残り、alarm で締め切られる（A3）', async () => {
    const stub = await newRoom();
    await startAnswering(stub);

    await evictDurableObject(stub);
    expect(await readRoom(stub)).toMatchObject({ phase: 'accepting', questionIndex: 0 });

    advance(LIMIT_MS);
    await runDurableObjectAlarm(stub);
    expect(await readRoom(stub)).toMatchObject({ phase: 'revealed' });
  });
});

describe('締切前の問題のやり直し（A3）', () => {
  /** 回答の行を直接書く。回答の受け付けは T22 で作る */
  const insertAnswer = (stub: RoomStub, questionId: string, participantId: string) =>
    runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        'INSERT INTO answers (question_id, participant_id, choice_index, elapsed_ms, received_at) VALUES (?, ?, 0, 1230, ?)',
        questionId,
        participantId,
        Date.now(),
      );
    });

  const readAnsweredQuestions = (stub: RoomStub) =>
    runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ question_id: string }>('SELECT question_id FROM answers ORDER BY question_id')
        .toArray()
        .map((row) => row.question_id),
    );

  it('休止のあと、受付中だった問題を出題からやり直せる。消すのはその問題の回答だけ', async () => {
    const stub = await newRoom('alice', 3);
    const player = await connectPlayer(stub);
    const host = await connectHostWithSend(stub);
    for (const command of [
      { type: 'showQuestion', questionIndex: 0 },
      { type: 'startAnswering', questionIndex: 0 },
      { type: 'closeAnswering', questionIndex: 0 },
      { type: 'revealFastest', questionIndex: 0 },
      { type: 'showQuestion', questionIndex: 1 },
      { type: 'startAnswering', questionIndex: 1 },
    ] as const) {
      await host.send(command);
    }
    await insertAnswer(stub, 'q-1', player.participantId);
    await insertAnswer(stub, 'q-2', player.participantId);

    await evictDurableObject(stub);
    expect(await host.send({ type: 'retryQuestion', questionIndex: 1 })).toEqual([questionShown(2, 3)]);

    expect(await readRoom(stub)).toMatchObject({ phase: 'question', questionIndex: 1, deadlineAt: null });
    expect(await readAnsweredQuestions(stub)).toEqual(['q-1']);
    // やり直したあとは、ふだんと同じく受付を始められる
    expect(await host.send({ type: 'startAnswering', questionIndex: 1 })).toEqual([answeringStarted(2)]);
  });
});

describe('締切のあとの順番（F14・F15）', () => {
  /** 第 index 問（0始まり）を締め切るまで進めたホスト */
  async function closeQuestion(host: Awaited<ReturnType<typeof connectHostWithSend>>, questionIndex: number) {
    for (const type of ['showQuestion', 'startAnswering', 'closeAnswering'] as const) {
      await host.send({ type, questionIndex });
    }
  }

  it('① のあとに ② を飛ばして次の問題は出せない', async () => {
    const stub = await newRoom('alice', 3);
    const host = await connectHostWithSend(stub);
    await closeQuestion(host, 0);

    expect(await host.send({ type: 'showQuestion', questionIndex: 1 })).toEqual([invalidState]);
    expect(await readRoom(stub)).toMatchObject({ phase: 'revealed', questionIndex: 0 });
  });

  it('最後の2問では、途中経過を出す操作が拒否される', async () => {
    const stub = await newRoom('alice', 3);
    const host = await connectHostWithSend(stub);
    await closeQuestion(host, 0);
    await host.send({ type: 'revealFastest', questionIndex: 0 });
    // 第1問（3問のうち、最後の2問ではない）では出せる
    expect(await host.send({ type: 'showStandings', questionIndex: 0 })).toEqual([
      expect.objectContaining({ type: 'standings' }),
    ]);

    await host.send({ type: 'showQuestion', questionIndex: 1 });
    await host.send({ type: 'startAnswering', questionIndex: 1 });
    await host.send({ type: 'closeAnswering', questionIndex: 1 });
    await host.send({ type: 'revealFastest', questionIndex: 1 });

    expect(await host.send({ type: 'showStandings', questionIndex: 1 })).toEqual([invalidState]);
    expect(await readRoom(stub)).toMatchObject({ phase: 'fastest', questionIndex: 1 });
  });

  it('最後の問題の ② のあとに、最終ランキングへ進める', async () => {
    const stub = await newRoom();
    const host = await connectHostWithSend(stub);
    await closeQuestion(host, 0);
    await host.send({ type: 'revealFastest', questionIndex: 0 });

    expect(await host.send({ type: 'showFinalRanking' })).toEqual([expect.objectContaining({ type: 'finalRanking' })]);
    expect(await readRoom(stub)).toMatchObject({ phase: 'final', questionIndex: 0 });
  });
});

describe('部屋を終える', () => {
  it('ホスト・回答者・未確認のすべての接続を 4410 room_ended で閉じ、終えた時刻を残す', async () => {
    const stub = await newRoom();
    const player = await connectPlayer(stub);
    const pending = closeOf(await connect(stub, { role: 'player' }));
    const host = await connectHostWithSend(stub);

    host.ws.send(JSON.stringify({ type: 'endRoom' }));

    const roomEnded = { code: CLOSE_CODES.room_ended, reason: 'room_ended' };
    expect(await Promise.all([host.closed, player.closed, pending])).toEqual([roomEnded, roomEnded, roomEnded]);
    expect(await readRoom(stub)).toMatchObject({ endedAt: expect.any(Number) });
  });
});

describe('進行操作から配信まで（P1・ADR 0003）', () => {
  it('D1 にも外部にも問い合わせない', async () => {
    const stub = await newRoom();
    const player = await connectPlayer(stub);
    const host = await connectHostWithSend(stub);
    // 部屋の DO も同じ isolate で動くので、DO の env の D1 と、グローバルの fetch を見張れる
    const spies = await runInDurableObject(stub, (instance) => {
      const db = (instance as unknown as { env: Env }).env.DB;
      return [
        vi.spyOn(db, 'prepare'),
        vi.spyOn(db, 'batch'),
        vi.spyOn(db, 'exec'),
        vi.spyOn(db, 'withSession'),
        vi.spyOn(globalThis, 'fetch'),
      ];
    });

    for (const type of [
      'showQuestion',
      'startAnswering',
      'retryQuestion',
      'startAnswering',
      'closeAnswering',
    ] as const) {
      await host.send({ type, questionIndex: 0 });
    }
    await host.send({ type: 'revealFastest', questionIndex: 0 });

    expect(await player.next()).toEqual(questionShown(1, 1));
    expect(await readRoom(stub)).toMatchObject({ phase: 'fastest' });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
