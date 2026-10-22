import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Answer, RoomPhase } from '@zubatto-quiz/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentQuestion } from '../../realtime/room-store';
import { QuestionView } from './QuestionView';

const shown: CurrentQuestion = {
  questionId: 'q-3',
  questionIndex: 2,
  text: '去年の忘年会で、部長が最初に歌った曲のジャンルは？',
  limitMs: 10_000,
  choices: null,
  remainingMs: null,
  answer: null,
  progress: null,
  revealed: null,
  myResult: null,
  fastest: null,
  standings: null,
};
const accepting: CurrentQuestion = {
  ...shown,
  choices: ['演歌', 'アニソン', '洋楽ロック', '歌っていない'],
  remainingMs: 10_000,
};

type OnAnswer = (answer: Omit<Answer, 'type'>) => boolean;

function renderView(question: CurrentQuestion, phase: RoomPhase, onAnswer = vi.fn<OnAnswer>(() => true)) {
  const view = render(
    <QuestionView question={question} phase={phase} questionCount={10} name="たろう" onAnswer={onAnswer} />,
  );
  const rerender = (next: CurrentQuestion, nextPhase: RoomPhase) =>
    view.rerender(
      <QuestionView question={next} phase={nextPhase} questionCount={10} name="たろう" onAnswer={onAnswer} />,
    );
  return { onAnswer, rerender };
}

/**
 * 時計を進める。requestAnimationFrame と performance.now() も一緒に進む。
 * 次のタイマーは描き直したあとの effect で置くので、1つの act で一気に進めず、少しずつ描き直しながら進める
 */
function advance(ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    act(() => vi.advanceTimersByTime(Math.min(100, until - performance.now())));
  }
}

/** 選択肢を描いたあとの最初のフレームまで進め、そのときの時刻（表示の瞬間）を返す */
function showChoices(): number {
  advance(16);
  return performance.now();
}

/** 表示の瞬間から ms たったところまで進める */
function advanceFrom(shownAt: number, ms: number) {
  advance(shownAt + ms - performance.now());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('出題（F8・F17）', () => {
  it('受付の前は問題文だけを出し、押せるものを出さない', () => {
    renderView(shown, 'question');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(shown.text);
    expect(screen.getByText(/第3問/)).toHaveTextContent('第3問 / 10');
    expect(screen.getByText('選択肢は、ホストが受付を始めると出ます')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('受付が始まると、問題文と選択肢と残りの秒を出す', () => {
    renderView(accepting, 'accepting');
    showChoices();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(accepting.text);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByText(/残り/)).toHaveTextContent('残り 10 秒');
  });
});

describe('回答時間の計測（P2）', () => {
  it('選択肢を表示した瞬間から押すまでを、整数のミリ秒で送る', () => {
    const { onAnswer } = renderView(accepting, 'accepting');
    const shownAt = showChoices();

    advanceFrom(shownAt, 2370);
    fireEvent.click(screen.getByRole('button', { name: /アニソン/ }));

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ questionId: 'q-3', choiceIndex: 1, elapsedMs: 2370 });
  });

  it('つなぎ直して残りが短く届いたときは、切れていたぶんも回答時間に入れる', () => {
    const { onAnswer } = renderView({ ...accepting, remainingMs: 7000 }, 'accepting');
    const shownAt = showChoices();

    expect(screen.getByText(/残り/)).toHaveTextContent('残り 7 秒');
    advanceFrom(shownAt, 1000);
    fireEvent.click(screen.getByRole('button', { name: /演歌/ }));

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ questionId: 'q-3', choiceIndex: 0, elapsedMs: 4000 });
  });

  it('残りの秒は時間とともに減る', () => {
    renderView(accepting, 'accepting');
    const shownAt = showChoices();

    advanceFrom(shownAt, 3500);

    expect(screen.getByText(/残り/)).toHaveTextContent('残り 7 秒');
  });
});

