import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { AnswerButtons } from './AnswerButtons';
import { AnswerFooter } from './AnswerFooter';
import { ChoicePlaceholder } from './ChoicePlaceholder';
import { QuestionFrame } from './QuestionFrame';

const choices = ['演歌', 'アニソン', '洋楽ロック', '童謡'];
const limitMs = 10_000;

/** 受付中のヘッダーの右。残りの秒は、画面では useCountdown の leftMs を切り上げたもの */
function Remaining({ seconds }: { seconds: number }) {
  return (
    <p className="shrink-0 font-bold">
      残り <span className="text-lead tabular-nums">{seconds}</span> 秒
    </p>
  );
}

/**
 * 回答者の出題と回答の画面の枠（F8・F10・F17）。問題の番号・問題文と、その下の中身を出す。
 * 段階で中身を出し分けるのは QuestionView の役目なので、ストーリーでは段階ごとの中身を、同じ features/player の部品で組んで渡す。
 * 残りの秒と棒は数えず、固定の値で渡す（棒の transitionMs は0にして止めておく）。
 * 回答者画面なので、暗い面に置き、スマホの幅で見る
 */
const meta = {
  component: QuestionFrame,
  args: {
    questionIndex: 2,
    questionCount: 10,
    text: '部長が最初の歓迎会で歌った曲のジャンルは？',
    aside: <Remaining seconds={7} />,
    progress: { ratio: 0.6, transitionMs: 0 },
    children: <AnswerButtons choices={choices} chosen={null} onChoose={fn()} />,
  },
  argTypes: {
    aside: { control: false },
    children: { control: false },
  },
  globals: { surface: 'stage', viewport: { value: 'mobile', isRotated: false } },
} satisfies Meta<typeof QuestionFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 受付の前。選択肢はまだ届かないので（P2）、ボタンの出る場所に点線の枠（ChoicePlaceholder）を出す。
 * ヘッダーの右には自分の名前を出し、長い名前は1行で省略する
 */
export const BeforeAccepting: Story = {
  args: {
    aside: (
      <p className="name-clip min-w-0 rounded-full bg-secondary px-3 py-1 text-note" title="経理部のやまだ はなこ">
        経理部のやまだ はなこ
      </p>
    ),
    progress: undefined,
    children: <ChoicePlaceholder />,
  },
};

/** 受付中。残りの秒と棒を出し、選択肢のボタンが画面の高さを分け合う */
export const Accepting: Story = {};

/** 受付中の2択。ボタンは高くなりすぎないよう止める */
export const AcceptingTwoChoices: Story = {
  args: { children: <AnswerButtons choices={['○', '×']} chosen={null} onChoose={fn()} /> },
};

/** 回答したあと。押した選択肢と回答までの時間を出し、締切を待つ */
export const Answered: Story = {
  args: {
    aside: <Remaining seconds={4} />,
    progress: { ratio: 0.35, transitionMs: 0 },
    children: (
      <>
        <AnswerButtons choices={choices} chosen={1} />
        <AnswerFooter answer={{ choiceIndex: 1, elapsedMs: 2_843 }} limitMs={limitMs} closed={false} />
      </>
    ),
  },
};

/** 締切のあと、締切の集計が届くまで。残りの秒と棒は消す */
export const Closed: Story = {
  args: {
    aside: undefined,
    progress: undefined,
    children: (
      <>
        <AnswerButtons choices={choices} chosen={1} />
        <AnswerFooter answer={{ choiceIndex: 1, elapsedMs: 2_843 }} limitMs={limitMs} closed />
      </>
    ),
  },
};

/** 答えないまま締切になったとき。時間は出さず、締切だけを知らせる */
export const ClosedWithoutAnswer: Story = {
  args: {
    aside: undefined,
    progress: undefined,
    children: (
      <>
        <AnswerButtons choices={choices} chosen={null} />
        <AnswerFooter answer={null} limitMs={limitMs} closed />
      </>
    ),
  },
};

/** ホストが入れた改行は、そのまま残す（whitespace-pre-line）。ほかの書式は付けない */
export const MultiLine: Story = {
  args: { text: '次のうち、\n部長の好物でないものは？' },
};
