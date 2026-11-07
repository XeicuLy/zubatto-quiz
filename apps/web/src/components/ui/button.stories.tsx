import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';

/**
 * ボタン。variant は役割（いちばん押してほしい操作か、戻せない操作か）で選び、面では選ばない。
 * どの variant も、ツールバーの「面」で明るい面と暗い面を切り替えて見られる。決まりは docs/architecture/frontend.md の UI の部品
 */
const meta = {
  component: Button,
  args: { children: '部屋を作る' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'outline', 'destructive', 'link'] },
    size: { control: 'inline-radio', options: ['sm', 'default', 'lg', 'stage'] },
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/** その画面でいちばん押してほしい操作。size="lg" のときだけ、早押しパネルの厚みが付く */
export const Default: Story = {};

/** 主の操作と並ぶ、別の操作 */
export const Outline: Story = {
  args: { variant: 'outline', children: 'URL をコピー' },
};

/** 消すなど、戻せない操作 */
export const Destructive: Story = {
  args: { variant: 'destructive', children: '消す' },
};

/** 目立たせない操作 */
export const Link: Story = {
  args: { variant: 'link', size: 'sm', children: '問題セットの一覧に戻る' },
};

/** 押せないあいだ。薄くし、押しても何も起きない */
export const Disabled: Story = {
  args: { disabled: true },
};

/** プロジェクターに映す画面だけで使う大きさ。文字が画面の幅で伸びるので、暗い面で見る */
export const Stage: Story = {
  args: { variant: 'outline', size: 'stage', children: 'URL をコピー' },
  globals: { surface: 'stage' },
};
