import { render, screen, within } from '@testing-library/react';
import type { Standings } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { StandingsRanking } from './StandingsRanking';
import type { Variant } from './variant';

const id = (n: number) => `6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e${String(n).padStart(2, '0')}`;
const LONG_NAME = 'ながいながいなまえのさんじゅうもじくらいあるひとです';
const variants: Variant[] = ['projector', 'mobile'];

/** 同点を含む途中経過。同じ順位の人は、サーバーが入室した順に並べて送る */
const standings: Standings = {
  type: 'standings',
  questionId: 'q-3',
  questionIndex: 2,
  participantCount: 18,
  entries: [
    { participantId: id(1), name: '🎍たろう🎍', rank: 1, totalScore: 2980, points: 1000 },
    { participantId: id(2), name: 'はなこ', rank: 2, totalScore: 2845, points: 912 },
    { participantId: id(3), name: LONG_NAME, rank: 2, totalScore: 2845, points: 843 },
    { participantId: id(4), name: '部長', rank: 4, totalScore: 2205, points: 0 },
  ],
};

function rowTexts(element: HTMLElement, role: 'row' | 'listitem') {
  return within(element)
    .getAllByRole(role)
    .map((row) => row.textContent);
}

describe.each(variants)('③ 途中経過（F15・%s）', (variant) => {
  it('上位の人を順位・名前・この問題の点・合計で出し、同点は同じ順位にする', () => {
    render(<StandingsRanking standings={standings} variant={variant} />);

    const table = screen.getByRole('table', { name: '途中経過' });
    expect(rowTexts(table, 'row').slice(1)).toEqual([
      '1位🎍たろう🎍+1,0002,980',
      '2位はなこ+9122,845',
      `2位${LONG_NAME}+8432,845`,
      '4位部長+02,205',
    ]);
  });

  it('何問目までの途中経過か、何人中の上位かを出す', () => {
    const { container } = render(<StandingsRanking standings={standings} variant={variant} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('途中経過（第3問まで）');
    expect(container).toHaveTextContent('上位4人 / 18人');
  });

  it('長い名前は1行で省略し、title で全文を見せる', () => {
    render(<StandingsRanking standings={standings} variant={variant} />);

    expect(screen.getByTitle(LONG_NAME)).toHaveClass('name-clip');
  });

  it('名前は文字として出す（ADR 0004）', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <StandingsRanking standings={{ ...standings, entries: [{ ...standings.entries[0], name }] }} variant={variant} />,
    );

    expect(container).toHaveTextContent(name);
    expect(container.querySelector('img')).toBeNull();
  });

  it('style 属性を使わず、Tailwind のクラスだけで書く', () => {
    const { container } = render(<StandingsRanking standings={standings} variant={variant} meId={id(2)} />);

    expect(container.querySelector('[style]')).toBeNull();
  });
});

describe('③ 途中経過の、自分の行の強調', () => {
  it('回答者画面では、自分が上位に入っていれば、その行だけを強調する', () => {
    render(<StandingsRanking standings={standings} variant="mobile" meId={id(3)} />);

    const rows = within(screen.getByRole('table', { name: '途中経過' })).getAllByRole('row');
    const mine = rows.filter((row) => within(row).queryByText('あなた') !== null);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveTextContent(LONG_NAME);
  });

  it('自分が上位に入っていなければ、どの行も強調しない', () => {
    render(<StandingsRanking standings={standings} variant="mobile" meId={id(9)} />);

    expect(screen.queryByText('あなた')).toBeNull();
  });

  it('進行画面では自分を渡さないので、強調しない', () => {
    render(<StandingsRanking standings={standings} variant="projector" />);

    expect(screen.queryByText('あなた')).toBeNull();
  });
});

/** その要素の中で font-numeral を付けた要素の文字。単位（位・点）は本文の字体なので入らない */
const numeralsIn = (element: Element) => [...element.querySelectorAll('.font-numeral')].map((node) => node.textContent);

describe('ランキングの字体（飾り文字は投影の数字だけ）', () => {
  it('投影の途中経過は、どの行も順位と合計の数字だけを font-numeral にする', () => {
    render(<StandingsRanking standings={standings} variant="projector" />);

    const rows = within(screen.getByRole('table', { name: '途中経過' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows.map(numeralsIn)).toEqual([
      ['1', '2,980'],
      ['2', '2,845'],
      ['2', '2,845'],
      ['4', '2,205'],
    ]);
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveClass('font-numeral');
  });

  it('回答者画面の途中経過は、飾り文字を使わない', () => {
    const { container } = render(<StandingsRanking standings={standings} variant="mobile" />);

    expect(container.querySelector('.font-numeral, .font-display')).toBeNull();
  });
});
