import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HostLobby } from './HostLobby';

const JOIN_URL = `https://zubakui.example/r/${'a'.repeat(64)}`;
const ROOM = { title: '内輪クイズ', questionCount: 10, phase: 'lobby', questionIndex: null } as const;
const TARO = { participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e61', name: 'たろう' };
const HANAKO = { participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e62', name: 'はなこ' };

describe('ホストの待機画面（F1・F3）', () => {
  it('問題セットの題名と問題の数を出す', () => {
    render(<HostLobby room={ROOM} participants={[]} joinUrl={JOIN_URL} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('内輪クイズ');
    expect(screen.getByText('全10問')).toBeInTheDocument();
  });

  it('参加用の URL を出す', () => {
    render(<HostLobby room={ROOM} participants={[]} joinUrl={JOIN_URL} />);

    expect(screen.getByText(JOIN_URL)).toBeInTheDocument();
  });

  it('参加者を入った順に並べ、人数と上限を出す', () => {
    render(<HostLobby room={ROOM} participants={[TARO, HANAKO]} joinUrl={JOIN_URL} />);

    const list = screen.getByRole('list', { name: /参加者/ });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['たろう', 'はなこ']);
    expect(screen.getByRole('heading', { name: /参加者/ })).toHaveTextContent('参加者2/ 50 人');
  });

  it('まだだれも入っていなければ、そう出す', () => {
    render(<HostLobby room={ROOM} participants={[]} joinUrl={JOIN_URL} />);

    expect(screen.getByText('まだだれも入っていません')).toBeInTheDocument();
  });

  it('名前を HTML として読まず、文字のまま出す（ADR 0004）', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { container } = render(<HostLobby room={ROOM} participants={[{ ...TARO, name }]} joinUrl={JOIN_URL} />);

    expect(screen.getByText(name)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('部屋を作ったあとの編集は、この部屋に反映されないと出す（ADR 0002）', () => {
    render(<HostLobby room={ROOM} participants={[]} joinUrl={JOIN_URL} />);

    expect(
      screen.getByText(/部屋を作ったあとに問題セットを編集しても、この部屋には反映されません/),
    ).toBeInTheDocument();
  });

  it('ホストも回答者として遊べるよう、参加用の URL を別のタブで開くリンクを出す（F2）', () => {
    render(<HostLobby room={ROOM} participants={[]} joinUrl={JOIN_URL} />);

    const link = screen.getByRole('link', { name: '回答者としても参加する' });
    expect(link).toHaveAttribute('href', JOIN_URL);
    expect(link).toHaveAttribute('target', '_blank');
  });
});
