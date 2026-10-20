import { render, screen, within } from '@testing-library/react';
import type { Revealed } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { AnswerDistribution } from './AnswerDistribution';

const choices = ['演歌', 'アニソン', '洋楽ロック', '歌っていない'];

const revealed: Revealed = {
  type: 'revealed',
  questionId: 'q-3',
  correctIndex: 1,
  choiceCounts: [1, 3, 0, 0],
  answeredCount: 4,
  participantCount: 6,
};

function rows() {
  return within(screen.getByRole('list', { name: '回答の分布' })).getAllByRole('listitem');
}

/** 人数を表す棒。読み上げには数字があるので、棒は飾りとして隠してある */
const barOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[aria-hidden="true"]');

describe('① 回答の分布（F13）', () => {
  it('選択肢の並びで、番号・選択肢・人数を出す。だれも選ばなかった選択肢も0人と出す', () => {
    render(<AnswerDistribution revealed={revealed} choices={choices} />);

    expect(rows().map((row) => row.textContent)).toEqual([
      '1演歌1人',
      '2アニソン○ 正解3人',
      '3洋楽ロック0人',
      '4歌っていない0人',
    ]);
  });

  it('正解の選択肢にだけ「○ 正解」を出す', () => {
    render(<AnswerDistribution revealed={{ ...revealed, correctIndex: 3 }} choices={choices} />);

    expect(rows().map((row) => row.textContent?.includes('○ 正解'))).toEqual([false, false, false, true]);
  });

  it('棒の長さは、回答した人のうち、その選択肢を選んだ人の割合', () => {
    render(<AnswerDistribution revealed={revealed} choices={choices} />);

    expect(rows().map((row) => barOf(row)?.style.width)).toEqual(['25%', '75%', '0%', '0%']);
  });

  it('だれも答えなかったら、どの棒も長さ0で、人数は0人と出す', () => {
    render(
      <AnswerDistribution revealed={{ ...revealed, choiceCounts: [0, 0, 0, 0], answeredCount: 0 }} choices={choices} />,
    );

    for (const row of rows()) {
      expect(barOf(row)).toHaveStyle({ width: '0%' });
      expect(row).toHaveTextContent(/0人$/);
    }
  });

  it('選択肢が届いていなくても、番号と人数は出す', () => {
    render(<AnswerDistribution revealed={revealed} choices={null} />);

    expect(rows().map((row) => row.textContent)).toEqual(['11人', '2○ 正解3人', '30人', '40人']);
  });
});
