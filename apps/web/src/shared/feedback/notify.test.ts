import { afterEach, describe, expect, it, vi } from 'vitest';

import { ANNOUNCE_DELAY_MS, announcements } from '@/components/a11y/announce';
import { toastManager } from '@/components/ui/toast';

import { NOTIFY_MIN_MS, NOTIFY_MS_PER_CHAR, notify, notifyTimeoutOf } from './notify';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('notifyTimeoutOf', () => {
  it('短い文でも、最低の時間は出しておく', () => {
    expect(notifyTimeoutOf('保存しました')).toBe(NOTIFY_MIN_MS);
  });

  it('長い文は、1文字ごとに時間を足し、読み終えられる長さにする', () => {
    // 問題セットの名前は100文字まで入る。かぎかっこ2文字と「を消しました」6文字を足して108文字
    const message = `「${'あ'.repeat(100)}」を消しました`;

    expect(notifyTimeoutOf(message)).toBe(108 * NOTIFY_MS_PER_CHAR);
    expect(notifyTimeoutOf(message)).toBeGreaterThan(NOTIFY_MIN_MS);
  });

  it('絵文字のようなサロゲートペアは、1文字に数える', () => {
    const long = '🎉'.repeat(60);

    expect(notifyTimeoutOf(long)).toBe(60 * NOTIFY_MS_PER_CHAR);
  });
});

describe('notify', () => {
  it('文の長さで決めた時間で、toast を1つ出す', () => {
    const add = vi.spyOn(toastManager, 'add');

    notify('「2026 内輪クイズ」を消しました');

    expect(add).toHaveBeenCalledExactlyOnceWith({
      title: '「2026 内輪クイズ」を消しました',
      timeout: notifyTimeoutOf('「2026 内輪クイズ」を消しました'),
    });
  });

  // toast の Viewport が自分の live region で読む。Announcer にも渡すと2回読まれる
  it('読み上げ領域（Announcer）には文を渡さない', () => {
    vi.useFakeTimers();

    notify('保存しました');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);

    expect(announcements.getState()).toEqual({ polite: '', assertive: '' });
  });
});