describe('1回で確定する回答（F10）', () => {
  it('押したらすぐに回答済みにし、選んだものと端末で測った時間を出す', () => {
    renderView(accepting, 'accepting');
    const shownAt = showChoices();

    advanceFrom(shownAt, 2379);
    fireEvent.click(screen.getByRole('button', { name: /アニソン/ }));

    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText('あなたの回答').closest('li')).toHaveTextContent('アニソン');
    // サーバーと同じく0.01秒単位に切り捨てて出す
    expect(screen.getByText('回答までの時間').nextElementSibling).toHaveTextContent('2.37秒');
    expect(screen.getByText('締切を待っています')).toBeInTheDocument();
  });

  it('二度押しても2回は送らない', () => {
    const { onAnswer } = renderView(accepting, 'accepting');
    showChoices();
    const [first, second] = screen.getAllByRole('button');

    fireEvent.click(first);
    fireEvent.click(first);
    fireEvent.click(second);

    expect(onAnswer).toHaveBeenCalledOnce();
  });

  it('受け付けられたら、サーバーが切り捨てた時間に置き換える', () => {
    const { rerender } = renderView(accepting, 'accepting');
    showChoices();
    fireEvent.click(screen.getByRole('button', { name: /アニソン/ }));

    rerender({ ...accepting, answer: { choiceIndex: 1, elapsedMs: 10_000 } }, 'accepting');

    expect(screen.getByText('回答までの時間').nextElementSibling).toHaveTextContent('10.00秒');
  });

  it('接続が開いていなくて送れなかったときは、押し直せる', () => {
    const onAnswer = vi.fn<OnAnswer>().mockReturnValueOnce(false).mockReturnValue(true);
    renderView(accepting, 'accepting', onAnswer);
    showChoices();

    fireEvent.click(screen.getByRole('button', { name: /演歌/ }));
    expect(screen.getAllByRole('button')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /演歌/ }));

    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('つなぎ直して、もう受け付けられた回答が届いたら、押せない', () => {
    const { onAnswer } = renderView({ ...accepting, answer: { choiceIndex: 2, elapsedMs: 1500 } }, 'accepting');
    showChoices();

    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText('あなたの回答').closest('li')).toHaveTextContent('洋楽ロック');
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('やり直しで受付の前に戻ったら、もう一度押せる', () => {
    const { onAnswer, rerender } = renderView(accepting, 'accepting');
    showChoices();
    fireEvent.click(screen.getByRole('button', { name: /演歌/ }));

    rerender(shown, 'question');
    rerender(accepting, 'accepting');
    showChoices();
    fireEvent.click(screen.getByRole('button', { name: /アニソン/ }));

    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ choiceIndex: 1 }));
  });
});

describe('締切', () => {
  it('端末の残りが0になったら、締切の知らせを待たずに押せなくする', () => {
    const { onAnswer } = renderView(accepting, 'accepting');
    const shownAt = showChoices();

    advanceFrom(shownAt, 10_000);

    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText(/残り/)).toHaveTextContent('残り 0 秒');
    expect(screen.getByText('締切になりました')).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('締切のあとは、選んだものと時間を出し、押せない', () => {
    renderView({ ...accepting, answer: { choiceIndex: 3, elapsedMs: 4210 } }, 'revealed');

    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText('あなたの回答').closest('li')).toHaveTextContent('歌っていない');
    expect(screen.getByText('回答までの時間').nextElementSibling).toHaveTextContent('4.21秒');
    expect(screen.getByText('締切になりました')).toBeInTheDocument();
  });

  it('答えずに締切になったら、印を付けずに出す', () => {
    renderView(accepting, 'fastest');

    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryByText('あなたの回答')).toBeNull();
    expect(screen.getByText('締切になりました')).toBeInTheDocument();
  });
});

describe('問題文の改行（F5）', () => {
  const multiline = { text: '部長が最初に歌った曲は？\n（去年の二次会で）' };

  // jsdom は CSS を当てないので、改行をつぶさないクラスが付いていることで確かめる。見た目は画面の確認で見る
  it.each<[RoomPhase, CurrentQuestion]>([
    ['question', { ...shown, ...multiline }],
    ['accepting', { ...accepting, ...multiline }],
    ['revealed', { ...accepting, ...multiline }],
  ])('%s のとき、問題文の改行をそのまま出す', (phase, question) => {
    renderView(question, phase);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(multiline.text);
    expect(heading).toHaveClass('whitespace-pre-line');
  });
});
