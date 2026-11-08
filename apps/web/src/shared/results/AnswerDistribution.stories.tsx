import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Revealed } from '@zubatto-quiz/protocol';

import { AnswerDistribution } from './AnswerDistribution';

/** 人数は、部屋の DO が締切のあとに数えたものを、そのまま固定の値で書く（ストーリーでは数えない） */
const revealed: Revealed = {
  type: 'revealed',
  questionId: 'q-4',
  correctIndex: 1,
  choiceCounts: [3, 12, 2, 0],
  answeredCount: 17,
  participantCount: 18,
};

/**
 * ① 回答の分布（F13）。正解だけ色を残し、ほかは沈める。人数は棒の長さと数字の両方で出す。
 * 投影する進行画面でだけ使うので、暗い面に置き、投影の大きさで見る
 */
const meta = {
  component: AnswerDistribution,
  args: { revealed, choices: ['富士山', '北岳', '奥穂高岳', '間ノ岳'] },
  globals: { surface: 'stage', viewport: { value: 'projector', isRotated: false } },
} satisfies Meta<typeof AnswerDistribution>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 4択。だれも選ばなかった選択肢は、棒を出さず0人と出す */
export const FourChoices: Story = {};

/** 黄色（4番）が正解のとき。黄色の上だけ、文字を暗い色にする */
export const YellowCorrect: Story = {
  args: { revealed: { ...revealed, correctIndex: 3, choiceCounts: [2, 4, 1, 10] } },
};

/** 2択 */
export const TwoChoices: Story = {
  args: {
    revealed: { ...revealed, correctIndex: 0, choiceCounts: [11, 6] },
    choices: ['○', '×'],
  },
};

/** だれも答えなかったとき。どの棒も出さない */
export const NoAnswers: Story = {
  args: { revealed: { ...revealed, choiceCounts: [0, 0, 0, 0], answeredCount: 0 } },
};

/** 選択肢が届いていないとき。番号だけを出す */
export const WithoutChoices: Story = {
  args: { choices: null },
};
