import { act, renderHook } from '@testing-library/react';
import type { Answer } from '@zubatto-quiz/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnswerPress } from './use-answer-press';

type OnAnswer = (answer: Omit<Answer, 'type'>) => boolean;

const LIMIT_MS = 10_000;

function renderPress(startedAt: number | null, onAnswer = vi.fn<OnAnswer>(() => true)) {
  const hook = renderHook(
    (props: { startedAt: number | null }) =>
      useAnswerPress({ questionId: 'q-3', limitMs: LIMIT_MS, startedAt: props.startedAt, onAnswer }),
    { initialProps: { startedAt } },
  );
  return { ...hook, onAnswer };
}

// 起点を決めるのは useCountdown で、QuestionView.test.tsx が rAF を進めて確かめる。
// ここでは起点を数で渡し、押した瞬間の時刻（偽の performance.now()）からの計測と、1回だけ送ることを見る
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('回答時間の計測（P2）', () => {
  it('起点から押すまでを、切り捨てた整数のミリ秒で送る', () => {
    const startedAt = performance.now();
    const { result, onAnswer } = renderPress(startedAt);

    vi.advanceTimersByTime(2370);
    act(() => result.current.press(1));

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ questionId: 'q-3', choiceIndex: 1, elapsedMs: 2370 });
    expect(result.current.pending).toEqual({ choiceIndex: 1, elapsedMs: 2370 });
  });

  it('起点が決まる前（選択肢を描く前）に押されても送らない', () => {
    const { result, onAnswer } = renderPress(null);

    act(() => result.current.press(0));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it('締切ちょうどに押されたら送らない', () => {
    const startedAt = performance.now();
    const { result, onAnswer } = renderPress(startedAt);

    vi.advanceTimersByTime(LIMIT_MS);
    act(() => result.current.press(0));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });
});

describe('1回だけ送る（F10）', () => {
  it('同じ描画のうちに2回押されても、1回しか送らない', () => {
    const { result, onAnswer } = renderPress(performance.now());

    // state は次の描画まで変わらないので、1つの act の中の2回目は ref でしか止められない
    act(() => {
      result.current.press(0);
      result.current.press(1);
    });

    expect(onAnswer).toHaveBeenCalledOnce();
    expect(result.current.pending).toEqual(expect.objectContaining({ choiceIndex: 0 }));
  });

  it('描き直したあとに押されても、もう送らない', () => {
    const { result, rerender, onAnswer } = renderPress(performance.now());

    act(() => result.current.press(0));
    rerender({ startedAt: performance.now() });
    act(() => result.current.press(1));

    expect(onAnswer).toHaveBeenCalledOnce();
  });

  it('送れなかったときは印を付けず、押し直せる', () => {
    const onAnswer = vi.fn<OnAnswer>().mockReturnValueOnce(false).mockReturnValue(true);
    const { result } = renderPress(performance.now(), onAnswer);

    act(() => result.current.press(0));
    expect(result.current.pending).toBeNull();
    act(() => result.current.press(2));

    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(result.current.pending).toEqual(expect.objectContaining({ choiceIndex: 2 }));
  });
});
