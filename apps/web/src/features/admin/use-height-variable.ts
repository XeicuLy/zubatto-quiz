import { type RefObject, useLayoutEffect } from 'react';

/**
 * 要素の高さを測り、html の CSS 変数 variable に入れる。要素がなくなったら外す。
 * 高さは中身と幅で変わるので、決め打ちせずに測る。ResizeObserver は描く前に知らせるので、測る前の値が一瞬見えることはない
 *
 * - --fixed-bar-height: 問題セットの編集の、画面の下に固定した保存の帯。styles.css が html の scroll-padding-bottom に使い、
 *   キーボードで移った欄が帯の下に隠れないようにする。画面はページの下の余白に使い、いちばん下までスクロールすれば最後の欄が帯の上に出る。
 *   帯は中身（保存の状態・失敗の文・離れる前の確かめ）で高さが変わる
 * - --header-height: 管理画面の上の帯。toast（components/ui/toast.tsx）がその下に出て、ログアウトやリンクに重ならないようにする。
 *   帯は管理者のリンクの段や、狭い幅での折り返しで高さが変わる
 */
export function useHeightVariable(element: RefObject<HTMLElement | null>, variable: `--${string}`) {
  useLayoutEffect(() => {
    const target = element.current;
    if (target === null) {
      return;
    }
    const root = document.documentElement;
    const observer = new ResizeObserver(([entry]) => {
      // 枠線も帯の一部なので、border-box の高さを使う
      root.style.setProperty(variable, `${entry.borderBoxSize[0].blockSize}px`);
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
      root.style.removeProperty(variable);
    };
  }, [element, variable]);
}
