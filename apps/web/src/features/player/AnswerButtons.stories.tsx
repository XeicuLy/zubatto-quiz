import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { AnswerButtons } from './AnswerButtons';

/**
 * 選択肢の早押しパネル（F10・F17）。色だけに頼らず、番号と一緒に出す。
 * onChoose を渡すと押せるボタン、渡さないと押せない一覧（回答済み・締切のあと）になる。
 * 一覧へフォーカスを移す focusList は、押した直後の画面の振る舞いなので、ストーリーでは渡さない（部品のテストが確かめる）。
 * 回答者画面でだけ使うので、暗い面に置き、スマホの幅で見る
 */
const meta = {
  component: AnswerButtons,
  args: { choices: ['演歌', 'アニソン', '洋楽ロック', '童謡'], chosen: null, onChoose: fn() },
  argTypes: {
    chosen: { control: 'inline-radio', options: [null, 0, 1, 2, 3] },
    focusList: { control: false },
  },
  globals: { surface: 'stage', viewport: { value: 'mobile', isRotated: false } },
} satisfies Meta<typeof AnswerButtons>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受付中の4択。押すと沈む。黄色（4番）だけ、文字を暗い色にする */
export const FourChoices: Story = {};

/** 2択。画面の高さを分け合う並びは、QuestionFrame の Accepting で見る */
export const TwoChoices: Story = {
  args: { choices: ['○', '×'] },
};

/** 長い選択肢。どこでも折り返し、ボタンからはみ出さない */
export const LongChoices: Story = {
  args: {
    choices: [
      '駅前の喫茶店のナポリタン（大盛り・目玉焼きのせ）',
      'Supercalifragilisticexpialidocious',
      '社食の金曜日のカレー',
      '実家から送られてくる干し柿',
    ],
  },
};

/** 回答済み。選んだものだけ色と枠で残し、「あなたの回答」と出す。ほかは薄くする */
export const Answered: Story = {
  args: { chosen: 1, onChoose: undefined },
};

/** 黄色（4番）を選んだとき。選んだ項目の文字は暗い色のまま */
export const AnsweredYellow: Story = {
  args: { chosen: 3, onChoose: undefined },
};

/** 答えないまま締切になったとき。どれも薄くし、一覧の名前は「選択肢」にする */
export const ClosedWithoutAnswer: Story = {
  args: { onChoose: undefined },
};
