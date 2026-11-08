import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Announcer } from '@/components/a11y/Announcer';
import type { Variant } from '@/shared/results/variant';

import { liveRegion } from '../../../test/live-region';
import { ReconnectingOverlay } from './ReconnectingOverlay';

const variants: Variant[] = ['projector', 'mobile'];

describe.each(variants)('再接続中の重ね表示（%s）', (variant) => {
  it('渡した文を、中身の上に重ねて出す', () => {
    render(
      <ReconnectingOverlay variant={variant} message="接続が切れました。つなぎ直しています">
        <p>待機画面</p>
      </ReconnectingOverlay>,
    );

    expect(screen.getByText('接続が切れました。つなぎ直しています', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('待機画面')).toBeInTheDocument();
  });

  // jsdom（30.1.3）は inert でフォーカスを止めないので、inert の箱の中にあることを見る。止まることはブラウザで確かめた
  it('中身は inert の箱に入れ、押せなくする', () => {
    render(
      <ReconnectingOverlay variant={variant} message="つなぎ直しています">
        <button type="button">押す</button>
      </ReconnectingOverlay>,
    );

    expect(screen.getByRole('button', { name: '押す', hidden: true }).closest('[inert]')).not.toBeNull();
  });

  it('帯は inert の外に置き、中身と一緒に薄くしない', () => {
    render(
      <ReconnectingOverlay variant={variant} message="つなぎ直しています">
        <p>待機画面</p>
      </ReconnectingOverlay>,
    );

    expect(screen.getByText('つなぎ直しています').closest('[inert]')).toBeNull();
  });

  it('読み上げは呼ぶ側の useConnectionAnnouncement に任せ、role="status" も付けない', () => {
    render(
      <>
        <ReconnectingOverlay variant={variant} message="つなぎ直しています">
          <p>待機画面</p>
        </ReconnectingOverlay>
        <Announcer />
      </>,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(liveRegion('polite')).toBeEmptyDOMElement();
    expect(liveRegion('assertive')).toBeEmptyDOMElement();
  });
});

describe('大きさ', () => {
  it('projector は投影で読める大きさの文字にする', () => {
    render(
      <ReconnectingOverlay variant="projector" message="つなぎ直しています">
        <p>進行画面</p>
      </ReconnectingOverlay>,
    );

    expect(screen.getByText('つなぎ直しています').parentElement).toHaveClass('text-stage-label');
  });

  it('mobile は回答者画面の列の幅に収め、md: のクラスを使わない', () => {
    const { container } = render(
      <ReconnectingOverlay variant="mobile" message="つなぎ直しています">
        <p>回答者画面</p>
      </ReconnectingOverlay>,
    );

    expect(container.querySelector('.max-w-md')).not.toBeNull();
    expect(container.querySelector('[class*="md:"]')).toBeNull();
  });
});
