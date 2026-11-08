import type { Meta, StoryObj } from '@storybook/react-vite';
import type { RoomPhase, RoomSnapshot } from '@zubatto-quiz/protocol';
import { fn } from 'storybook/test';
import { createStore } from 'zustand/vanilla';

import type { SoundPlayer, SoundState } from '@/shared/sound/sound-player';

import { HostControls } from './HostControls';

/** 10問の部屋。第9問は最後から2問目、第10問は最後の問題 */
const room = (phase: RoomPhase, questionIndex: number | null): RoomSnapshot => ({
  title: '内輪クイズ',
  questionCount: 10,
  phase,
  questionIndex,
});

/**
 * 効果音。本物（createSoundPlayer）は AudioContext と localStorage で状態が変わるので、
 * 鳴らせる状態に止めたストアを渡し、切り替えのボタンを「音を消す」で出す。押しても状態は変わらない
 */
const sound: SoundPlayer = {
  state: createStore<SoundState>()(() => ({ muted: false, ready: true, available: true })),
  unlock: fn(),
  play: fn(),
  setMuted: fn(),
};

/**
 * 進行の操作の帯（F8・F14・F15・A3）。今の段階で押せる進む操作だけを右に出し、最後のものをいちばん目立たせる。
 * やり直しと終了は、押すと帯の中で確かめる（確かめる表示は ConfirmDialog の Host のストーリーにある）。
 * やり直せるのは出題と受付中だけで（protocol の room-flow.ts）、ほかの段階ではやり直しのボタンが薄くなって押せない。
 * onSend は送れたことにして true を返すので、確かめる表示を開いて「やり直す」まで押せる。
 * 進行画面の下に固定するので、暗い面に置き、投影の大きさで見る。ホストがスマホで進めるときの並びは Mobile で見る
 */
const meta = {
  component: HostControls,
  args: { room: room('question', 2), onSend: fn(() => true), sound },
  argTypes: { sound: { control: false } },
  globals: { surface: 'stage', viewport: { value: 'projector', isRotated: false } },
} satisfies Meta<typeof HostControls>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 待機。まだ問題を出していないので、やり直しは押せない */
export const Lobby: Story = {
  args: { room: room('lobby', null) },
};

/** 出題。受付を始めるだけで、締め切りは押せない。ボタンの横にホストへの説明を出す */
export const Question: Story = {};

/** 受付中。時間を待たずに締め切れる */
export const Accepting: Story = {
  args: { room: room('accepting', 2) },
};

/** ① のあと。② の発表だけ（F14） */
export const Revealed: Story = {
  args: { room: room('revealed', 2) },
};

/** ② のあと。③ の途中経過か、次の問題。次の問題をいちばん目立たせる */
export const Fastest: Story = {
  args: { room: room('fastest', 2) },
};

/** 最後から2問目の ② のあと。最後の2問は順位を伏せるので、③ を出さない（F15） */
export const FastestBeforeLast: Story = {
  args: { room: room('fastest', 8) },
};

/** 最後の問題の ② のあと。最終ランキングへ */
export const FastestLast: Story = {
  args: { room: room('fastest', 9) },
};

/** 最終ランキング。進む操作はなく、やり直しと終了だけが残る */
export const Final: Story = {
  args: { room: room('final', 9) },
};

/** スマホの幅。進む操作のボタンは帯の幅を分け合い、親指で押しやすくする */
export const Mobile: Story = {
  args: { room: room('fastest', 2) },
  globals: { viewport: { value: 'mobile', isRotated: false } },
};
