import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Standings } from '@zubatto-quiz/protocol';

import { StandingsRanking } from './StandingsRanking';

const id = (n: number) => `6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e${String(n).padStart(2, '0')}`;

/**
 * 順位と点は、部屋の DO が締切のあとに付けたものを、そのまま固定の値で書く（ストーリーでは数えない）。
 * 同点は同じ順位で、同じ順位の人は入室した順に並んで届く。名前は長い名前・英字だけの長い名前・絵文字を混ぜる
 */
const standings: Standings = {
  type: 'standings',
  questionId: 'q-3',
  questionIndex: 2,
  participantCount: 18,
  entries: [
    { participantId: id(1), name: '🎍たろう🎍', rank: 1, totalScore: 2980, points: 1000 },
    { participantId: id(2), name: 'はなこ', rank: 2, totalScore: 2845, points: 912 },
    {
      participantId: id(3),
      name: 'ながいながいなまえのさんじゅうもじくらいあるひとです',
      rank: 2,
      totalScore: 2845,
      points: 843,
    },
    { participantId: id(4), name: 'Christopher-Alexander-Montgomery', rank: 4, totalScore: 2410, points: 1120 },
    { participantId: id(5), name: '部長', rank: 5, totalScore: 2205, points: 0 },
    { participantId: id(6), name: '経理のたなか', rank: 6, totalScore: 1980, points: 640 },
    { participantId: id(7), name: 'さとう', rank: 7, totalScore: 1815, points: 0 },
    { participantId: id(8), name: 'すずき', rank: 8, totalScore: 1760, points: 705 },
    {
      participantId: id(9),
      name: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}かぞく',
      rank: 9,
      totalScore: 1520,
      points: 588,
    },
    { participantId: id(10), name: 'やまだ', rank: 10, totalScore: 1205, points: 0 },
  ],
};

/**
 * ③ 途中経過（F15）。上位10人を、この問題の点と合計で出す。進行画面（投影）と回答者画面で使い、どちらも暗い面に置く。
 * 回答者画面では meId を渡し、上位に入っていれば自分の行だけを強調する。この問題で0点の人は、点を薄く出す
 */
const meta = {
  component: StandingsRanking,
  args: { standings, variant: 'projector' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['projector', 'mobile'] },
    headingRef: { control: false },
  },
  globals: { surface: 'stage' },
} satisfies Meta<typeof StandingsRanking>;

export default meta;

type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile', isRotated: false } };

/** 進行画面（投影）。2位が2人いるので、次は4位になる */
export const Projector: Story = {
  globals: { viewport: { value: 'projector', isRotated: false } },
};

/** 回答者画面で、自分が上位10人に入っているとき。自分の行の色を変え、「あなた」を付ける */
export const MobileMe: Story = {
  args: { variant: 'mobile', meId: id(5) },
  globals: mobile,
};

/** 回答者画面で、自分が上位10人に入っていないとき。どの行も強調しない */
export const MobileNotRanked: Story = {
  args: { variant: 'mobile', meId: id(18) },
  globals: mobile,
};

/** 参加者が少なく、上位が10人に満たないとき。「上位3人 / 3人」と出す */
export const MobileFewPlayers: Story = {
  args: {
    variant: 'mobile',
    meId: id(2),
    standings: { ...standings, participantCount: 3, entries: standings.entries.slice(0, 3) },
  },
  globals: mobile,
};
