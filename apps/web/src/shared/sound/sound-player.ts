import { createStore, type StoreApi } from 'zustand/vanilla';

import type { SoundCue } from './sound-cues';

/**
 * 効果音を鳴らす（F18）。音のファイルは使わず、Web Audio の発振器で合成する。ファイルの読み込みの失敗も、素材のライセンスもない。
 *
 * ブラウザは、利用者が操作する前に音を出すことを止める（自動再生の制限）。そこで AudioContext は操作のハンドラの中で作って resume し
 * （unlock）、動いている（running）あいだだけ鳴らす。止められているあいだは、鳴らさずに戻り、画面は止めない。
 * 端末全体で1つ作り、router の context から部屋の操作役（host-room・player-room）と切り替えのボタンに渡す
 */

/** sound-player が使う AudioContext の部分。テストでは test/fake-sound.ts を渡す */
export interface SoundContext {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface SoundState {
  /** 利用者が音を消したか。localStorage に覚える */
  muted: boolean;
  /** 鳴らせるか。AudioContext が動いているときだけ true */
  ready: boolean;
  /** Web Audio を使えるか。使えないブラウザでは、切り替えのボタンを出さない */
  available: boolean;
}

export interface SoundPlayer {
  readonly state: StoreApi<SoundState>;
  /**
   * 鳴らせるようにする。操作のハンドラの中で呼ぶ（unlockOnGestures が画面のどこを押しても呼ぶ）。
   * 消しているあいだは何もしない
   */
  unlock(): void;
  /** 音を順に鳴らす。消しているとき・まだ鳴らせないときは、何もせずに戻る */
  play(cues: readonly SoundCue[]): void;
  /** 音を消す・出す。出すときは鳴らせるようにもするので、操作のハンドラの中で呼ぶ */
  setMuted(muted: boolean): void;
}

export interface SoundPlayerOptions {
  /** AudioContext を作る。テストで偽物に替える。null なら Web Audio のないブラウザ */
  createContext?: (() => SoundContext) | null;
}

/** 消したかどうか。'off' なら消している */
export const SOUND_STORAGE_KEY = 'zubakui:sound';

/** 続けて鳴らす音の間隔（秒）。締切の音のあとに正解発表の音を鳴らすまで */
const CUE_INTERVAL_S = 0.7;

/** 1つの音を作る発振器の1つ。start は音の鳴り始めからの秒 */
interface Tone {
  type: OscillatorType;
  frequency: number;
  start: number;
  duration: number;
  /** 0〜1 */
  volume: number;
}

/** 音ごとの発振器。どれも CUE_INTERVAL_S のうちに鳴り終わる長さにする。高さは平均律の Hz */
const TONES: Record<SoundCue, readonly Tone[]> = {
  // ピロリン。上がっていく3音で、問題が出たことを知らせる
  question: [
    { type: 'triangle', frequency: 659.26, start: 0, duration: 0.12, volume: 0.35 },
    { type: 'triangle', frequency: 880, start: 0.09, duration: 0.12, volume: 0.35 },
    { type: 'triangle', frequency: 1318.51, start: 0.18, duration: 0.4, volume: 0.35 },
  ],
  // ブー。低い矩形波で、時間切れのブザー
  closed: [{ type: 'square', frequency: 174.61, start: 0, duration: 0.5, volume: 0.18 }],
  // ジャジャーン。ド・ミ・ソの和音を短く・長く
  reveal: [523.25, 659.26, 783.99].flatMap((frequency) => [
    { type: 'triangle' as const, frequency, start: 0, duration: 0.14, volume: 0.22 },
    { type: 'triangle' as const, frequency, start: 0.18, duration: 0.6, volume: 0.22 },
  ]),
  // ピンポン。高い音から少し低い音へ
  correct: [
    { type: 'sine', frequency: 1318.51, start: 0, duration: 0.3, volume: 0.4 },
    { type: 'sine', frequency: 1046.5, start: 0.22, duration: 0.6, volume: 0.4 },
  ],
  // ブッブー。締切のブザーより低く、2回に分ける
  incorrect: [
    { type: 'square', frequency: 130.81, start: 0, duration: 0.14, volume: 0.18 },
    { type: 'square', frequency: 130.81, start: 0.2, duration: 0.45, volume: 0.18 },
  ],
};

export function createSoundPlayer({ createContext = defaultContextFactory() }: SoundPlayerOptions = {}): SoundPlayer {
  const state = createStore<SoundState>()(() => ({
    muted: loadMuted(),
    ready: false,
    available: createContext !== null,
  }));
  let context: SoundContext | undefined;

  /** 初めての操作で AudioContext を作る。作れなければ、もう試さない */
  function contextOf(): SoundContext | undefined {
    if (context !== undefined || createContext === null || !state.getState().available) {
      return context;
    }
    try {
      const created = createContext();
      // iOS で画面を消すと interrupted になるなど、端末の都合でも止まる。そのたびに鳴らせるかを写す
      created.addEventListener('statechange', () => state.setState({ ready: created.state === 'running' }));
      // 前にこのページを操作していれば、作った時点で動いていて、statechange は起きない
      state.setState({ ready: created.state === 'running' });
      context = created;
    } catch {
      state.setState({ available: false });
    }
    return context;
  }

  function unlock() {
    if (state.getState().muted) {
      return;
    }
    const current = contextOf();
    if (current === undefined || current.state === 'running') {
      return;
    }
    // 断られても、鳴らせないまま進める。次の操作でまた試す
    current.resume().catch(() => {});
  }

  return {
    state,
    unlock,
    play(cues) {
      const current = context;
      if (state.getState().muted || current?.state !== 'running') {
        return;
      }
      // setTimeout ではなく AudioContext の時計で予約する。タイマーが遅れても、音の間隔はずれない
      const now = current.currentTime;
      cues.forEach((cue, index) => {
        for (const tone of TONES[cue]) {
          playTone(current, tone, now + index * CUE_INTERVAL_S);
        }
      });
    },
    setMuted(muted) {
      state.setState({ muted });
      saveMuted(muted);
      if (!muted) {
        unlock();
      }
    },
  };
}

/**
 * 音の切り替えのボタン（SoundToggle）に付ける印。unlockOnGestures は、これが付いた要素を押したときは何もしない。
 * ボタンは自分のハンドラで鳴らせるようにする。両方が動くと、Chrome は操作の中で作った AudioContext をその場で running にし、
 * React はボタンの onClick より先に描き直すので、「音を有効にする」を押したのに「音を消す」として動いてしまう
 */
export const SOUND_TOGGLE_ATTRIBUTE = 'data-sound-toggle';

/**
 * 画面のどこかを押すか、キーを押すたびに unlock を呼ぶ。外すための関数を返す。
 * 入室の「参加する」や進行のボタンを押したときに、ついでに鳴らせるようにする。
 * 一度だけにしないのは、iOS で画面を消して戻ったときなど、止まった AudioContext を次の操作で戻すため。
 * 子の要素が止めても届くよう、capture で聞く
 */
export function unlockOnGestures(target: EventTarget, sound: SoundPlayer): () => void {
  const unlock = (event: Event) => {
    if (event.target instanceof Element && event.target.closest(`[${SOUND_TOGGLE_ATTRIBUTE}]`) !== null) {
      return;
    }
    sound.unlock();
  };
  for (const type of GESTURES) {
    target.addEventListener(type, unlock, { capture: true });
  }
  return () => {
    for (const type of GESTURES) {
      target.removeEventListener(type, unlock, { capture: true });
    }
  };
}

/** ブラウザが「利用者の操作」と認める出来事。click は Safari でも Chrome でも、その中で resume できる */
const GESTURES = ['click', 'keydown'] as const;

/** 発振器1つを、at 秒から鳴らす。音の頭と終わりをなめらかにして、ぷつっという音を出さない */
function playTone(context: SoundContext, tone: Tone, at: number) {
  const start = at + tone.start;
  const end = start + tone.duration;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(tone.volume, start + 0.01);
  // 指数のカーブは0に向かえないので、聞こえない小ささまで下げる
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end);
}

function defaultContextFactory(): (() => SoundContext) | null {
  return typeof AudioContext === 'undefined' ? null : () => new AudioContext();
}

/** localStorage が使えなければ、鳴らす状態で始める */
function loadMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === 'off';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean) {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, muted ? 'off' : 'on');
  } catch {
    // 覚えられなくても、このタブのあいだは切り替えたとおりに動く
  }
}
