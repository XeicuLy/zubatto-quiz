import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Announcer } from '@/components/a11y/Announcer';
import type { Variant } from '@/shared/results/variant';

import { liveRegion } from '../../../test/live-region';
import { StatusScreen } from './StatusScreen';

const variants: Variant[] = ['projector', 'mobile'];

describe.each(variants)('つなぎの画面（%s）', (variant) => {
  it('文を出し、読み上げ領域に渡す', async () => {
    render(<Announcer />);
    render(<StatusScreen variant={variant}>部屋に入っています…</StatusScreen>);

    expect(screen.getByRole('main')).toHaveTextContent('部屋に入っています…');
    await waitFor(() => expect(liveRegion('polite')).toHaveTextContent('部屋に入っています…'));
  });

  it('画面ごと現れるので、role="status" を付けない', () => {
    render(<StatusScreen variant={variant}>結果を集計しています</StatusScreen>);

    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('大きさ', () => {
  it('projector は画面の幅で伸びる文字にする', () => {
    render(<StatusScreen variant="projector">結果を集計しています</StatusScreen>);

    expect(screen.getByText('結果を集計しています')).toHaveClass('text-stage-title');
  });

  it('mobile は md: のクラスを使わず、max-w-md の列に収める', () => {
    const { container } = render(<StatusScreen variant="mobile">部屋に入っています…</StatusScreen>);

    expect(container.querySelector('[class*="md:"]')).toBeNull();
    expect(screen.getByRole('main')).toHaveClass('max-w-md');
  });
});
