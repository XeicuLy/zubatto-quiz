import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { createToastManager, Toaster } from './toast';

/**
 * 出した toast を描くために、ストーリーごとに manager を作り、描いたあとに1つ出す。
 * Provider は useEffect で manager を購読し、子の effect は親より先に走るので、ここの useEffect から出せば取りこぼさない。
 * timeout: 0 で、自動では消さない
 */
function ToastStory({ message }: { message: string }) {
  const [manager] = useState(createToastManager);
  useEffect(() => {
    const id = manager.add({ title: message, timeout: 0 });
    return () => manager.close(id);
  }, [manager, message]);
  return <Toaster toastManager={manager} />;
}

/**
 * 成功を知らせる toast。スマホの幅では下に幅いっぱいで、広い画面（sm 以上）では右下に出る。
 * 読み上げは「通知」の live region が受け持つ。失敗には使わない。
 * 画面に fixed で出るので、docs のページではストーリーごとに iframe で描き、重ならないようにする
 */
const meta = {
  component: ToastStory,
  args: {
    message: '「2026 内輪クイズ」を消しました',
  },
  parameters: { docs: { story: { inline: false, height: '160px' } } },
} satisfies Meta<typeof ToastStory>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 管理画面で、問題セットを消したあと */
export const Default: Story = {};

/** 長い名前（100文字まで入る）は、どこでも折り返して幅に収める */
export const LongTitle: Story = {
  args: {
    message: `「${'とても長い問題セットの名前'.repeat(7)}」を消しました`,
  },
};

/** 暗い面に置いたとき。役割の色が入れ替わり、明るい toast になる */
export const Stage: Story = {
  globals: { surface: 'stage' },
};

/** スマホの幅では、下に幅いっぱいで出る */
export const Mobile: Story = {
  globals: { viewport: { value: 'mobile', isRotated: false } },
};
