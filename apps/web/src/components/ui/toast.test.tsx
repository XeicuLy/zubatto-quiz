import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createToastManager, Toaster, toastManager } from './toast';

afterEach(() => {
  vi.useRealTimers();
});

/** Viewport は名前の付いた region で、出した toast はこの中に入る */
const viewport = () => screen.getByRole('region', { name: '通知' });

describe('Toaster', () => {
  it('何も出していないときも、「通知」という名前の polite な live region を置いておく', () => {
    render(<Toaster />);

    // 箱と中身が同時に現れると読まれないことがあるので、箱は先に置いておく
    expect(viewport()).toHaveAttribute('aria-live', 'polite');
    expect(viewport()).toBeEmptyDOMElement();
  });

  it('toastManager.add で出した文が、live region の中に出る', () => {
    render(<Toaster />);

    act(() => {
      toastManager.add({ title: '「2026 内輪クイズ」を消しました' });
    });

    expect(within(viewport()).getByText('「2026 内輪クイズ」を消しました')).toBeVisible();
  });

  // Base UI の Title は既定で <h2> を描く。見出しで移る人の、画面の見出しの並びに知らせが混ざらないようにする
  it('文は見出しにせず、toast（dialog）の名前にする', () => {
    render(<Toaster />);

    act(() => {
      toastManager.add({ title: '保存しました' });
    });

    expect(within(viewport()).getByRole('dialog', { name: '保存しました' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('toastManager.close で消える', () => {
    render(<Toaster />);
    act(() => {
      toastManager.add({ title: '保存しました' });
    });

    act(() => {
      toastManager.close();
    });

    expect(screen.queryByText('保存しました')).not.toBeInTheDocument();
  });

  it('timeout が過ぎたら自分で消える', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toastManager.add({ title: '保存しました', timeout: 6000 });
    });

    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(screen.getByText('保存しました')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('保存しました')).not.toBeInTheDocument();
  });

  it('toastManager を渡せば、モジュールの manager ではなくそちらから出す', () => {
    const own = createToastManager();
    render(<Toaster toastManager={own} />);

    act(() => {
      toastManager.add({ title: 'モジュールの manager' });
      own.add({ title: '渡した manager' });
    });

    expect(screen.getByText('渡した manager')).toBeInTheDocument();
    expect(screen.queryByText('モジュールの manager')).not.toBeInTheDocument();
  });

  // styles.css の :focus-visible が面ごとの二重の枠を出す。部品が上書きすると崩れる（UI の部品の決まり）
  it('フォーカスの class と transition を持たない', () => {
    render(<Toaster />);
    act(() => {
      toastManager.add({ title: '保存しました' });
    });

    const elements = [viewport(), ...viewport().querySelectorAll('*')];
    for (const element of elements) {
      // SVG の className は文字列でない（SVGAnimatedString）ので、属性で読む
      expect(element.getAttribute('class') ?? '').not.toMatch(/outline-none|focus-visible:|ring-|transition/);
    }
  });
});
