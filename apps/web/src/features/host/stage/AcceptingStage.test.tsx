import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CurrentQuestion } from '@/realtime/room-store';

import { AcceptingStageView, type AcceptingStageViewProps } from './AcceptingStage';

const CHOICES = ['演歌', 'アニソン', '洋楽ロック'];

const question = (update: Partial<CurrentQuestion> = {}): CurrentQuestion => ({
  questionId: 'q-3',
  questionIndex: 2,
  text: '部長が最初に歌った曲のジャンルは？',
  limitMs: 10_000,
  choices: CHOICES,
  remainingMs: 10_000,
  answer: null,
  progress: null,
  revealed: null,
  myResult: null,
  fastest: null,
  standings: null,
  ...update,
});

function renderView(update: Partial<AcceptingStageViewProps> = {}) {
  return render(
    <AcceptingStageView
      question={question()}
      choices={CHOICES}
      questionCount={5}
      participantCount={8}
      leftMs={10_000}
      bar={{ ratio: 1, transitionMs: 0 }}
      {...update}
    />,
  );
}

// 数える部分（useCountdown）は外側の AcceptingStage にあり、HostStage.test.tsx が時計を進めて確かめる。
// ここでは、渡した残りと人数をそのまま描くことだけを見る
describe('受付中の表示', () => {
  it('残りは秒に切り上げて出す', () => {
    renderView({ leftMs: 3_200 });

    expect(screen.getByText('残り').parentElement).toHaveTextContent('残り4秒');
  });

  it('渡した棒の割合で描く', () => {
    const { container } = renderView({ bar: { ratio: 0.25, transitionMs: 400 } });

    expect(container.querySelector('[aria-hidden="true"] > *')).toHaveStyle({ width: '25%' });
  });

  it('回答の途中経過が届いたら、その分母を使う', () => {
    renderView({
      question: question({ progress: { answeredCount: 6, participantCount: 7 } }),
      participantCount: 8,
    });

    expect(screen.getByText('回答').parentElement).toHaveTextContent('回答 6/ 7 人');
  });
});
