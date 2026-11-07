import type { ReactNode, Ref } from 'react';

import type { CurrentQuestion } from '@/realtime/room-store';

interface StageFrameProps {
  question: CurrentQuestion;
  questionCount: number;
  /** ヘッダーの右に出すもの */
  aside: ReactNode;
  children: ReactNode;
}

/** 問題の番号と、その下の中身。出題・受付中・① で共通 */
export function StageFrame({ question, questionCount, aside, children }: StageFrameProps) {
  return (
    <main className="flex flex-1 flex-col gap-stage p-stage">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-stage-title font-bold">
          <span>
            第<span className="font-numeral">{question.questionIndex + 1}</span>問
          </span>{' '}
          <span className="text-stage-label text-muted-foreground">/ {questionCount}</span>
        </p>
        {aside}
      </header>
      {children}
    </main>
  );
}

interface StageHeadingProps {
  /** 進行画面が、ホストの操作のあとにフォーカスを移す */
  ref?: Ref<HTMLHeadingElement>;
  /** 大きさと置き方。段階ごとに違うので、呼ぶ側が決める */
  className: string;
  /** 問題文 */
  children: ReactNode;
}

/**
 * 出題・受付中・① の見出し（問題文）。tabIndex={-1} で Tab の順番には入れず、フォーカスだけ受けられるようにする。
 * 押せるものではなく、投影にも映るので、フォーカスの枠は出さない（focus-target は styles.css にある）。
 * キーボードで進めるホストには、読み上げと、Tab で操作の帯へ戻れることで伝わる。
 * 問題文は文字のまま出し、ホストの入れた改行だけを whitespace-pre-line で残す（F5）
 */
export function StageHeading({ ref, className, children }: StageHeadingProps) {
  return (
    <h1 ref={ref} tabIndex={-1} className={`${className} font-bold text-phrase whitespace-pre-line focus-target`}>
      {children}
    </h1>
  );
}
