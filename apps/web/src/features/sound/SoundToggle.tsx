import type { ComponentProps } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';

import type { SoundPlayer } from './sound-player';

/** 見た目は置く場所（進行の操作の帯と、回答者の画面の右下）で変えるので、Button の variant・size・className をそのまま受け取る */
export type SoundToggleProps = Pick<ComponentProps<typeof Button>, 'variant' | 'size' | 'className'> & {
  sound: SoundPlayer;
};

/**
 * 効果音の切り替え（F18）。押すと何が起きるかを、ボタンの文字にする。
 * - 消している: 「音を出す」
 * - 出すが、まだ鳴らせない: 「音を有効にする」。読み込み直して入った回答者は、まだ何も押していないので、ブラウザが音を止めている
 * - 鳴らせる: 「音を消す」
 * 押したこと自体が操作なので、そのハンドラの中で鳴らせるようにする。画面のどこでも有効にする仕掛け（unlockOnGestures）には、
 * 印を付けてこのボタンを任せない。Web Audio のないブラウザでは出さない
 */
export function SoundToggle({ sound, ...look }: SoundToggleProps) {
  const { muted, ready, available } = useStore(sound.state);

  if (!available) {
    return null;
  }
  return (
    <Button
      {...look}
      // SOUND_TOGGLE_ATTRIBUTE。テストで同じ名前かを確かめる
      data-sound-toggle=""
      onClick={() => {
        if (muted || ready) {
          sound.setMuted(!muted);
        } else {
          sound.unlock();
        }
      }}
    >
      {muted ? '音を出す' : ready ? '音を消す' : '音を有効にする'}
    </Button>
  );
}
