import { act, render, screen, waitFor, within } from '@testing-library/react';
import type {
  FastestRevealed,
  FinalRanking,
  Revealed,
  RoomPhase,
  RoomSnapshot,
  Standings,
} from '@zubatto-quiz/protocol';
import { createRef, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { liveRegion } from '../../../test/live-region';
import { Announcer } from '../../components/a11y/Announcer';
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

const REVEALED: Revealed = {
  type: 'revealed',
  questionId: 'q-3',
  correctIndex: 1,
  choiceCounts: [2, 5, 0],
  answeredCount: 7,
  participantCount: 8,
};

const FASTEST: FastestRevealed = {
  type: 'fastest',
  questionId: 'q-3',
  correctIndex: 1,
  fastest: [{ participantId: TARO, name: 'たろう', elapsedMs: 840 }],
  correctCount: 5,
  answeredCount: 7,
  ranksHidden: false,
  biggestClimber: null,
};

const STANDINGS: Standings = {
  type: 'standings',
  questionId: 'q-3',
  questionIndex: 2,
  participantCount: 8,
  entries: [
    { participantId: TARO, name: 'たろう', rank: 1, totalScore: 2980, points: 1000 },
    { participantId: HANAKO, name: 'はなこ', rank: 2, totalScore: 2845, points: 912 },
  ],
};

const FINAL_RANKING: FinalRanking = {
  type: 'finalRanking',
  questionCount: 5,
  entries: [{ participantId: TARO, name: 'たろう', rank: 1, totalScore: 7820 }],
};

function renderStage(
  snapshot: RoomSnapshot,
  current: CurrentQuestion | null,
  {
    finalRanking = null,
    participantCount = 8,
    headingRef,
  }: { finalRanking?: FinalRanking | null; participantCount?: number; headingRef?: Ref<HTMLHeadingElement> } = {},
) {
  return render(
    <HostStage
      room={snapshot}
      question={current}
      finalRanking={finalRanking}
      participantCount={participantCount}
      headingRef={headingRef}
    />,
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
        revealed: REVEALED,
      }),
    );

    expect(screen.getByText('締め切りました（8人中 7人が回答）')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: '回答の分布' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['1演歌2人', '2アニソン○ 正解5人', '3洋楽ロック0人']);
  });

  it('② 最速正解を、投影の大きさで出す', () => {
    renderStage(room('fastest'), question({ choices: CHOICES, fastest: FASTEST }));

    expect(screen.getByRole('heading', { name: '第3問の最速正解' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '最速正解の発表' })).toHaveTextContent('たろう0.84秒');
  });

  it('③ 途中経過を出す', () => {
    renderStage(room('standings'), question({ choices: CHOICES, standings: STANDINGS }));

    expect(screen.getByRole('heading', { name: '途中経過（第3問まで）' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '途中経過' })).toHaveTextContent('はなこ');
  });

  it('最終ランキングを出す', () => {
    renderStage(room('final', 4), null, { finalRanking: FINAL_RANKING });

    expect(screen.getByRole('region', { name: '優勝' })).toHaveTextContent('たろう');
  });

  it('結果がまだ届いていなければ、集計していることを出して読み上げる', async () => {
    render(<Announcer />);
    renderStage(room('revealed'), question({ choices: CHOICES }));

    expect(screen.getByText('結果を集計しています', { selector: 'p' })).toBeInTheDocument();
    await waitFor(() => expect(liveRegion('polite')).toHaveTextContent('結果を集計しています'));
    // 画面ごと現れるので role="status" を付けず、読み上げ領域に任せる
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('問題文の改行（F5）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const text = '部長が最初に歌った曲は？\n（去年の二次会で）';

  // jsdom は CSS を当てないので、改行をつぶさないクラスが付いていることで確かめる。見た目は画面の確認で見る
  it.each<[RoomPhase, CurrentQuestion]>([
    ['question', question({ text })],
    ['accepting', question({ text, choices: CHOICES, remainingMs: 10_000 })],
    [
      'revealed',
      question({
        text,
        choices: CHOICES,
        revealed: REVEALED,
      }),
    ],
  ])('%s のとき、問題文の改行をそのまま出す', (phase, current) => {
    renderStage(room(phase), current);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(text);
    expect(heading).toHaveClass('whitespace-pre-line');
  });
});

describe('見出しへのフォーカス', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const TEXT = '部長が最初に歌った曲のジャンルは？';

  // ホストが押した操作のあと、進行画面がこの ref で新しい段階の見出しへフォーカスを移す
  it.each<[RoomPhase, CurrentQuestion | null, FinalRanking | null, string]>([
    ['question', question(), null, TEXT],
    ['accepting', question({ choices: CHOICES, remainingMs: 10_000 }), null, TEXT],
    ['revealed', question({ choices: CHOICES, revealed: REVEALED }), null, TEXT],
    ['fastest', question({ choices: CHOICES, fastest: FASTEST }), null, '第3問の最速正解'],
    ['standings', question({ choices: CHOICES, standings: STANDINGS }), null, '途中経過（第3問まで）'],
    ['final', null, FINAL_RANKING, '最終ランキング'],
  ])(
    '%s のとき、見出しに ref を渡し、Tab の順番には入れずにフォーカスできるようにする',
    (phase, current, finalRanking, name) => {
      const headingRef = createRef<HTMLHeadingElement>();
      renderStage(room(phase, phase === 'final' ? 4 : 2), current, { finalRanking, headingRef });

      act(() => headingRef.current?.focus());

      const heading = screen.getByRole('heading', { name });
      expect(document.activeElement).toBe(heading);
      expect(heading).toHaveAttribute('tabindex', '-1');
    },
  );
});
