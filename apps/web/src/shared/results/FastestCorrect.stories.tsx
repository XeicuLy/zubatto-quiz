import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FastestRevealed } from '@zubatto-quiz/protocol';

import { FastestCorrect } from './FastestCorrect';

const id = (n: number) => `6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e${String(n).padStart(2, '0')}`;

/**
 * 並びと秒数は、部屋の DO が決めたものを、そのまま固定の値で書く（ストーリーでは数えない）。
 * 秒数は0.01秒単位に切り捨て済みの値（10 ms 刻み）にする
 */
const fastest: FastestRevealed = {
  type: 'fastest',
  questionId: 'q-4',
  correctIndex: 1,
  fastest: [
    { participantId: id(1), name: 'はなこ', elapsedMs: 1230 },
    { participantId: id(2), name: '🎍たろう🎍', elapsedMs: 1480 },
    { participantId: id(3), name: '部長', elapsedMs: 2050 },
  ],
  correctCount: 12,
  answeredCount: 17,
  ranksHidden: false,
  biggestClimber: { participantId: id(4), name: '経理のたなか', rankUp: 5 },
};

/** 正解者がいなかったとき。spotlight の色を使わない */
const noCorrect: FastestRevealed = {
  ...fastest,
  fastest: [],
  correctCount: 0,
  biggestClimber: null,
};

/** 最後の2問。一番順位を上げた人を持たず、順位を伏せていることを出す */
const ranksHidden: FastestRevealed = {
  type: 'fastest',
  questionId: 'q-9',
  correctIndex: 1,
  fastest: fastest.fastest,
  correctCount: 12,
  answeredCount: 17,
  ranksHidden: true,
};

/**
 * ② 最速正解の発表（F14）。最速の3人と秒数・正解した人数・この問題で一番順位を上げた人を出す。
 * 進行画面（投影）では画面いっぱいの見せ場にし、回答者画面では ① の結果の下に小さな枠で出す。どちらも暗い面に置く
 */
const meta = {
  component: FastestCorrect,
  args: {
    fastest,
    questionIndex: 3,
    choices: ['富士山', '北岳', '奥穂高岳', '間ノ岳'],
    variant: 'projector',
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['projector', 'mobile'] },
    headingRef: { control: false },
  },
  globals: { surface: 'stage' },
} satisfies Meta<typeof FastestCorrect>;

export default meta;

type Story = StoryObj<typeof meta>;

const projector = { viewport: { value: 'projector', isRotated: false } };
const mobile = { viewport: { value: 'mobile', isRotated: false } };

/** 進行画面（投影）。最速の人を大きく出し、2・3番目と順位を上げた人を下に並べる */
export const Projector: Story = {
  globals: projector,
};

/** 最速の人の名前が長いとき（13文字以上）。1段小さくして、3行以上に割れないようにする */
export const ProjectorLongName: Story = {
  args: {
    fastest: {
      ...fastest,
      fastest: [
        { participantId: id(5), name: 'ながいながいなまえのさんじゅうもじくらいあるひとです', elapsedMs: 980 },
        ...fastest.fastest.slice(0, 2),
      ],
    },
  },
  globals: projector,
};

/** 第1問。順位の変化がないので、一番順位を上げた人を出さない */
export const ProjectorFirstQuestion: Story = {
  args: { questionIndex: 0, fastest: { ...fastest, questionId: 'q-1', biggestClimber: null } },
  globals: projector,
};

/** 正解者がいなかったとき */
export const ProjectorNoCorrect: Story = {
  args: { fastest: noCorrect },
  globals: projector,
};

/** 最後の2問。順位を上げた人のかわりに、順位を伏せていることを出す */
export const ProjectorRanksHidden: Story = {
  args: { questionIndex: 8, fastest: ranksHidden },
  globals: projector,
};

/** 回答者画面。① の結果の下に出す小さな枠 */
export const Mobile: Story = {
  args: { variant: 'mobile' },
  globals: mobile,
};

/** 回答者画面で、正解者がいなかったとき */
export const MobileNoCorrect: Story = {
  args: { variant: 'mobile', fastest: noCorrect },
  globals: mobile,
};

/** 回答者画面の、最後の2問。一番順位を上げた人を出さない */
export const MobileRanksHidden: Story = {
  args: { variant: 'mobile', questionIndex: 8, fastest: ranksHidden },
  globals: mobile,
};
