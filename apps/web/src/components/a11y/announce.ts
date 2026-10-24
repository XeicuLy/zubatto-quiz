import { useEffect } from 'react';
import { createStore } from 'zustand/vanilla';

/** polite はふつうの知らせ。assertive は読み上げ中の文を止めてでも伝える、急ぎの知らせ（部屋が終わった・別のタブで開いた など） */
export type Politeness = 'polite' | 'assertive';

/** 空にしてから文を入れるまでの間。続けて書き換えると、読み上げソフトが「変わっていない」と見なすことがある */
export const ANNOUNCE_DELAY_MS = 100;

/** 読み上げ領域（Announcer）に出す文。画面は箱を持たず、ここに文だけを渡す */
export const announcements = createStore<Record<Politeness, string>>()(() => ({ polite: '', assertive: '' }));

const timers: Partial<Record<Politeness, ReturnType<typeof setTimeout>>> = {};

/**
 * 読み上げ領域に文を渡す。同じ文を続けて渡しても読まれるよう、一度空にしてから入れる。
 * 待っているあいだに次の文が来たら、後の文だけを入れる
 */
export function announce(message: string, politeness: Politeness = 'polite') {
  clearTimeout(timers[politeness]);
  announcements.setState({ [politeness]: '' });
  timers[politeness] = setTimeout(() => {
    announcements.setState({ [politeness]: message });
  }, ANNOUNCE_DELAY_MS);
}

/** 待っている文を捨て、両方の領域を空にする。テストのあとに前の文が残らないよう、test/setup.ts が呼ぶ */
export function clearAnnouncements() {
  clearTimeout(timers.polite);
  clearTimeout(timers.assertive);
  announcements.setState({ polite: '', assertive: '' });
}

/**
 * 画面の状態から決まる文を、変わるたびに読み上げる。null のあいだは何も言わない。
 * StrictMode で effect が2回走っても、待っている文が入れ替わるだけで、読まれるのは1回
 */
export function useAnnouncement(message: string | null, politeness: Politeness = 'polite') {
  useEffect(() => {
    if (message !== null) {
      announce(message, politeness);
    }
  }, [message, politeness]);
}
