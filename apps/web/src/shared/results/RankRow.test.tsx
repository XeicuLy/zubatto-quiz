import { render, screen } from '@testing-library/react';
import type { FinalRanking as FinalRankingMessage } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { RankRow, type RankRowProps } from './RankRow';
import type { Variant } from './variant';

type RankedEntry = FinalRankingMessage['entries'][number];

const entry: RankedEntry = {
  participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e01',
  name: 'はなこ',
  rank: 2,
  totalScore: 7105,
};
const variants: Variant[] = ['projector', 'mobile'];
const emphases: RankRowProps['emphasis'][] = ['podium', 'rest'];

function renderRow(props: Partial<RankRowProps> = {}) {
  render(
    <ol>
      <RankRow entry={entry} variant="mobile" emphasis="podium" isMe={false} {...props} />
    </ol>,
  );
  return screen.getByRole('listitem');
}

describe.each(variants)('順位の行（%s）', (variant) => {
  it.each(emphases)('%s の行は、順位・名前・合計を出す', (emphasis) => {
    expect(renderRow({ variant, emphasis })).toHaveTextContent('2位はなこ7,105');
  });

  it('自分の行には「あなた」を付けて色を変える', () => {
    const row = renderRow({ variant, isMe: true });

    expect(row).toHaveTextContent('2位はなこあなた7,105');
    expect(row).toHaveClass('bg-primary', 'text-primary-foreground');
  });

  it('長い名前は1行で省略し、title で全文を見せる', () => {
    renderRow({ variant });

    expect(screen.getByTitle('はなこ')).toHaveClass('name-clip');
  });
});

describe('順位の行の見た目', () => {
  it('2位と3位は札にし、自分でなければカードの色にする', () => {
    expect(renderRow({ emphasis: 'podium' })).toHaveClass('rounded-panel', 'bg-card', 'font-bold');
  });

  it('4位から下は罫線で区切り、自分でなければ色を付けない', () => {
    const row = renderRow({ emphasis: 'rest' });

    expect(row).toHaveClass('border-b', 'break-inside-avoid');
    expect(row).not.toHaveClass('bg-card');
  });

  it('自分の行は、2位と3位でもカードの色を重ねない', () => {
    expect(renderRow({ emphasis: 'podium', isMe: true })).not.toHaveClass('bg-card');
  });

  it('投影では、順位と点の数字だけを font-numeral にする', () => {
    const row = renderRow({ variant: 'projector' });

    expect([...row.querySelectorAll('.font-numeral')].map((node) => node.textContent)).toEqual(['2', '7,105']);
  });

  it.each(emphases)('回答者画面の %s の行は、飾り文字も md: のクラスも使わない', (emphasis) => {
    const row = renderRow({ variant: 'mobile', emphasis, isMe: true });

    expect(row.querySelector('.font-numeral')).toBeNull();
    expect(row.parentElement?.querySelector('[class*="md:"]')).toBeNull();
  });
});
