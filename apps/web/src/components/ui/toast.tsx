import { Toast as ToastPrimitive } from '@base-ui/react/toast';

/**
 * 画面に1つの toast の manager。Toaster の Provider がこれを購読するので、hook の外（mutation の onSuccess）からも出せる。
 * 画面はこれを直接触らず、shared/feedback の notify を使う（出す時間と読み上げの決まりをそこにまとめる）
 */
const toastManager = ToastPrimitive.createToastManager();

const createToastManager = ToastPrimitive.createToastManager;

type ToastManager = ReturnType<typeof createToastManager>;

/**
 * 成功を知らせる toast（#287）。shadcn/ui の toast（Base UI 版）を写し、このアプリの決まりに合わせて削った。
 * - sonner は読み込み時に <style> を <head> へ差し込み、CSP に止められるので使わない（ADR 0007 の Radix の Dialog と同じ）。
 *   Base UI は位置などの値を React の style prop（CSSOM）で入れ、<style> を作らない
 * - Portal は使わない。body の直下に描くと、Storybook の .stage の箱の外に出て、暗い面の色が当たらない。
 *   Viewport は fixed なので、__root の末尾に置けば Portal と同じ場所に出る
 * - Viewport は自分で aria-live="polite" の region を持ち、出した toast を読み上げる。読み上げはここに任せ、announce は呼ばない
 * - hover とフォーカスのあいだは消えるまでの時間を止め、Esc で閉じる（どちらも Base UI が持つ）
 * - shadcn の重ねて縮める動きと transition は外し、縦に並べる。動きは最速正解者と優勝の発表の1か所だけにする決まりのため。
 *   フォーカスの class も外す（styles.css の :focus-visible が枠を出す）
 * - 閉じるボタン・アクション・説明は写していない。成功の知らせは待てば消え、文は題（title）1つで足りる
 * - 画面の上に出す（#290）。問題セットの編集とホストの進行は、下に操作の帯を固定している。下に出すと、
 *   保存したあとフォーカスのある「保存する」や、作った直後に開いた部屋の「第1問を出す」を覆ってしまう（WCAG 2.4.11）
 */
function Toaster({ toastManager: manager = toastManager }: { toastManager?: ToastManager }) {
  return (
    <ToastPrimitive.Provider toastManager={manager}>
      {/* スマホでは上に幅いっぱい（両端は余白）、広い画面では右上に寄せる。toast のないところはクリックを下の画面へ通す */}
      <ToastPrimitive.Viewport
        aria-label="通知"
        className="pointer-events-none fixed inset-x-4 top-4 z-50 mx-auto flex max-w-sm flex-col gap-related sm:right-4 sm:left-auto sm:mx-0 sm:w-full"
      >
        <ToastList />
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Provider>
  );
}

/**
 * 新しいものほど前に来るので、flex-col のまま角（上）にいちばん近いところへ置く。数が上限（3）を超えた古いものは隠す。
 * 払って閉じる向きは、出ている角の方（上か右）にする。Base UI の既定は下に出す前提の下か右
 */
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      swipeDirection={['up', 'right']}
      className="pointer-events-auto flex items-start gap-related rounded-panel bg-primary p-item text-primary-foreground shadow-lg select-none data-limited:hidden"
    >
      <CheckIcon />
      {/* 題は問題セットの名前を含み、長いことがある。どこでも折り返して幅に収める。
          Base UI は既定で <h2> を描き、画面の見出しの並びに知らせが混ざるので <p> にする（toast の名前には変わらずなる） */}
      <ToastPrimitive.Title render={<p />} className="min-w-0 text-body font-bold wrap-anywhere" />
    </ToastPrimitive.Root>
  ));
}

/** 成功の印。文が意味を持つので、読み上げない。大きさは本文の1行の高さにそろえる */
function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-[0.2em] size-5 shrink-0"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export { createToastManager, Toaster, toastManager };
export type { ToastManager };
