import { createStore } from 'zustand/vanilla';

import type { SoundCue } from '../src/features/sound/sound-cues';
import type { SoundContext, SoundPlayer, SoundState } from '../src/features/sound/sound-player';

/** 偽の AudioContext が鳴らした音。発振器を start した時点で記録する */
export interface PlayedTone {
  type: OscillatorType;
  frequency: number;
  /** 鳴り始める時刻（AudioContext の currentTime と同じ、秒） */
  startAt: number;
}

/**
 * メモリの上で動く偽の AudioContext。jsdom には Web Audio がないので、sound-player の代わりに渡す。
 * 音は出さず、鳴らした発振器の種類・高さ・時刻を played に記録する。
 * 本物と同じく、作った直後は suspended で、resume で running になる。自動再生が止められた端末は resumeFails で真似る
 */
export class FakeAudioContext implements SoundContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly destination = {} as AudioDestinationNode;
  readonly played: PlayedTone[] = [];
  /** true なら resume を断る（ブラウザが自動再生を止めたとき） */
  resumeFails = false;
  #listeners: (() => void)[] = [];

  resume(): Promise<void> {
    if (this.resumeFails) {
      return Promise.reject(new DOMException('自動再生が止められている', 'NotAllowedError'));
    }
    this.changeState('running');
    return Promise.resolve();
  }

  /** 端末の都合で状態が変わったことを真似る（iOS で画面を消すと interrupted になるなど） */
  changeState(state: AudioContextState): void {
    this.state = state;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') {
      this.#listeners.push(listener);
    }
  }

  createGain(): GainNode {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { gain: param, connect: (node: AudioNode) => node } as unknown as GainNode;
  }

  createOscillator(): OscillatorNode {
    const tone: PlayedTone = { type: 'sine', frequency: 0, startAt: Number.NaN };
    const oscillator = {
      type: 'sine' as OscillatorType,
      frequency: {
        setValueAtTime: (value: number) => {
          tone.frequency = value;
        },
      },
      connect: (node: AudioNode) => node,
      start: (when: number) => {
        tone.type = oscillator.type;
        tone.startAt = when;
        this.played.push(tone);
      },
      stop() {},
    };
    return oscillator as unknown as OscillatorNode;
  }
}

/**
 * 鳴らすよう頼まれた音を cues に、消す・出すの切り替えを muted に記録する、偽の sound-player。部屋の操作役（host-room・player-room）のテストで使う。
 * どの音をどう合成するかは sound-player.test.ts で確かめるので、ここは頼まれた音の名前だけを並べる
 */
export function recordSounds(): SoundPlayer & { cues: SoundCue[]; muted: boolean[] } {
  const cues: SoundCue[] = [];
  const muted: boolean[] = [];
  return {
    cues,
    muted,
    state: createStore<SoundState>()(() => ({ muted: false, ready: true, available: true })),
    unlock() {},
    play(played) {
      cues.push(...played);
    },
    setMuted(value) {
      muted.push(value);
    },
  };
}
