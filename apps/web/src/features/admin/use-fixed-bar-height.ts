import { type RefObject, useLayoutEffect } from 'react';

/**
 * 画面の下に固定した帯の高さを測り、html の CSS 変数 --fixed-bar-height に入れる。帯がなくなったら外す。
 * styles.css が html の scroll-padding-bottom にこれを使い、キーボードで移った欄が帯の下に隠れないようにする。
 * 画面はページの下の余白にこれを使い、いちばん下までスクロールすれば最後の欄が帯の上に出るようにする。
 *
 * 帯は中身（保存の状態・失敗の文・離れる前の確かめ）と幅で高さが変わるので、余白を決め打ちせずに測る。
 * ResizeObserver は描く前に知らせるので、測る前の余白が一瞬見えることはない
 */
export function useFixedBarHeight(bar: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = bar.current;
    if (element === null) {
      return;
    }
    const root = document.documentElement;
    const observer = new ResizeObserver(([entry]) => {
      // 枠線も帯の一部なので、border-box の高さを使う
      root.style.setProperty('--fixed-bar-height', `${entry.borderBoxSize[0].blockSize}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--fixed-bar-height');
    };
  }, [bar]);
}
