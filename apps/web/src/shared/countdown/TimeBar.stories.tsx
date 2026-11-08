import type { Meta, StoryObj } from '@storybook/react-vite';

import { TimeBar } from './TimeBar';

/**
 * 残り時間の棒。進行画面（投影）と回答者画面で使い、どちらも暗い面に置く。
 * 画面では useCountdown の bar を渡し、棒は次の描き直しまでの時間をかけて縮む。
 * ストーリーでは数えないので、残りの割合を決めて渡し、transitionMs は0にして止めておく
 */
const meta = {
  component: TimeBar,
  args: { variant: 'projector', ratio: 0.6, transitionMs: 0 },
  argTypes: {
    variant: { control: 'inline-radio', options: ['projector', 'mobile'] },
    ratio: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
  },
  globals: { surface: 'stage' },
} satisfies Meta<typeof TimeBar>;

export default meta;

type Story = StoryObj<typeof meta>;

const projector = { viewport: { value: 'projector', isRotated: false } };
const mobile = { viewport: { value: 'mobile', isRotated: false } };

/** 進行画面（投影）。離れた席から見えるよう、太くする */
export const Projector: Story = {
  globals: projector,
};

/** 締切の間際 */
export const ProjectorAlmostOver: Story = {
  args: { ratio: 0.1 },
  globals: projector,
};

/** 締切を過ぎたとき。負の割合が届いても、棒は0で止まる */
export const ProjectorOver: Story = {
  args: { ratio: -0.05 },
  globals: projector,
};

/** 回答者画面。問題の番号の下に細く出す */
export const Mobile: Story = {
  args: { variant: 'mobile' },
  globals: mobile,
};

/** 回答者画面の、締切の間際 */
export const MobileAlmostOver: Story = {
  args: { variant: 'mobile', ratio: 0.1 },
  globals: mobile,
};
