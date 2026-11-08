import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from './card';

/**
 * ひとまとまりの知らせや内容を囲む面。中身の見出しや文は画面が書き、Card は枠と背景だけを持つ。
 * role（誤りの知らせなら role="alert"）も画面が渡す。決まりは docs/architecture/frontend.md の UI の部品
 */
const meta = {
  component: Card,
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'destructive'] },
    children: { control: false },
  },
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

/** ふつうの内容 */
export const Default: Story = {
  args: {
    children: (
      <>
        <p className="font-bold">年末の社内クイズ</p>
        <p className="mt-2 text-note text-muted-foreground">10問・作成 2026-11-01</p>
      </>
    ),
  },
};

/** 誤りの知らせ。枠を destructive の色にし、画面が role="alert" を付ける（ログイン画面で、ログインできなかったとき） */
export const Destructive: Story = {
  args: {
    variant: 'destructive',
    role: 'alert',
    children: (
      <>
        <p className="font-bold text-destructive">ログインできませんでした</p>
        <p className="mt-2 text-body">少し待ってから、もう一度ログインしてください。</p>
      </>
    ),
  },
};
