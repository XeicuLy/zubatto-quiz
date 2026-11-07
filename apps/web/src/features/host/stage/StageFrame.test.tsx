import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { StageHeading } from './StageFrame';

describe('段階の見出し', () => {
  it('ref でフォーカスを受け、Tab の順番には入らない', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(
      <StageHeading ref={ref} className="text-question">
        部長が最初に歌った曲は？
      </StageHeading>,
    );

    act(() => ref.current?.focus());

    const heading = screen.getByRole('heading', { level: 1, name: '部長が最初に歌った曲は？' });
    expect(document.activeElement).toBe(heading);
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('投影に映るのでフォーカスの枠を出さず、問題文の改行を残す', () => {
    render(<StageHeading className="text-question">問題文</StageHeading>);

    expect(screen.getByRole('heading')).toHaveClass('focus-target', 'whitespace-pre-line');
  });

  it('大きさと置き方は呼ぶ側が足す', () => {
    render(<StageHeading className="text-stage-title">問題文</StageHeading>);

    expect(screen.getByRole('heading')).toHaveClass('text-stage-title', 'font-bold');
  });
});
