import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FinalRanking as FinalRankingMessage } from '@zubatto-quiz/protocol';

import { FinalRanking } from './FinalRanking';

const id = (n: number) => `6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e${String(n).padStart(2, '0')}`;

/**
 * 順位と合計は、部屋の DO が付けたものを、そのまま固定の値で書く（ストーリーでは数えない）。
 * 5位が2人いるので、次は7位になる。名前は長い名前・英字だけの長い名前・絵文字を混ぜる
 */
const ranking: FinalRankingMessage = {
  type: 'finalRanking',
  questionCount: 10,
  entries: [
    { participantId: id(1), name: '🎍たろう🎍', rank: 1, totalScore: 7820 },
    { participantId: id(2), name: 'はなこ', rank: 2, totalScore: 7105 },
    { participantId: id(3), name: 'ながいながいなまえのさんじゅうもじくらいあるひとです', rank: 3, totalScore: 6930 },
    { participantId: id(4), name: 'Christopher-Alexander-Montgomery', rank: 4, totalScore: 6410 },
    { participantId: id(5), name: '部長', rank: 5, totalScore: 5980 },
    { participantId: id(6), name: '経理のたなか', rank: 5, totalScore: 5980 },
    { participantId: id(7), name: 'さとう', rank: 7, totalScore: 5215 },
    { participantId: id(8), name: 'すずき', rank: 8, totalScore: 4870 },
    { participantId: id(9), name: 'やまだ', rank: 9, totalScore: 4105 },
    { participantId: id(10), name: 'いとう', rank: 10, totalScore: 3560 },
    { participantId: id(11), name: 'わたなべ', rank: 11, totalScore: 2240 },
  ],
};

/** 1位が同点のとき。2人とも優勝の箱に入り、次は3位になる */
const tiedWinners: FinalRankingMessage = {
  type: 'finalRanking',
  questionCount: 5,
  entries: [
    { participantId: id(1), name: 'たろう', rank: 1, totalScore: 4200 },
    { participantId: id(2), name: 'はなこ', rank: 1, totalScore: 4200 },
    { participantId: id(3), name: '部長', rank: 3, totalScore: 3650 },
    { participantId: id(4), name: 'さとう', rank: 4, totalScore: 2980 },
  ],
};

/**
 * 最終ランキング（F15）。優勝（1位が同点なら全員）だけを spotlight の色にし、全員の順位を出す。
 * 進行画面（投影）と回答者画面で使い、どちらも暗い面に置く。回答者画面では meId を渡し、どの順位にいても自分を強調する
 */
const meta = {
  component: FinalRanking,
  args: { ranking, variant: 'projector' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['projector', 'mobile'] },
    headingRef: { control: false },
  },
  globals: { surface: 'stage' },
} satisfies Meta<typeof FinalRanking>;

export default meta;

type Story = StoryObj<typeof meta>;

const projector = { viewport: { value: 'projector', isRotated: false } };
const mobile = { viewport: { value: 'mobile', isRotated: false } };

/** 進行画面（投影）。優勝の箱と2位・3位を横に並べ、4位から下は2列に流す */
export const Projector: Story = {
  globals: projector,
};

/** 進行画面で、1位が同点のとき */
export const ProjectorTiedWinners: Story = {
  args: { ranking: tiedWinners },
  globals: projector,
};

/** 参加者がいなかったとき。優勝の箱を出さない */
export const ProjectorNoPlayers: Story = {
  args: { ranking: { type: 'finalRanking', questionCount: 10, entries: [] } },
  globals: projector,
};

/** 回答者画面で、自分が4位から下にいるとき。同点の5位の行を強調する */
export const MobileMe: Story = {
  args: { variant: 'mobile', meId: id(6) },
  globals: mobile,
};

/** 回答者画面で、自分が2位のとき。札の色を変える */
export const MobileMePodium: Story = {
  args: { variant: 'mobile', meId: id(2) },
  globals: mobile,
};

/** 回答者画面で、自分が優勝したとき。優勝の箱の名前に「あなた」を付ける */
export const MobileMeWinner: Story = {
  args: { variant: 'mobile', meId: id(1) },
  globals: mobile,
};

/** 回答者画面で、1位が同点のとき */
export const MobileTiedWinners: Story = {
  args: { variant: 'mobile', ranking: tiedWinners, meId: id(2) },
  globals: mobile,
};
