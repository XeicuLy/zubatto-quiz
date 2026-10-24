import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { liveRegion } from '../../../test/live-region';
import { announce, ANNOUNCE_DELAY_MS } from './announce';
import { Announcer } from './Announcer';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function announceAndWait(message: string, politeness?: 'polite' | 'assertive') {
  act(() => announce(message, politeness));
  act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
}

describe('読み上げ領域', () => {
  it('何も知らせる前から、polite と assertive の領域が1つずつ空で置いてある', () => {
    render(<Announcer />);

    expect(liveRegion('polite')).toBeEmptyDOMElement();
    expect(liveRegion('assertive')).toBeEmptyDOMElement();
  });

  it('文を渡すと、同じ領域の中身だけが替わる', () => {
    render(<Announcer />);
    const before = liveRegion('polite');

    announceAndWait('接続が切れました。つなぎ直しています');

    // 箱を作り直すと、読み上げられないことがある。箱はそのままで、中身だけを替える
    expect(liveRegion('polite')).toBe(before);
    expect(before).toHaveTextContent('接続が切れました。つなぎ直しています');
    expect(liveRegion('assertive')).toBeEmptyDOMElement();
  });

  it('急ぎの知らせは assertive の領域に入る', () => {
    render(<Announcer />);
    const before = liveRegion('assertive');

    announceAndWait('この部屋は終わりました', 'assertive');

    expect(liveRegion('assertive')).toBe(before);
    expect(before).toHaveTextContent('この部屋は終わりました');
    expect(liveRegion('polite')).toBeEmptyDOMElement();
  });

  it('同じ文を続けて渡しても、一度空にしてから入れ直す', () => {
    render(<Announcer />);
    announceAndWait('締切になりました');

    act(() => announce('締切になりました'));

    // 中身が変わらないと読み上げは起きないので、間を空けて空から入れ直す
    expect(liveRegion('polite')).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
    expect(liveRegion('polite')).toHaveTextContent('締切になりました');
  });

  it('待っているあいだに次の文が来たら、後の文だけを入れる', () => {
    render(<Announcer />);

    act(() => announce('接続が切れました。つなぎ直しています'));
    act(() => announce('つながりました'));
    act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));

    expect(liveRegion('polite')).toHaveTextContent(/^つながりました$/);
  });

  it('領域は画面には見えない', () => {
    render(<Announcer />);

    expect(liveRegion('polite').closest('.sr-only')).not.toBeNull();
    expect(liveRegion('assertive').closest('.sr-only')).not.toBeNull();
  });
});
