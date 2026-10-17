import { act, render, screen, within } from '@testing-library/react';
import type { FastestRevealed, FinalRanking, RoomPhase, RoomSnapshot, Standings } from '@zubatto-quiz/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentQuestion } from '../../realtime/room-store';
import { HostStage } from './HostStage';

const TARO = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e61';
const HANAKO = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e62';

const room = (phase: RoomPhase, questionIndex: number | null = 2): RoomSnapshot => ({
  title: '内輪クイズ',
  questionCount: 5,
  phase,
  questionIndex,
});

const question = (update: Partial<CurrentQuestion> = {}): CurrentQuestion => ({
  questionId: 'q-3',
  questionIndex: 2,
  text: '部長が最初に歌った曲のジャンルは？',
  limitMs: 10_000,
  choices: null,
  remainingMs: null,
  answer: null,
  progress: null,
  revealed: null,
  myResult: null,
  fastest: null,
  standings: null,
  ...update,
});

const CHOICES = ['演歌', 'アニソン', '洋楽ロック'];

function renderStage(
  snapshot: RoomSnapshot,
  current: CurrentQuestion | null,
  { finalRanking = null, participantCount = 8 }: { finalRanking?: FinalRanking | null; participantCount?: number } = {},
) {
  return render(
    <HostStage room={snapshot} question={current} finalRanking={finalRanking} participantCount={participantCount} />,
  );
}

describe('出題と受付中（F8・F9）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('出題のあいだは、問題文と制限時間だけを出し、選択肢は出さない', () => {
    renderStage(room('question'), question());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('部長が最初に歌った曲のジャンルは？');
    expect(screen.getByText('第3問')).toBeInTheDocument();
    expect(screen.getByText('制限時間 10秒')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '選択肢' })).not.toBeInTheDocument();
  });

  it('受付中は、選択肢・残り時間・回答した人数を出す', () => {
    renderStage(
      room('accepting'),
      question({ choices: CHOICES, remainingMs: 10_000, progress: { answeredCount: 3, participantCount: 8 } }),
    );

    const choices = within(screen.getByRole('list', { name: '選択肢' })).getAllByRole('listitem');
    expect(choices.map((item) => item.textContent)).toEqual(['1演歌', '2アニソン', '3洋楽ロック']);
    expect(screen.getByText('残り').parentElement).toHaveTextContent('残り10秒');
    expect(screen.getByText('回答').parentElement).toHaveTextContent('回答 3/ 8 人');
  });

  it('まだだれも答えていなければ、参加者の数を分母にして0人と出す', () => {
    renderStage(room('accepting'), question({ choices: CHOICES, remainingMs: 10_000 }), { participantCount: 5 });

    expect(screen.getByText('回答').parentElement).toHaveTextContent('回答 0/ 5 人');
  });

  it('残り時間は1秒ごとに減る', () => {
    renderStage(room('accepting'), question({ choices: CHOICES, remainingMs: 10_000 }));

    // 最初のフレームで数え始め、その1秒あとに描き直す
    act(() => vi.advanceTimersByTime(16));
    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByText('残り').parentElement).toHaveTextContent('残り9秒');
  });
});

describe('締切のあと（F13・F14・F15）', () => {
  it('① 正解と、選択肢ごとの人数を出す', () => {
    renderStage(
      room('revealed'),
      question({
        choices: CHOICES,
        revealed: {
          type: 'revealed',
          questionId: 'q-3',
          correctIndex: 1,
          choiceCounts: [2, 5, 0],
          answeredCount: 7,
          participantCount: 8,
        },
      }),
    );

    expect(screen.getByText('締め切りました（8人中 7人が回答）')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: '回答の分布' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['1演歌2人', '2アニソン○ 正解5人', '3洋楽ロック0人']);
  });

  it('② 最速正解を、投影の大きさで出す', () => {
    const fastest: FastestRevealed = {
      type: 'fastest',
      questionId: 'q-3',
      correctIndex: 1,
      fastest: [{ participantId: TARO, name: 'たろう', elapsedMs: 840 }],
      correctCount: 5,
      answeredCount: 7,
      ranksHidden: false,
      biggestClimber: null,
    };
    renderStage(room('fastest'), question({ choices: CHOICES, fastest }));

    expect(screen.getByRole('heading', { name: '第3問の最速正解' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '最速正解の発表' })).toHaveTextContent('たろう0.84秒');
  });

  it('③ 途中経過を出す', () => {
    const standings: Standings = {
      type: 'standings',
      questionId: 'q-3',
      questionIndex: 2,
      participantCount: 8,
      entries: [
        { participantId: TARO, name: 'たろう', rank: 1, totalScore: 2980, points: 1000 },
        { participantId: HANAKO, name: 'はなこ', rank: 2, totalScore: 2845, points: 912 },
      ],
    };
    renderStage(room('standings'), question({ choices: CHOICES, standings }));

    expect(screen.getByRole('heading', { name: '途中経過（第3問まで）' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '途中経過' })).toHaveTextContent('はなこ');
  });

  it('最終ランキングを出す', () => {
    const finalRanking: FinalRanking = {
      type: 'finalRanking',
      questionCount: 5,
      entries: [{ participantId: TARO, name: 'たろう', rank: 1, totalScore: 7820 }],
    };
    renderStage(room('final', 4), null, { finalRanking });

    expect(screen.getByRole('region', { name: '優勝' })).toHaveTextContent('たろう');
  });

  it('結果がまだ届いていなければ、集計していることを出す', () => {
    renderStage(room('revealed'), question({ choices: CHOICES }));

    expect(screen.getByRole('status')).toHaveTextContent('集計しています');
  });
});
