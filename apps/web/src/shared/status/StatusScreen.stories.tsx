import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatusScreen } from './StatusScreen';

/**
 * 部屋の様子や結果が届くまでのつなぎの画面。進行画面（投影）と回答者画面で使い、どちらも暗い面に置く。
 * 画面ごと現れるので role="status" は付けず、文を読み上げ領域に渡す
 */
const meta = {
  component: StatusScreen,
  argTypes: {
    variant: { control: 'inline-radio', options: ['projector', 'mobile'] },
  },
  globals: { surface: 'stage' },
} satisfies Meta<typeof StatusScreen>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 進行画面（投影）。文字は画面の幅で伸び、下に操作の帯が並ぶので、残りの高さを埋める */
export const Projector: Story = {
  args: { variant: 'projector', children: '結果を集計しています' },
  globals: { viewport: { value: 'projector', isRotated: false } },
};

/** 回答者画面。1枚の画面なので、画面の高さの真ん中に出す */
export const Mobile: Story = {
  args: { variant: 'mobile', children: '部屋に入っています…' },
  globals: { viewport: { value: 'mobile', isRotated: false } },
};
