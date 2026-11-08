import type { Meta, StoryObj } from '@storybook/react-vite';

import type { CurrentQuestion } from '@/realtime/room-store';

import { AcceptingStageView } from './AcceptingStage';

const choices = ['演歌', 'アニソン', '洋楽ロック', '童謡'];

/** 受付中の今の問題。回答した人数は、部屋の DO が answerProgress で送ったものを、そのまま固定の値で書く */
const question: CurrentQuestion = {
  questionId: 'q-3',
  questionIndex: 2,
  text: '部長が最初の歓迎会で歌った曲のジャンルは？',
  limitMs: 10_000,
  choices,
  remainingMs: 10_000,
  answer: null,
  progress: { answeredCount: 12, participantCount: 18 },
  revealed: null,
  myResult: null,
  fastest: null,
  standings: null,
};

/**
 * 受付中（F9）。残りの秒と棒・回答した人数・選択肢を出す。
 * 画面では AcceptingStage が useCountdown で数えて AcceptingStageView に渡す。ストーリーでは数えず、
 * 描く側の AcceptingStageView に残り（leftMs）と棒（bar）を固定の値で渡し、棒の transitionMs は0にして止めておく。
 * 投影する進行画面なので、暗い面に置き、投影の大きさで見る
 */
const meta = {
  component: AcceptingStageView,
  args: {
    question,
    choices,
    questionCount: 10,
    participantCount: 18,
    leftMs: 6_200,
    bar: { ratio: 0.6, transitionMs: 0 },
  },
  argTypes: {
    headingRef: { control: false },
    leftMs: { control: { type: 'range', min: 0, max: 10_000, step: 100 } },
  },
  globals: { surface: 'stage', viewport: { value: 'projector', isRotated: false } },
} satisfies Meta<typeof AcceptingStageView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 4択。広い画面では2列に並べる。残りの秒は切り上げて出す（6.2秒なら7） */
export const FourChoices: Story = {};

/** 受付を始めた直後で、回答した人数がまだ届いていないとき。0人と、参加している人数を分母に出す */
export const BeforeProgress: Story = {
  args: {
    question: { ...question, progress: null },
    leftMs: 10_000,
    bar: { ratio: 1, transitionMs: 0 },
  },
};

/** 締切の間際。全員が答えると、時間を待たずに締め切る */
export const AlmostOver: Story = {
  args: {
    question: { ...question, progress: { answeredCount: 17, participantCount: 18 } },
    leftMs: 900,
    bar: { ratio: 0.09, transitionMs: 0 },
  },
};

/** 2択 */
export const TwoChoices: Story = {
  args: { question: { ...question, choices: ['○', '×'] }, choices: ['○', '×'] },
};

const longChoices = [
  '駅前の喫茶店のナポリタン（大盛り・目玉焼きのせ）',
  'Supercalifragilisticexpialidocious',
  '社食の金曜日のカレー',
  '実家から送られてくる干し柿',
];

/** 長い選択肢と、改行を入れた問題文。選択肢はどこでも折り返し、枠からはみ出さない */
export const LongText: Story = {
  args: {
    question: { ...question, text: '次のうち、\n部長の好物でないものは？', choices: longChoices },
    choices: longChoices,
  },
};
