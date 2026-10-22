import { fireEvent, render, screen, within } from '@testing-library/react';
import type { HostCommand, RoomPhase, RoomSnapshot } from '@zubatto-quiz/protocol';
import { describe, expect, it, vi } from 'vitest';

import { recordSounds } from '../../../test/fake-sound';
import { createSoundPlayer } from '../sound/sound-player';
import { HostControls } from './HostControls';

/** 5問の部屋。最後の2問は第4問と第5問 */
const room = (phase: RoomPhase, questionIndex: number | null): RoomSnapshot => ({
  title: '内輪クイズ',
  questionCount: 5,
  phase,
  questionIndex,
});

function renderControls(snapshot: RoomSnapshot) {
  const onSend = vi.fn<(command: HostCommand) => boolean>(() => true);
  // 音の切り替えは最後の describe で確かめる。ほかでは Web Audio のない端末にして出さない
  render(<HostControls room={snapshot} onSend={onSend} sound={createSoundPlayer({ createContext: null })} />);
  return { onSend };
}

/** 進む操作のボタンの名前。やり直しと終了は除く */
function forwardButtonNames() {
  return screen
    .getAllByRole('button')
    .map((button) => button.textContent)
    .filter((name) => name !== 'この問題をやり直す' && name !== '部屋を終える');
}

describe('進行の操作のボタン（F8・F14・F15）', () => {
  it('待機では「第1問を出す」を押せる', () => {
    const { onSend } = renderControls(room('lobby', null));

    fireEvent.click(screen.getByRole('button', { name: '第1問を出す' }));

    expect(onSend).toHaveBeenCalledWith({ type: 'showQuestion', questionIndex: 0 });
  });

  it('出題のあいだは受付を始めるだけで、締切は押せない（F8）', () => {
    const { onSend } = renderControls(room('question', 2));

    expect(forwardButtonNames()).toEqual(['受付を始める']);
    fireEvent.click(screen.getByRole('button', { name: '受付を始める' }));
    expect(onSend).toHaveBeenCalledWith({ type: 'startAnswering', questionIndex: 2 });
  });

  it('受付中は「いま締め切る」を押せる', () => {
    const { onSend } = renderControls(room('accepting', 2));

    fireEvent.click(screen.getByRole('button', { name: 'いま締め切る' }));

    expect(onSend).toHaveBeenCalledWith({ type: 'closeAnswering', questionIndex: 2 });
  });

  it.each<[string, RoomSnapshot, string[]]>([
    ['① のあとは ② だけ（F14）', room('revealed', 0), ['最速正解を発表する']],
    ['② のあとは ③ か次の問題', room('fastest', 0), ['途中経過を出す', '第2問を出す']],
    ['③ のあとは次の問題', room('standings', 0), ['第2問を出す']],
    ['最後から2問目の ② は ③ を出さない（F15）', room('fastest', 3), ['第5問を出す']],
    ['最後の問題の ② のあとは最終ランキング', room('fastest', 4), ['最終ランキングを出す']],
    ['最終ランキングのあとは進む操作がない', room('final', 4), []],
  ])('締切のあと: %s', (_case, snapshot, names) => {
    renderControls(snapshot);

    expect(forwardButtonNames()).toEqual(names);
  });
});

describe('やり直し（A3）', () => {
  it('押すと確かめ、「やり直す」で今の問題のやり直しを送る', () => {
    const { onSend } = renderControls(room('accepting', 2));

    fireEvent.click(screen.getByRole('button', { name: 'この問題をやり直す' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: /第3問をやり直します/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }));
    expect(onSend).toHaveBeenCalledWith({ type: 'retryQuestion', questionIndex: 2 });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('「やめる」を押すと、送らずに元のボタンに戻る', () => {
    const { onSend } = renderControls(room('question', 2));

    fireEvent.click(screen.getByRole('button', { name: 'この問題をやり直す' }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '受付を始める' })).toBeInTheDocument();
  });

  it.each<[string, RoomSnapshot]>([
    ['待機', room('lobby', null)],
    ['締切のあと（得点は確定している）', room('revealed', 2)],
    ['最終ランキング', room('final', 4)],
  ])('%s は押せない', (_case, snapshot) => {
    renderControls(snapshot);

    expect(screen.getByRole('button', { name: 'この問題をやり直す' })).toBeDisabled();
  });
});

describe('部屋を終える', () => {
  it('押すと確かめ、「部屋を終える」で終了を送る', () => {
    const { onSend } = renderControls(room('accepting', 1));

    fireEvent.click(screen.getByRole('button', { name: '部屋を終える' }));
    expect(onSend).not.toHaveBeenCalled();

    const dialog = screen.getByRole('alertdialog', { name: /部屋を終えます/ });
    fireEvent.click(within(dialog).getByRole('button', { name: '部屋を終える' }));
    expect(onSend).toHaveBeenCalledWith({ type: 'endRoom' });
  });

  it('送れなかったら（接続が開いていない）、確かめる表示を残す', () => {
    const { onSend } = renderControls(room('final', 4));
    onSend.mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: '部屋を終える' }));
    const dialog = screen.getByRole('alertdialog', { name: /部屋を終えます/ });
    fireEvent.click(within(dialog).getByRole('button', { name: '部屋を終える' }));

    expect(screen.getByRole('alertdialog', { name: /部屋を終えます/ })).toBeInTheDocument();
  });
});

describe('効果音の切り替え（F18）', () => {
  it('やり直しと終了の並びに「音を消す」を出し、押すと音を消す', () => {
    const sound = recordSounds();
    render(<HostControls room={room('accepting', 0)} onSend={() => true} sound={sound} />);

    fireEvent.click(screen.getByRole('button', { name: '音を消す' }));

    expect(sound.muted).toEqual([true]);
  });
});
