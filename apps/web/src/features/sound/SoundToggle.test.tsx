import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeAudioContext } from '../../../test/fake-sound';
import { createSoundPlayer, SOUND_STORAGE_KEY, SOUND_TOGGLE_ATTRIBUTE } from './sound-player';
import { SoundToggle } from './SoundToggle';

function soundWith(context: FakeAudioContext | null) {
  return createSoundPlayer({ createContext: context === null ? null : () => context });
}

beforeEach(() => {
  localStorage.clear();
});

describe('音の切り替え（F18）', () => {
  it('鳴らせるときは「音を消す」を出し、押すと消して「音を出す」に変わる', () => {
    const sound = soundWith(new FakeAudioContext());
    act(() => sound.unlock());
    render(<SoundToggle sound={sound} />);

    fireEvent.click(screen.getByRole('button', { name: '音を消す' }));

    expect(sound.state.getState().muted).toBe(true);
    expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBe('off');
    expect(screen.getByRole('button', { name: '音を出す' })).toBeInTheDocument();
  });

  it('消していたら「音を出す」を出し、押すと鳴らせるようにする', () => {
    localStorage.setItem(SOUND_STORAGE_KEY, 'off');
    const sound = soundWith(new FakeAudioContext());
    render(<SoundToggle sound={sound} />);

    fireEvent.click(screen.getByRole('button', { name: '音を出す' }));

    expect(sound.state.getState()).toMatchObject({ muted: false, ready: true });
    expect(screen.getByRole('button', { name: '音を消す' })).toBeInTheDocument();
  });

  it('まだ操作していない（読み込み直して入った）ときは「音を有効にする」を出し、押すと鳴らせるようにする', () => {
    const sound = soundWith(new FakeAudioContext());
    render(<SoundToggle sound={sound} />);

    fireEvent.click(screen.getByRole('button', { name: '音を有効にする' }));

    expect(sound.state.getState().ready).toBe(true);
    expect(screen.getByRole('button', { name: '音を消す' })).toBeInTheDocument();
  });

  it('自動再生を止められて有効にできなくても、「音を有効にする」のまま押し直せる', async () => {
    const context = new FakeAudioContext();
    context.resumeFails = true;
    const sound = soundWith(context);
    render(<SoundToggle sound={sound} />);

    fireEvent.click(screen.getByRole('button', { name: '音を有効にする' }));
    await act(() => Promise.resolve());

    expect(screen.getByRole('button', { name: '音を有効にする' })).toBeEnabled();
  });

  it('画面のどこでも有効にする仕掛け（unlockOnGestures）に、自分を押したことを任せない印を付ける', () => {
    const sound = soundWith(new FakeAudioContext());
    render(<SoundToggle sound={sound} />);

    expect(screen.getByRole('button', { name: '音を有効にする' })).toHaveAttribute(SOUND_TOGGLE_ATTRIBUTE);
  });

  it('Web Audio のないブラウザでは出さない', () => {
    const { container } = render(<SoundToggle sound={soundWith(null)} />);

    expect(container).toBeEmptyDOMElement();
  });
});
