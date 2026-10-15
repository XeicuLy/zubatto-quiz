import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { JoinForm } from './JoinForm';

function submit(name: string) {
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: '参加する' }));
}

describe('名前の入力（F2）', () => {
  it('名前を入れて押すと、前後の空白を除いた名前で入室する', () => {
    const onJoin = vi.fn<(name: string) => void>();
    render(<JoinForm notice={null} defaultName="" onJoin={onJoin} />);

    submit('  たろう ');

    expect(onJoin).toHaveBeenCalledWith('たろう');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ズバッとクイズ');
  });

  it.each([
    ['空', '   ', '名前を入れてください。'],
    ['33文字', 'あ'.repeat(33), '名前は32文字までです。'],
    ['見えない書式の文字', 'た\u200Bろう', '使えない文字が入っています。'],
  ])('%s の名前では入室せず、理由を出す', (_, name, message) => {
    const onJoin = vi.fn<(name: string) => void>();
    render(<JoinForm notice={null} defaultName="" onJoin={onJoin} />);

    submit(name);

    expect(onJoin).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('名前')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('断られて戻ったとき（ADR 0004）', () => {
  it('名前がかぶったら、その名前を残して、別の名前を入れるよう出す', () => {
    const onJoin = vi.fn<(name: string) => void>();
    render(<JoinForm notice="name_taken" defaultName="たろう" onJoin={onJoin} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '「たろう」はこの部屋でもう使われています。別の名前を入れてください。',
    );
    expect(screen.getByLabelText('名前')).toHaveValue('たろう');
    expect(screen.getByLabelText('名前')).toHaveAttribute('aria-invalid', 'true');

    submit('じろう');
    expect(onJoin).toHaveBeenCalledWith('じろう');
  });

  it('resume に失敗したら、前回に戻れなかったことを出し、名前から入り直してもらう', () => {
    render(<JoinForm notice="resume_failed" defaultName="" onJoin={vi.fn<(name: string) => void>()} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('前回の参加には戻れませんでした');
    expect(screen.getByLabelText('名前')).toHaveValue('');
  });

  it('かぶった名前は文字として出す（ADR 0004）', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <JoinForm notice="name_taken" defaultName={name} onJoin={vi.fn<(name: string) => void>()} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(`「${name}」`);
    expect(container.querySelector('img')).toBeNull();
  });
});
