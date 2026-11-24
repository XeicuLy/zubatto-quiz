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
  it('鳴らせるときは「音を止める」を出し、押すと止めて「音を出す」に変わる', () => {
    const sound = soundWith(new FakeAudioContext());
    act(() => sound.unlock());
    render(<SoundToggle sound={sound} />);

    fireEvent.click(screen.getByRole('button', { name: '音を止める' }));

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
    expect(screen.getByRole('button', { name: '音を止める' })).toBeInTheDocument();
  });

  it('まだ操作していない（読み込み直して入った）ときも、消していたときと同じ「音を出す」を出し、押すと鳴らせるようにする', () => {
    const sound = soundWith(new FakeAudioContext());
    render(<SoundToggle sound={sound} />);

    fireEvent.click(screen.getByRole('button', { name: '音を出す' }));

    expect(sound.state.getState().ready).toBe(true);
    expect(screen.getByRole('button', { name: '音を止める' })).toBeInTheDocument();
  });

  it('自動再生を止められて有効にできなくても、「音を出す」のまま押し直せる', async () => {
    const context = new FakeAudioContext();
    context.resumeFails = true;
    const sound = soundWith(context);
    render(<SoundToggle sound={sound} />);

    fireEvent.click(screen.getByRole('button', { name: '音を出す' }));
    await act(() => Promise.resolve());

    expect(screen.getByRole('button', { name: '音を出す' })).toBeEnabled();
  });

  it('画面のどこでも有効にする仕掛け（unlockOnGestures）に、自分を押したことを任せない印を付ける', () => {
    const sound = soundWith(new FakeAudioContext());
    render(<SoundToggle sound={sound} />);

    expect(screen.getByRole('button', { name: '音を出す' })).toHaveAttribute(SOUND_TOGGLE_ATTRIBUTE);
  });

  it('Web Audio のないブラウザでは出さない', () => {
    const { container } = render(<SoundToggle sound={soundWith(null)} />);

    expect(container).toBeEmptyDOMElement();
  });
});
