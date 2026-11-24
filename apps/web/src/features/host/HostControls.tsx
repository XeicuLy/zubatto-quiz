import { canSend, type HostCommand, type RoomPhase, type RoomSnapshot } from '@zubatto-quiz/protocol';
import { useRef } from 'react';

import { useAnnouncement } from '@/components/a11y/announce';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import type { CurrentQuestion } from '@/realtime/room-store';
import type { SoundPlayer } from '@/shared/sound/sound-player';
import { SoundToggle } from '@/shared/sound/SoundToggle';

import { forwardCommandsOf } from './host-commands';

export interface HostControlsProps {
  room: RoomSnapshot;
  /** 今の問題の回答した人数。受付中に全員が答えたかを、説明の文で伝える */
  progress: CurrentQuestion['progress'];
  /** host-room の send。接続が開いていなければ false を返す */
  onSend: (command: HostCommand) => boolean;
  /** 効果音の切り替え（F18）を、やり直しと終了の並びに出す */
  sound: SoundPlayer;
}

/**
 * 進行の操作の帯（F8・F14・F15・A3）。画面の下に固定し、スマホでも親指で押せるようにする。
 * 進む操作は、今の段階で押せるものだけを出す（host-commands.ts）。やり直しと終了は左に出し、やり直しを押せないときは disabled にする。
 * ただし最終ランキングのあとは進む操作がないので、右の主ボタンの場所に「部屋を終える」を出し、左の2つは出さない（もうやり直せない）。
 * 効果音の切り替えも、目立たないようにやり直しと終了の並びに置く。
 * 受付中に全員が答えたら、説明の文を替えて読み上げる。締め切るかはホストが決めるので、自動では締め切らない。
 * やり直しと終了は、帯の中に ConfirmDialog を出して確かめてから送る。ページを止める window.confirm と違い、確かめるあいだも残り時間と受信が止まらない。
 * 確かめる表示を閉じたら、開いたボタンへフォーカスを戻す（useConfirm）。
 * 段階が変わったら、呼び出し側で key を変えて作り直し、確かめている途中の状態を捨てる。フォーカスは呼び出し側が見出しへ移す
 */
export function HostControls({ room, progress, onSend, sound }: HostControlsProps) {
  // 誤って押すと戻せないので、確かめてから送る操作
  const confirm = useConfirm<'retry' | 'end'>();
  const retryButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const forward = forwardCommandsOf(room);
  const retry: HostCommand | null =
    room.questionIndex === null ? null : { type: 'retryQuestion', questionIndex: room.questionIndex };
  const finished = room.phase === 'final';
  const allAnswered = room.phase === 'accepting' && isAllAnswered(progress);
  const hint = allAnswered ? allAnsweredMessage : hintOf(room.phase);
  // 段階ごとに作り直されるので、同じ問題の受付中に1回だけ読む。人が増えて全員でなくなり、また全員になったら、もう一度読む
  useAnnouncement(allAnswered ? allAnsweredMessage : null);

  function sendConfirmed(command: HostCommand) {
    // 送れなかったら（つなぎ直している）、確かめる表示を残して、押し直せるようにする
    if (onSend(command)) {
      confirm.close();
    }
  }

  return (
    <footer className="sticky bottom-0 z-10 border-t border-border bg-background px-stage py-4">
      {confirm.confirming === 'retry' && retry !== null ? (
        <ConfirmDialog
          title={`第${retry.questionIndex + 1}問をやり直します`}
          detail="この問題の回答はすべて消え、出題からやり直します。"
          confirmLabel="やり直す"
          onConfirm={() => sendConfirmed(retry)}
          onCancel={confirm.close}
          size="lg"
        />
      ) : confirm.confirming === 'end' ? (
        <ConfirmDialog
          title="部屋を終えます"
          detail="全員の接続が切れ、この部屋には戻れません。"
          confirmLabel="部屋を終える"
          onConfirm={() => sendConfirmed({ type: 'endRoom' })}
          onCancel={confirm.close}
          size="lg"
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {/* 間はボタンの左右の余白（px-4）でとり、-mx-4 で文字の端を帯の余白にそろえる */}
          <div className="-mx-4 flex flex-wrap">
            {!finished && (
              <>
                <Button
                  ref={retryButton}
                  variant="link"
                  size="sm"
                  disabled={retry === null || !canSend(room, retry)}
                  onClick={() => confirm.open('retry', retryButton)}
                >
                  この問題をやり直す
                </Button>
                <Button ref={endButton} variant="link" size="sm" onClick={() => confirm.open('end', endButton)}>
                  部屋を終える
                </Button>
              </>
            )}
            <SoundToggle sound={sound} variant="link" size="sm" />
          </div>
          {hint !== null && <p className="text-note text-muted-foreground lg:ml-auto">{hint}</p>}
          {finished && (
            // 説明がいつも左にあるので、forward の箱と違って lg:ml-auto は要らない
            <div className="flex w-full lg:w-auto">
              <Button ref={endButton} size="lg" onClick={() => confirm.open('end', endButton)} className={stretch}>
                部屋を終える
              </Button>
            </div>
          )}
          {forward.length > 0 && (
            <div className={`flex w-full flex-wrap gap-3 lg:w-auto ${hint === null ? 'lg:ml-auto' : ''}`}>
              {forward.map((command, index) => (
                <Button
                  key={command.type}
                  // 最後のものが、いちばん押してほしい操作
                  variant={index === forward.length - 1 ? 'default' : 'outline'}
                  size="lg"
                  onClick={() => onSend(command)}
                  className={stretch}
                >
                  {labelOf(command)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </footer>
  );
}

/** スマホでは帯の幅を分け合って親指で押しやすくし、広い画面では文字の幅に戻す */
const stretch = 'flex-1 lg:flex-none';

function labelOf(command: HostCommand): string {
  switch (command.type) {
    case 'showQuestion':
      return `第${command.questionIndex + 1}問を出す`;
    case 'startAnswering':
      return '受付を始める';
    case 'closeAnswering':
      return 'いま締め切る';
    case 'revealFastest':
      return '最速正解を発表する';
    case 'showStandings':
      return '途中経過を出す';
    case 'showFinalRanking':
      return '最終ランキングを出す';
    case 'retryQuestion':
      return 'この問題をやり直す';
    case 'endRoom':
      return '部屋を終える';
  }
}

const allAnsweredMessage = '全員が回答しました';

/** 参加者の全員が今の問題に答えたか。人数がまだ届いていないときと、参加者がいないときは言わない */
function isAllAnswered(progress: CurrentQuestion['progress']): boolean {
  return progress !== null && progress.participantCount > 0 && progress.answeredCount >= progress.participantCount;
}

/** ボタンの横に出す、ホストへの説明。投影に映っても邪魔にならないよう、小さく出す */
function hintOf(phase: RoomPhase): string | null {
  switch (phase) {
    case 'question':
      return '読み上げが終わったら押してください。回答者の画面に選択肢が出ます';
    case 'accepting':
      return '時間になると自動で締め切ります';
    case 'final':
      // 終えても HostEndedBar と回答者の ConnectionNotice が最終ランキングを残す（roomEndOf の after_final）
      return '部屋を終えても、最終ランキングは画面に残ります';
    default:
      return null;
  }
}
