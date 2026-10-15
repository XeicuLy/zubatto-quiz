import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WaitingRoom } from './WaitingRoom';

const participants = [
  { participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e61', name: 'たろう' },
  { participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e62', name: 'はなこ' },
  { participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e63', name: '👨\u200D👩\u200D👧' },
];

describe('待機画面（F3）', () => {
  it('自分の名前・人数・参加者の名前を出す', () => {
    render(<WaitingRoom name="たろう" participants={participants} persisted />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('たろう');
    expect(screen.getByText('ホストが始めるのを待っています')).toBeInTheDocument();
    expect(screen.getByText('3', { exact: true })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: '参加者' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['たろう', 'はなこ', '👨\u200D👩\u200D👧']);
  });

  it('名前は文字として出す（ADR 0004）', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <WaitingRoom name={name} participants={[{ participantId: participants[0].participantId, name }]} persisted />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(name);
    expect(within(screen.getByRole('list', { name: '参加者' })).getByText(name)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('秘密を保存できなかったときは、読み込み直すと戻れないことを出す', () => {
    const { rerender } = render(<WaitingRoom name="たろう" participants={participants} persisted />);
    expect(screen.queryByText(/読み込み直すと/)).toBeNull();

    rerender(<WaitingRoom name="たろう" participants={participants} persisted={false} />);
    expect(screen.getByText(/読み込み直すと/)).toBeInTheDocument();
  });
});
