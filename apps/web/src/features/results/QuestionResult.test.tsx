import { render, screen } from '@testing-library/react';
import type { MyResult } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { QuestionResult } from './QuestionResult';

const choices = ['演歌', 'アニソン', '洋楽ロック', '歌っていない'];

const correct: MyResult = {
  type: 'myResult',
  questionId: 'q-3',
  correctIndex: 1,
  answer: { choiceIndex: 1, elapsedMs: 2370 },
  correct: true,
  points: 843,
  bonusPoints: 0,
  totalScore: 2410,
  remainingMaxPoints: 8400,
  position: { kind: 'podium', rank: 3, rankUp: 2, gapToAbove: 435 },
};

describe('① 回答者の結果', () => {
  it('正解したら、正解の選択肢・得点・かかった秒数を出す', () => {
    const { container } = render(<QuestionResult result={correct} choices={choices} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('○ 正解');
    expect(container).toHaveTextContent('2 アニソン');
    expect(container).toHaveTextContent('+843点');
    expect(container).toHaveTextContent('2.37秒で正解');
  });

  it('早押しボーナスをもらえたら、その点を印で出す（F12）', () => {
    const quick: MyResult = { ...correct, answer: { choiceIndex: 1, elapsedMs: 820 }, points: 1159, bonusPoints: 200 };
    const { container } = render(<QuestionResult result={quick} choices={choices} />);

    expect(container).toHaveTextContent('+1,159点');
    expect(screen.getByText('早押しボーナス')).toBeInTheDocument();
    expect(container).toHaveTextContent('早押しボーナス +200点');
  });

  it('早押しボーナスをもらえなかったら、印を出さない', () => {
    render(<QuestionResult result={correct} choices={choices} />);

    expect(screen.queryByText('早押しボーナス')).toBeNull();
  });

  it('不正解なら、正解と自分の回答を出し、得点は0点', () => {
    const wrong: MyResult = { ...correct, answer: { choiceIndex: 0, elapsedMs: 1200 }, correct: false, points: 0 };
    const { container } = render(<QuestionResult result={wrong} choices={choices} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('× 不正解');
    expect(container).toHaveTextContent('正解は 2 アニソン');
    expect(container).toHaveTextContent('あなたの回答: 1 演歌');
    expect(container).toHaveTextContent('+0点');
    expect(container).not.toHaveTextContent('秒で正解');
  });

  it('答えずに締切になったら、時間切れと出す', () => {
    const timeout: MyResult = { ...correct, answer: null, correct: false, points: 0 };
    const { container } = render(<QuestionResult result={timeout} choices={choices} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('時間切れ');
    expect(container).toHaveTextContent('正解は 2 アニソン');
    expect(container).not.toHaveTextContent('あなたの回答');
  });

  it('秒数は0.01秒単位で、四捨五入せずに出す', () => {
    const { container } = render(
      <QuestionResult result={{ ...correct, answer: { choiceIndex: 1, elapsedMs: 1000 } }} choices={choices} />,
    );

    expect(container).toHaveTextContent('1.00秒で正解');
  });

  it('選択肢が届いていなくても、正解の番号は出す', () => {
    const timeout: MyResult = { ...correct, answer: null, correct: false, points: 0 };
    const { container } = render(<QuestionResult result={timeout} choices={null} />);

    expect(container).toHaveTextContent('正解は 2');
  });

  it('style 属性を使わず、Tailwind のクラスだけで書く', () => {
    const { container } = render(<QuestionResult result={{ ...correct, bonusPoints: 200 }} choices={choices} />);

    expect(container.querySelector('[style]')).toBeNull();
  });
});
