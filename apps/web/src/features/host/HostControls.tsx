import { canSend, type HostCommand, type RoomPhase, type RoomSnapshot } from '@zubatto-quiz/protocol';
import { useId, useState } from 'react';

import type { SoundPlayer } from '../sound/sound-player';
import { SoundToggle } from '../sound/SoundToggle';
import { forwardCommandsOf } from './host-commands';

export interface HostControlsProps {
  room: RoomSnapshot;
  /** host-room の send。接続が開いていなければ false を返す */
  onSend: (command: HostCommand) => boolean;
  /** 効果音の切り替え（F18）を、やり直しと終了の並びに出す */
  sound: SoundPlayer;
}

/** 確かめてから送る操作。誤って押すと戻せない */
type Confirming = 'retry' | 'end';

/**
 * 進行の操作の帯（F8・F14・F15・A3）。画面の下に固定し、スマホでも親指で押せるようにする。
 * 進む操作は、今の段階で押せるものだけを出す（host-commands.ts）。やり直しと終了はいつも出し、押せないときは disabled にする。
 * 効果音の切り替えも、目立たないようにやり直しと終了の並びに置く。
 * やり直しと終了は、その場で確かめてから送る。ページを止める window.confirm と違い、確かめるあいだも残り時間と受信が止まらない。
 * 段階が変わったら、呼び出し側で key を変えて作り直し、確かめている途中の状態を捨てる
 */
export function HostControls({ room, onSend, sound }: HostControlsProps) {
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const forward = forwardCommandsOf(room);
  const retry: HostCommand | null =
    room.questionIndex === null ? null : { type: 'retryQuestion', questionIndex: room.questionIndex };
  const hint = hintOf(room.phase);

  function sendConfirmed(command: HostCommand) {
    // 送れなかったら（つなぎ直している）、確かめる表示を残して、押し直せるようにする
    if (onSend(command)) {
      setConfirming(null);
    }
  }

  return (
    <footer className="sticky bottom-0 z-10 border-t border-stage-line bg-stage px-stage py-4">
      {confirming === 'retry' && retry !== null ? (
        <ConfirmBar
          title={`第${retry.questionIndex + 1}問をやり直します`}
          detail="この問題の回答はすべて消え、出題からやり直します。"
          confirmLabel="やり直す"
          onConfirm={() => sendConfirmed(retry)}
          onCancel={() => setConfirming(null)}
        />
      ) : confirming === 'end' ? (
        <ConfirmBar
          title="部屋を終えます"
          detail="全員の接続が切れ、この部屋には戻れません。"
          confirmLabel="部屋を終える"
          onConfirm={() => sendConfirmed({ type: 'endRoom' })}
          onCancel={() => setConfirming(null)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex gap-4 text-sm">
            <button
              type="button"
              disabled={retry === null || !canSend(room, retry)}
              onClick={() => setConfirming('retry')}
              className={subtleButton}
            >
              この問題をやり直す
            </button>
            <button type="button" onClick={() => setConfirming('end')} className={subtleButton}>
              部屋を終える
            </button>
            <SoundToggle sound={sound} className={subtleButton} />
          </div>
          {hint !== null && <p className="text-sm text-on-stage-muted lg:ml-auto">{hint}</p>}
          {forward.length > 0 && (
            <div className={`flex w-full flex-wrap gap-3 lg:w-auto ${hint === null ? 'lg:ml-auto' : ''}`}>
              {forward.map((command, index) => (
                <button
                  key={command.type}
                  type="button"
                  onClick={() => onSend(command)}
                  // 最後のものが、いちばん押してほしい操作
                  className={index === forward.length - 1 ? primaryButton : secondaryButton}
                >
                  {labelOf(command)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </footer>
  );
}

const focusRing = 'focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-on-stage';
const primaryButton = `flex-1 rounded-full bg-on-stage px-6 py-3 font-bold text-stage shadow-panel active:translate-y-1.5 active:shadow-none lg:flex-none ${focusRing}`;
const secondaryButton = `flex-1 rounded-full border-2 border-on-stage px-6 py-3 font-bold lg:flex-none ${focusRing}`;
const subtleButton = `text-on-stage-muted underline underline-offset-4 disabled:no-underline disabled:opacity-40 ${focusRing}`;

interface ConfirmBarProps {
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmBar({ title, detail, confirmLabel, onConfirm, onCancel }: ConfirmBarProps) {
  const titleId = useId();
  const detailId = useId();
  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      className="flex flex-wrap items-center gap-x-6 gap-y-3"
    >
      <div className="min-w-0">
        <p id={titleId} className="font-bold">
          {title}
        </p>
        <p id={detailId} className="text-sm text-on-stage-muted">
          {detail}
        </p>
      </div>
      <div className="flex w-full flex-wrap gap-3 lg:ml-auto lg:w-auto">
        <button type="button" onClick={onCancel} className={secondaryButton}>
          やめる
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`flex-1 rounded-full bg-alert px-6 py-3 font-bold text-stage shadow-panel active:translate-y-1.5 active:shadow-none lg:flex-none ${focusRing}`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

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

/** ボタンの横に出す、ホストへの説明。投影に映っても邪魔にならないよう、小さく出す */
function hintOf(phase: RoomPhase): string | null {
  switch (phase) {
    case 'question':
      return '読み上げが終わったら押してください。回答者の画面に選択肢が出ます';
    case 'accepting':
      return '時間になると自動で締め切ります';
    default:
      return null;
  }
}
