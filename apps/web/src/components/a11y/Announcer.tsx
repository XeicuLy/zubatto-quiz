import { useStore } from 'zustand';

import { announcements } from './announce';

/**
 * 読み上げ領域（live region）。__root に1つだけ常に置き、announce で渡された文だけを替える。
 * 箱と中身が同時に現れると読み上げられないことがあるので、画面の側には role="status" の箱を出さない。
 * role は付けない。見える箱の role="status" とぶつからないよう、aria-live だけで知らせる
 */
export function Announcer() {
  const { polite, assertive } = useStore(announcements);
  return (
    <div className="sr-only">
      <div aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </div>
  );
}
