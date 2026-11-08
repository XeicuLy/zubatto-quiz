import type { ReactNode } from 'react';

import type { TimeBarValue } from '@/shared/countdown/time-bar';
import { TimeBar } from '@/shared/countdown/TimeBar';

export interface QuestionFrameProps {
  /** 問題の番号（0から） */
  questionIndex: number;
  questionCount: number;
  /** 問題文。ホストの入れた改行を含むことがある */
  text: string;
  /** ヘッダーの右に出すもの */
  aside?: ReactNode;
  /** 残り時間の棒。受付中だけ渡す */
  progress?: TimeBarValue;
  children: ReactNode;
}

/** 問題の番号・問題文と、その下の中身。問題文は文字のまま出し、ホストの入れた改行だけを whitespace-pre-line で残す（F5） */
export function QuestionFrame({ questionIndex, questionCount, text, aside, progress, children }: QuestionFrameProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-4 pb-24">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <p className="shrink-0 text-heading font-bold">
          第{questionIndex + 1}問 <span className="text-note text-muted-foreground">/ {questionCount}</span>
        </p>
        {aside}
      </header>
      {progress !== undefined && (
        <div className="mt-2">
          <TimeBar {...progress} variant="mobile" />
        </div>
      )}
      <h1 className="mt-5 text-lead font-bold text-phrase whitespace-pre-line">{text}</h1>
      {children}
    </main>
  );
}
