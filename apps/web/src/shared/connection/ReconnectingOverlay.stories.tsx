import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '@/components/ui/button';

import { ReconnectingOverlay } from './ReconnectingOverlay';

/**
 * つなぎ直しているあいだの重ね表示。中身を薄くして押せなくし、上に回る印と文の帯を重ねる。
 * 文は呼ぶ側（ConnectionNotice・HostConnectionNotice）が渡し、読み上げも呼ぶ側の useConnectionAnnouncement が持つ。
 * どちらの画面も暗い面に置くので、ストーリーも暗い面で見る。回る印は、動きを減らす設定では止まる
 */
const meta = {
  component: ReconnectingOverlay,
  argTypes: {
    variant: { control: 'inline-radio', options: ['projector', 'mobile'] },
    children: { control: false },
  },
} satisfies Meta<typeof ReconnectingOverlay>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 回答者画面。中身と同じ max-w-md の列に帯を収める。390 px の幅で見る */
export const Mobile: Story = {
  args: {
    variant: 'mobile',
    message: '接続が切れました。つなぎ直しています',
    children: (
      <div className="mx-auto grid max-w-md grid-cols-1 gap-4 px-5 pt-24 pb-6">
        <p className="text-title font-bold">日本でいちばん高い山は？</p>
        <Button size="lg">富士山</Button>
        <Button size="lg">北岳</Button>
      </div>
    ),
  },
  globals: { surface: 'stage' },
};

/** 進行画面（投影）。文字と回る印は画面の幅で伸びる。ホストには、操作がつながってからできることも伝える */
export const Projector: Story = {
  args: {
    variant: 'projector',
    message: '接続が切れました。つなぎ直しています。進行の操作は、つながってからできます',
    children: (
      <div className="flex flex-col gap-stage p-stage pt-32">
        <p className="text-stage-title font-bold">第1問 / 10</p>
        <p className="text-question font-bold">日本でいちばん高い山は？</p>
      </div>
    ),
  },
  globals: { surface: 'stage' },
};
