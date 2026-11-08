import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Revealed } from '@zubatto-quiz/protocol';

import type { CurrentQuestion } from '@/realtime/room-store';

import { RevealedStage } from './RevealedStage';

/** 人数は、部屋の DO が締切のあとに数えたものを、そのまま固定の値で書く（ストーリーでは数えない） */
const revealed: Revealed = {
  type: 'revealed',
  questionId: 'q-3',
  correctIndex: 1,
  choiceCounts: [3, 12, 2, 0],
  answeredCount: 17,
  participantCount: 18,
};

const question: CurrentQuestion = {
  questionId: 'q-3',
  questionIndex: 2,
  text: '部長が最初の歓迎会で歌った曲のジャンルは？',
  limitMs: 10_000,
  choices: ['演歌', 'アニソン', '洋楽ロック', '童謡'],
  remainingMs: null,
  answer: null,
  progress: { answeredCount: 17, participantCount: 18 },
  revealed,
  myResult: null,
  fastest: null,
  standings: null,
};

/**
 * ① 正解と回答の分布（F13）。問題文を小さくして上に寄せ、その下に選択肢ごとの人数を出す。
 * 分布の見た目の違い（黄色の正解、選択肢が届いていないときなど）は AnswerDistribution のストーリーにある。
 * 投影する進行画面なので、暗い面に置き、投影の大きさで見る
 */
const meta = {
  component: RevealedStage,
  args: { question, revealed, questionCount: 10 },
  argTypes: { headingRef: { control: false } },
  globals: { surface: 'stage', viewport: { value: 'projector', isRotated: false } },
} satisfies Meta<typeof RevealedStage>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 4択。ヘッダーの右に、参加している人数と回答した人数を出す */
export const FourChoices: Story = {};

/** 改行を入れた問題文。出題・受付中と同じく、改行だけを残す */
export const MultiLine: Story = {
  args: { question: { ...question, text: '次のうち、\n部長の好物でないものは？' } },
};

/** だれも答えなかったとき。人数は0人と出し、どの棒も出さない */
export const NoAnswers: Story = {
  args: { revealed: { ...revealed, choiceCounts: [0, 0, 0, 0], answeredCount: 0 } },
};
