import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnswerButtons } from './AnswerButtons';

const choices = ['演歌', 'アニソン', '洋楽ロック', '歌っていない'];

describe('選択肢（F17）', () => {
  it.each([2, 3, 4])('%i択のときは、番号付きのボタンを%i個出す', (count) => {
    render(<AnswerButtons choices={choices.slice(0, count)} chosen={null} onChoose={() => {}} />);

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(
      choices.slice(0, count).map((choice, index) => `${index + 1}${choice}`),
    );
  });

  it('押した選択肢の番号（0から）で onChoose を呼ぶ', () => {
    const onChoose = vi.fn<(choiceIndex: number) => void>();
    render(<AnswerButtons choices={choices} chosen={null} onChoose={onChoose} />);

    fireEvent.click(screen.getByRole('button', { name: /アニソン/ }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('onChoose がなければ押せない一覧にし、自分の回答に印を付ける（F10）', () => {
    render(<AnswerButtons choices={choices} chosen={1} />);

    expect(screen.queryAllByRole('button')).toEqual([]);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '1演歌',
      '2アニソンあなたの回答',
      '3洋楽ロック',
      '4歌っていない',
    ]);
  });

  it('答えていなければ、どれにも印を付けない', () => {
    render(<AnswerButtons choices={choices} chosen={null} />);

    expect(screen.queryByText('あなたの回答')).toBeNull();
  });

  it('選択肢は文字として出す', () => {
    const choice = '<img src=x onerror=alert(1)>';
    const { container } = render(<AnswerButtons choices={[choice, 'b']} chosen={null} onChoose={() => {}} />);

    expect(screen.getByText(choice)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
