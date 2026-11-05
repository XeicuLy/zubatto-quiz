import { render, screen } from '@testing-library/react';
import { encode } from 'uqr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JoinQrCode } from './JoinQrCode';

vi.mock('uqr', { spy: true });

const joinUrl = (id: string) => `https://zubakui.example/r/${id.repeat(64)}`;

const qrImage = () => screen.getByRole('img', { name: '参加用 URL の QR コード' });
const pathOf = (svg: Element) => svg.querySelector('path')?.getAttribute('d') ?? '';

describe('参加用 URL の QR コード（F1）', () => {
  beforeEach(() => {
    vi.mocked(encode).mockClear();
  });

  it('画像として、何の QR かを読み上げられる', () => {
    render(<JoinQrCode url={joinUrl('a')} />);

    expect(qrImage().tagName).toBe('svg');
  });

  it('URL が変わると、描くマスも変わる', () => {
    const { rerender } = render(<JoinQrCode url={joinUrl('a')} />);
    const first = pathOf(qrImage());
    rerender(<JoinQrCode url={joinUrl('b')} />);

    expect(first).not.toBe('');
    expect(pathOf(qrImage())).not.toBe(first);
  });

  // 参加者が入るたびに待機画面は描き直される。計算し直さないのは React Compiler の働きなので、回数で確かめる
  it('同じ URL で描き直しても計算し直さず、URL が変わったときだけ計算する', () => {
    const { rerender } = render(<JoinQrCode url={joinUrl('a')} />);
    rerender(<JoinQrCode url={joinUrl('a')} />);
    expect(encode).toHaveBeenCalledTimes(1);

    rerender(<JoinQrCode url={joinUrl('b')} />);
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it('まわりに4マスの余白（クワイエットゾーン）を空ける', () => {
    render(<JoinQrCode url={joinUrl('a')} />);
    const svg = qrImage();
    const d = pathOf(svg);
    const size = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
    // 黒い四角は M{x} {y}h{width} で始まる
    const squares = [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].map(([, x, y, width]) => ({
      x: Number(x),
      y: Number(y),
      width: Number(width),
    }));

    expect(Math.min(...squares.map((square) => square.x))).toBe(4);
    expect(Math.min(...squares.map((square) => square.y))).toBe(4);
    expect(Math.max(...squares.map((square) => square.x + square.width))).toBe(size - 4);
    expect(Math.max(...squares.map((square) => square.y + 1))).toBe(size - 4);
  });
});
