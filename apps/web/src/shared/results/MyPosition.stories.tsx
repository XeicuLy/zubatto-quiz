import type { Meta, StoryObj } from '@storybook/react-vite';

import { MyPosition } from './MyPosition';

/**
 * 回答者画面の自分の位置（F15・docs/design/README.md の「順位の見せ方」）。順位よりも「次の目標」を見せる。
 * 位置と差と残りの最大の点は、部屋の DO が myResult で送ったものを、そのまま固定の値で書く（ストーリーでは数えない）。
 * 回答者画面でだけ使うので、暗い面に置き、スマホの幅で見る
 */
const meta = {
  component: MyPosition,
  args: {
    position: { kind: 'chasing', rankUp: 0, gapToAbove: 224, gapToTop: 1530 },
    totalScore: 3450,
    remainingMaxPoints: 8400,
    remainingQuestions: 7,
  },
  globals: { surface: 'stage', viewport: { value: 'mobile', isRotated: false } },
} satisfies Meta<typeof MyPosition>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 4位から下。順位の数字は出さず、1つ上の人との差・トップとの差・残りで取れる最大の点を出す */
export const Chasing: Story = {};

/** 4位から下で、この問題で順位が上がったとき。上がった幅を ▲ で出す（下がったときは何も出さない） */
export const ChasingRankUp: Story = {
  args: { position: { kind: 'chasing', rankUp: 5, gapToAbove: 85, gapToTop: 980 } },
};

/** 2位・3位。順位の数字と、1つ上の人との差を出す */
export const Podium: Story = {
  args: {
    position: { kind: 'podium', rank: 2, rankUp: 1, gapToAbove: 435 },
    totalScore: 4545,
  },
};

/** 1位。2位との差を出す */
export const Leader: Story = {
  args: {
    position: { kind: 'leader', rankUp: 0, leadOverNext: 135 },
    totalScore: 4980,
  },
};

/** 1位で、ほかに回答者がいないとき。比べる相手がいないので、差を出さない */
export const LeaderAlone: Story = {
  args: {
    position: { kind: 'leader', rankUp: 0, leadOverNext: null },
    totalScore: 4980,
  },
};

/** 最後の2問。順位にかかわることは出さず、伏せていることと残りで取れる最大の点だけを出す */
export const Hidden: Story = {
  args: {
    position: { kind: 'hidden' },
    remainingMaxPoints: 1200,
    remainingQuestions: 1,
  },
};

/** 最後の問題のあと。残りの問題がないので、残りで取れる最大の点を出さない */
export const HiddenLastQuestion: Story = {
  args: {
    position: { kind: 'hidden' },
    remainingMaxPoints: 0,
    remainingQuestions: 0,
  },
};
