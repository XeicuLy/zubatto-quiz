import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ConfirmDialog } from './confirm-dialog';

/**
 * 戻せない操作の前の確かめ。モーダルで画面を覆わず、開いたボタンや帯の場所に出す。
 * 確定はいつも destructive にし、開いたら「やめる」の側にフォーカスする。
 * スマホの幅では2つのボタンが幅を分け合い、広い画面（lg 以上）では文字の幅に戻って右へ寄る
 */
const meta = {
  component: ConfirmDialog,
  args: {
    title: '本当に消しますか？',
    detail: '消した問題セットは戻せません。作ってある部屋は、そのまま使えます。',
    confirmLabel: '本当に消す',
    size: 'sm',
    onConfirm: fn(),
    onCancel: fn(),
  },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'default', 'lg'] },
  },
  // 開いたら「やめる」にフォーカスするので、docs のページに並べて描くと、最後のストーリーがフォーカスを取ってページが下まで流れる。
  // docs ではストーリーごとに iframe で描き、フォーカスを iframe の中に閉じ込める。高さは lg のボタン（Host）が収まる分
  parameters: { docs: { story: { inline: false, height: '180px' } } },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 管理画面の一覧で、問題セットを消す前 */
export const Default: Story = {};

/** 編集画面を、保存せずに離れる前。「やめる」の文を、戻る先に合わせて変える */
export const LeaveEditor: Story = {
  args: {
    title: '保存していない変更があります',
    detail: 'このまま離れると、書いた内容は消えます。',
    confirmLabel: '保存せずに離れる',
    cancelLabel: '編集に戻る',
    size: 'default',
  },
};

/** 進行画面の操作の帯で、部屋を終える前。暗い面に置き、ボタンを大きくする */
export const Host: Story = {
  args: {
    title: '部屋を終えます',
    detail: '全員の接続が切れ、この部屋には戻れません。',
    confirmLabel: '部屋を終える',
    size: 'lg',
  },
  globals: { surface: 'stage' },
};

/** 確定を送っているあいだ。どちらのボタンも薄くなって押せず、Esc も受けない */
export const Pending: Story = {
  args: { pending: true },
};
