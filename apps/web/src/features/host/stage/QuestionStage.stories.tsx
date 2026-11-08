import type { Meta, StoryObj } from '@storybook/react-vite';

import type { CurrentQuestion } from '@/realtime/room-store';

import { QuestionStage } from './QuestionStage';

/** 出題のあいだの今の問題。選択肢はまだ届いていない（P2） */
const question: CurrentQuestion = {
  questionId: 'q-3',
  questionIndex: 2,
  text: '部長が最初の歓迎会で歌った曲のジャンルは？',
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

/**
 * 出題（F8）。ホストが読み上げるあいだ、問題文だけを大きく出し、選択肢はまだ出さない。
 * 投影する進行画面なので、暗い面に置き、投影の大きさで見る
 */
const meta = {
  component: QuestionStage,
  args: { question, questionCount: 10 },
  argTypes: { headingRef: { control: false } },
  globals: { surface: 'stage', viewport: { value: 'projector', isRotated: false } },
} satisfies Meta<typeof QuestionStage>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 問題の番号と制限時間を上に、問題文を真ん中に出す */
export const Default: Story = {};

/** ホストが入れた改行は、そのまま残す（whitespace-pre-line）。ほかの書式は付けない */
export const MultiLine: Story = {
  args: { question: { ...question, text: '次のうち、\n部長の好物でないものは？' } },
};

/** 長い問題文。24文字ほどの幅で折り返す */
export const LongText: Story = {
  args: {
    question: {
      ...question,
      text: '去年の社員旅行で、最後まで宿に戻らなかった3人が、夜中に見つけて写真を撮ってきたものは何だったでしょう？',
    },
  },
};

/** 最後の問題。制限時間は問題ごとに違う */
export const LastQuestion: Story = {
  args: { question: { ...question, questionId: 'q-10', questionIndex: 9, limitMs: 20_000 } },
};
