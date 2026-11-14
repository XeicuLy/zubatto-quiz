import { toastManager } from '@/components/ui/toast';

/** 短い文でも、目を向けて読むまでの時間は要る */
export const NOTIFY_MIN_MS = 6000;

/**
 * 1文字を読むのにとる時間。日本語を黙読する速さ（1分に400〜600字）の遅いほうより、さらにゆっくりの1秒に約7字にする。
 * 問題セットの名前（100字まで）を含む文でも、読み終えるまで出ている
 */
export const NOTIFY_MS_PER_CHAR = 150;

/** 文の長さから、自動で消えるまでの時間を決める（WCAG 2.2.1）。絵文字などのサロゲートペアも1文字に数える */
export function notifyTimeoutOf(message: string): number {
  return Math.max(NOTIFY_MIN_MS, [...message].length * NOTIFY_MS_PER_CHAR);
}

/**
 * 成功を toast で知らせる（#287）。失敗には使わない。失敗は消えずに原因の近くに残す。
 * 読み上げは toast の Viewport の live region が受け持つので、announce は呼ばない。呼ぶと2回読まれる。
 * hook ではないので、mutation の onSuccess からそのまま呼べる。Toaster は __root にあるので、画面を移っても消えない
 */
export function notify(message: string) {
  toastManager.add({ title: message, timeout: notifyTimeoutOf(message) });
}
