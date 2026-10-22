import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeAudioContext } from '../../../test/fake-sound';
import { createSoundPlayer, SOUND_STORAGE_KEY, SOUND_TOGGLE_ATTRIBUTE, unlockOnGestures } from './sound-player';

/** 偽の AudioContext で作った sound-player。作られた AudioContext を contexts で見る */
function setup() {
  const contexts: FakeAudioContext[] = [];
  const sound = createSoundPlayer({
    createContext: () => {
      const context = new FakeAudioContext();
      contexts.push(context);
      return context;
    },
  });
  return { sound, contexts };
}

/** 操作のあとで鳴らせる状態にした sound-player と、その AudioContext */
function unlocked() {
  const { sound, contexts } = setup();
  sound.unlock();
  const [context] = contexts;
  if (context === undefined) {
    throw new Error('AudioContext が作られていない');
  }
  return { sound, context };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('効果音を鳴らす（F18）', () => {
  it('操作で有効にしたあとは、今の時刻から音を鳴らす', () => {
    const { sound, context } = unlocked();
    context.currentTime = 12;

    sound.play(['question']);

    expect(context.played.length).toBeGreaterThan(0);
    expect(context.played[0]?.startAt).toBe(12);
  });

  it('続けて鳴らす音は、前の音の0.7秒あとに鳴らす', () => {
    const both = unlocked();
    const alone = unlocked();

    both.sound.play(['closed', 'reveal']);
    alone.sound.play(['reveal']);

    const reveal = both.context.played.slice(-alone.context.played.length);
    expect(reveal.map((tone) => tone.startAt)).toEqual(
      alone.context.played.map((tone) => expect.closeTo(tone.startAt + 0.7, 6)),
    );
  });

  it('音ごとに違う音を合成する', () => {
    const { sound, context } = unlocked();
    const toneOf = (cue: Parameters<typeof sound.play>[0][number]) => {
      const before = context.played.length;
      sound.play([cue]);
      return JSON.stringify(context.played.slice(before));
    };

    const tones = new Set([
      toneOf('question'),
      toneOf('closed'),
      toneOf('reveal'),
      toneOf('correct'),
      toneOf('incorrect'),
    ]);

    expect(tones.size).toBe(5);
  });

  it('作った時点で動いている AudioContext（前に操作したページなど）なら、そのまま鳴らせる', () => {
    const sound = createSoundPlayer({
      createContext: () => {
        const context = new FakeAudioContext();
        context.state = 'running';
        return context;
      },
    });

    sound.unlock();

    expect(sound.state.getState().ready).toBe(true);
  });

  it('鳴らす音がなければ、何も鳴らさない', () => {
    const { sound, context } = unlocked();

    sound.play([]);

    expect(context.played).toEqual([]);
  });
});

describe('自動再生が止められていても動き続ける', () => {
  it('まだ操作されていなければ、鳴らさずに戻る', () => {
    const { sound, contexts } = setup();

    expect(() => sound.play(['question'])).not.toThrow();
    expect(contexts).toEqual([]);
    expect(sound.state.getState().ready).toBe(false);
  });

  it('resume を断られても例外にせず、鳴らせないままにする', async () => {
    const { sound, contexts } = setup();
    sound.unlock();
    const [context] = contexts;
    if (context === undefined) {
      throw new Error('AudioContext が作られていない');
    }
    context.resumeFails = true;
    context.changeState('suspended');

    // 断られた Promise を受け止めていなければ、vitest が Unhandled Rejection で落とす
    sound.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sound.play(['question']);

    expect(sound.state.getState().ready).toBe(false);
    expect(context.played).toEqual([]);
  });

  it('Web Audio のないブラウザでは、何もせず、切り替えを出さないよう available を false にする', () => {
    const sound = createSoundPlayer({ createContext: null });

    expect(() => {
      sound.unlock();
      sound.play(['question']);
    }).not.toThrow();
    expect(sound.state.getState()).toMatchObject({ available: false, ready: false });
  });

  it('AudioContext を作れなければ、available を false にする', () => {
    const sound = createSoundPlayer({
      createContext: () => {
        throw new DOMException('作れない', 'NotSupportedError');
      },
    });

    expect(sound.state.getState().available).toBe(true);
    expect(() => sound.unlock()).not.toThrow();
    expect(sound.state.getState().available).toBe(false);
  });

  it('端末の都合で止まったら（iOS の interrupted など）鳴らさず、次の操作で戻す', () => {
    const { sound, context } = unlocked();

    context.changeState('interrupted' as AudioContextState);
    sound.play(['question']);
    expect(sound.state.getState().ready).toBe(false);
    expect(context.played).toEqual([]);

    sound.unlock();
    expect(sound.state.getState().ready).toBe(true);
  });

  it('画面のどこかを押すか、キーを押すと有効にする', () => {
    const { sound, contexts } = setup();
    const stop = unlockOnGestures(document, sound);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sound.state.getState().ready).toBe(true);

    contexts[0]?.changeState('suspended');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(sound.state.getState().ready).toBe(true);

    stop();
    contexts[0]?.changeState('suspended');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sound.state.getState().ready).toBe(false);
  });
});

describe('音の切り替えのボタンを押したとき', () => {
  it('画面のどこでも有効にする仕掛けは、切り替えのボタンを押したことには反応しない', () => {
    // 反応すると、1回のクリックで「有効にする」と切り替えの両方が動く。Chrome は操作の中で作った AudioContext を
    // その場で running にし、React はボタンの onClick より先に描き直すので、「音を有効にする」を押すと音が消えてしまう
    const { sound, contexts } = setup();
    const stop = unlockOnGestures(document, sound);
    const toggle = document.createElement('button');
    toggle.setAttribute(SOUND_TOGGLE_ATTRIBUTE, '');
    const label = document.createElement('span');
    toggle.append(label);
    document.body.append(toggle);

    label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    toggle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    stop();
    toggle.remove();

    expect(contexts).toEqual([]);
  });
});

describe('音を消す', () => {
  it('消しているあいだは鳴らさない', () => {
    const { sound, context } = unlocked();

    sound.setMuted(true);
    sound.play(['question']);

    expect(context.played).toEqual([]);
  });

  it('消したかどうかを localStorage に覚え、次に作ったときも消したままにする', () => {
    setup().sound.setMuted(true);

    expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBe('off');
    expect(setup().sound.state.getState().muted).toBe(true);
  });

  it('何も覚えていなければ、鳴らす状態で始める', () => {
    expect(setup().sound.state.getState().muted).toBe(false);
  });

  it('消しているあいだの操作では AudioContext を作らず、音を出すに戻したときに有効にする', () => {
    const { sound, contexts } = setup();
    sound.setMuted(true);

    sound.unlock();
    expect(contexts).toEqual([]);

    sound.setMuted(false);
    expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBe('on');
    expect(sound.state.getState()).toMatchObject({ muted: false, ready: true });
  });

  it('localStorage が使えなくても、このタブのあいだは切り替えられる', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('使えない', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('使えない', 'SecurityError');
    });
    const { sound } = setup();

    expect(sound.state.getState().muted).toBe(false);
    expect(() => sound.setMuted(true)).not.toThrow();
    expect(sound.state.getState().muted).toBe(true);
  });
});
