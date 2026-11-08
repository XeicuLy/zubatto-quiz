import type { Meta, StoryObj } from '@storybook/react-vite';

import { Field, Input, Textarea } from './field';

/**
 * ラベル・入力欄・ヒント・誤りのまとまり。入力欄（Input か Textarea）を中に置くと、id と aria-* が自動でつながる。
 * 誤りがあるあいだは、ヒントのかわりに誤りを出し、入力欄の枠を destructive の色にする
 */
const meta = {
  component: Field,
  args: {
    label: '問題セットの名前',
    children: <Input defaultValue="年末の社内クイズ" />,
  },
  argTypes: {
    children: { control: false },
  },
} satisfies Meta<typeof Field>;

export default meta;

type Story = StoryObj<typeof meta>;

/** ラベルと入力欄だけ */
export const Default: Story = {};

/** 何を入れるかの補足を、入力欄の下に出す */
export const WithHint: Story = {
  args: {
    label: '制限時間',
    hint: '受付を始めてからの時間',
    children: <Input type="number" defaultValue={10} />,
  },
};

/** 入れたものの誤り。ヒントを渡していても、誤りに置き換わる */
export const WithError: Story = {
  args: {
    label: '制限時間',
    hint: '受付を始めてからの時間',
    error: '制限時間は5〜60秒の整数で入れてください',
    children: <Input type="number" defaultValue={90} />,
  },
};

/** 複数行の入力欄。打った行の分だけ高くなる */
export const WithTextarea: Story = {
  args: {
    label: '問題文',
    children: <Textarea rows={2} defaultValue={'日本でいちばん高い山は？\n（標高で比べます）'} />,
  },
};

/** 回答者画面の名前の入力。暗い面に置き、スマホの幅で見る */
export const PlayerName: Story = {
  args: {
    label: '名前',
    hint: 'ランキングに出る名前です。同じ部屋の人とかぶらない名前にしてください。',
    children: <Input placeholder="例: たろう" />,
  },
  globals: { surface: 'stage', viewport: { value: 'mobile', isRotated: false } },
};

/** 回答者画面で、名前が同じ部屋の人とかぶったとき */
export const PlayerNameTaken: Story = {
  args: {
    ...PlayerName.args,
    error: '「たろう」はこの部屋でもう使われています。別の名前を入れてください。',
    children: <Input defaultValue="たろう" />,
  },
  globals: PlayerName.globals,
};
