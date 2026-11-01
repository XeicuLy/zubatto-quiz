import { canSend, type HostCommand, type RoomPhase, type RoomSnapshot } from '@zubatto-quiz/protocol';
import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

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
 * 確かめる表示を閉じたら、開いたボタンへフォーカスを戻す。
 * 段階が変わったら、呼び出し側で key を変えて作り直し、確かめている途中の状態を捨てる。フォーカスは呼び出し側が見出しへ移す
 */
export function HostControls({ room, onSend, sound }: HostControlsProps) {
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  // 最後に開いた確かめる表示。作り直した直後は null なので、作っただけではフォーカスを動かさない
  const opened = useRef<Confirming | null>(null);
  const forward = forwardCommandsOf(room);
  const retry: HostCommand | null =
    room.questionIndex === null ? null : { type: 'retryQuestion', questionIndex: room.questionIndex };
  const hint = hintOf(room.phase);

  function openConfirm(which: Confirming) {
    opened.current = which;
    setConfirming(which);
  }

  useLayoutEffect(() => {
    if (confirming === null && opened.current !== null) {
      (opened.current === 'retry' ? retryButton : endButton).current?.focus();
      opened.current = null;
    }
  }, [confirming]);

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
          {/* 間はボタンの左右の余白（px-4）でとり、-mx-4 で文字の端を帯の余白にそろえる */}
          <div className="-mx-4 flex flex-wrap">
            <Button
              ref={retryButton}
              variant="link"
              size="sm"
              disabled={retry === null || !canSend(room, retry)}
              onClick={() => openConfirm('retry')}
            >
              この問題をやり直す
            </Button>
            <Button ref={endButton} variant="link" size="sm" onClick={() => openConfirm('end')}>
              部屋を終える
            </Button>
            <SoundToggle sound={sound} variant="link" size="sm" />
          </div>
          {hint !== null && <p className="text-sm text-on-stage-muted lg:ml-auto">{hint}</p>}
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

interface ConfirmBarProps {
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * やり直しと終了の確かめ。開いたら「やめる」にフォーカスし、押し間違えても送らない方に合わせる。
 * Esc でも閉じる。帯の中に出すので、フォーカスが中にあるときだけ受ける。
 * autoFocus は jsx-a11y の no-autofocus に当たるので、ref で動かす
 */
function ConfirmBar({ title, detail, confirmLabel, onConfirm, onCancel }: ConfirmBarProps) {
  const titleId = useId();
  const detailId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    cancelButton.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onCancel();
    }
  }

  return (
    // 帯の中のボタンから上がってくる Esc を受けるだけで、帯そのものは操作しない。役割は alertdialog のままにする
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      onKeyDown={onKeyDown}
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
        <Button ref={cancelButton} variant="outline" size="lg" onClick={onCancel} className={stretch}>
          やめる
        </Button>
        <Button variant="destructive" size="lg" onClick={onConfirm} className={stretch}>
          {confirmLabel}
        </Button>
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
