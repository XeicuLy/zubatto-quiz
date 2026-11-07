import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Variant } from '@/shared/results/variant';

import { TimeBar } from './TimeBar';

const variants: Variant[] = ['projector', 'mobile'];

/** 縮む中の棒。外の箱（溝）の唯一の子 */
function fillOf(container: HTMLElement) {
  const fill = container.firstElementChild?.firstElementChild;
  if (!(fill instanceof HTMLElement)) {
    throw new Error('棒が見つからない');
  }
  return fill;
}

describe.each(variants)('残り時間の棒（%s）', (variant) => {
  it('残りの割合を幅にし、渡した時間をかけて縮める', () => {
    const { container } = render(<TimeBar ratio={0.25} transitionMs={400} variant={variant} />);

    expect(fillOf(container)).toHaveStyle({ width: '25%', transitionDuration: '400ms' });
  });

  it('締切を過ぎた割合（負の値）は0にする', () => {
    const { container } = render(<TimeBar ratio={-0.1} transitionMs={0} variant={variant} />);

    expect(fillOf(container)).toHaveStyle({ width: '0%', transitionDuration: '0ms' });
  });

  it('数字の残り時間と同じことなので、読み上げない', () => {
    const { container } = render(<TimeBar ratio={1} transitionMs={0} variant={variant} />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('太さ', () => {
  it('projector は離れた席から見えるよう太くする', () => {
    const { container } = render(<TimeBar ratio={1} transitionMs={0} variant="projector" />);

    expect(container.firstElementChild).toHaveClass('h-3');
  });

  it('mobile は細くし、md: のクラスを使わない', () => {
    const { container } = render(<TimeBar ratio={1} transitionMs={0} variant="mobile" />);

    expect(container.firstElementChild).toHaveClass('h-2');
    expect(container.querySelector('[class*="md:"]')).toBeNull();
  });
});
