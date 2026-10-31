import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/button';

import { GitHubMark } from './github-mark';

describe('GitHubMark', () => {
  it('ボタンに入れても読み上げに入らず、ボタンの名前は文字だけになる', () => {
    render(
      <Button>
        <GitHubMark />
        GitHub でログイン
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'GitHub でログイン' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('文字と同じ色で描く。明るい面でも暗い面でも、ボタンの文字の色に合う', () => {
    const { container } = render(<GitHubMark />);

    expect(container.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
  });
});
