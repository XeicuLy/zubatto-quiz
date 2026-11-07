import { render, screen, within } from '@testing-library/react';
import type { FinalRanking as FinalRankingMessage } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { FinalRanking } from './FinalRanking';
import type { Variant } from './variant';

const id = (n: number) => `6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e${String(n).padStart(2, '0')}`;
const LONG_NAME = 'ながいながいなまえのさんじゅうもじくらいあるひとです';
const variants: Variant[] = ['projector', 'mobile'];

const finalRanking: FinalRankingMessage = {
  type: 'finalRanking',
  questionCount: 10,
  entries: [
    { participantId: id(1), name: '🎍たろう🎍', rank: 1, totalScore: 7820 },
    { participantId: id(2), name: 'はなこ', rank: 2, totalScore: 7105 },
    { participantId: id(3), name: LONG_NAME, rank: 3, totalScore: 6930 },
    { participantId: id(4), name: 'Christopher-Alexander-Montgomery', rank: 4, totalScore: 6410 },
    { participantId: id(5), name: '部長', rank: 5, totalScore: 5980 },
    { participantId: id(6), name: '経理のたなか', rank: 5, totalScore: 5980 },
    { participantId: id(7), name: 'さとう', rank: 7, totalScore: 5215 },
  ],
};

function rowTexts(element: HTMLElement, role: 'row' | 'listitem') {
  return within(element)
    .getAllByRole(role)
    .map((row) => row.textContent);
}

describe.each(variants)('最終ランキング（F15・%s）', (variant) => {
  it('優勝・2〜3位・4位から下に分けて、全員の順位を出す', () => {
    render(<FinalRanking ranking={finalRanking} variant={variant} />);

    expect(screen.getByRole('region', { name: '優勝' })).toHaveTextContent('🎍たろう🎍7,820点');
    expect(rowTexts(screen.getByRole('list', { name: '2位と3位' }), 'listitem')).toEqual([
      '2位はなこ7,105',
      `3位${LONG_NAME}6,930`,
    ]);
    expect(rowTexts(screen.getByRole('list', { name: '4位から下' }), 'listitem')).toEqual([
      '4位Christopher-Alexander-Montgomery6,410',
      '5位部長5,980',
      '5位経理のたなか5,980',
      '7位さとう5,215',
    ]);
  });

  it('1位が同点なら、全員を優勝として出す', () => {
    const tie: FinalRankingMessage = {
      ...finalRanking,
      entries: [
        { participantId: id(1), name: 'たろう', rank: 1, totalScore: 7000 },
        { participantId: id(2), name: 'はなこ', rank: 1, totalScore: 7000 },
        { participantId: id(3), name: '部長', rank: 3, totalScore: 6000 },
      ],
    };
    render(<FinalRanking ranking={tie} variant={variant} />);

    const winners = screen.getByRole('region', { name: '優勝' });
    expect(winners).toHaveTextContent('たろう');
    expect(winners).toHaveTextContent('はなこ');
    expect(rowTexts(screen.getByRole('list', { name: '2位と3位' }), 'listitem')).toEqual(['3位部長6,000']);
    expect(screen.queryByRole('list', { name: '4位から下' })).toBeNull();
  });

  it('全部で何問・何人だったかを出す', () => {
    const { container } = render(<FinalRanking ranking={finalRanking} variant={variant} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('最終ランキング');
    expect(container).toHaveTextContent('全10問 / 7人');
  });

  it('参加者がいなければ、そう出す', () => {
    const { container } = render(<FinalRanking ranking={{ ...finalRanking, entries: [] }} variant={variant} />);

    expect(container).toHaveTextContent('参加者はいませんでした');
    expect(screen.queryByRole('region', { name: '優勝' })).toBeNull();
  });

  it('名前は文字として出す（ADR 0004）', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <FinalRanking
        ranking={{ ...finalRanking, entries: finalRanking.entries.map((entry) => ({ ...entry, name })) }}
        variant={variant}
      />,
    );

    expect(container).toHaveTextContent(name);
    expect(container.querySelector('img')).toBeNull();
  });

  it('style 属性を使わず、Tailwind のクラスだけで書く', () => {
    const { container } = render(<FinalRanking ranking={finalRanking} variant={variant} meId={id(1)} />);

    expect(container.querySelector('[style]')).toBeNull();
  });
});

describe('最終ランキングの、自分の強調と大きさ', () => {
  it.each([
    [id(1), '優勝'],
    [id(3), '2位と3位'],
    [id(6), '4位から下'],
  ])('回答者画面では、どの順位でも自分を強調する（%s は %s）', (meId, group) => {
    render(<FinalRanking ranking={finalRanking} variant="mobile" meId={meId} />);

    const mine = screen.getByText('あなた');
    expect(mine.closest('section, ol')).toHaveAccessibleName(group);
    expect(screen.getAllByText('あなた')).toHaveLength(1);
  });

  it('投影では画面の幅で伸びる大きさ、回答者画面では固定の大きさにする（F16）', () => {
    const projector = render(<FinalRanking ranking={finalRanking} variant="projector" />).container;
    expect(projector.querySelector('.text-question')).not.toBeNull();

    const mobile = render(<FinalRanking ranking={finalRanking} variant="mobile" />).container;
    expect(mobile.querySelector('[class*="text-stage"], .text-question, .p-stage, .gap-stage')).toBeNull();
    expect(mobile.querySelector('[class*="md:"]')).toBeNull();
  });
});

/** その要素の中で font-numeral を付けた要素の文字。単位（位・点）は本文の字体なので入らない */
const numeralsIn = (element: Element) => [...element.querySelectorAll('.font-numeral')].map((node) => node.textContent);

describe('ランキングの字体（飾り文字は投影の数字だけ）', () => {
  it('投影の最終ランキングは、優勝・2〜3位・4位から下のどれも、順位と点の数字だけを font-numeral にする', () => {
    render(<FinalRanking ranking={finalRanking} variant="projector" />);

    const listItems = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem');
    expect(numeralsIn(screen.getByRole('region', { name: '優勝' }))).toEqual(['7,820']);
    expect(listItems('2位と3位').map(numeralsIn)).toEqual([
      ['2', '7,105'],
      ['3', '6,930'],
    ]);
    expect(listItems('4位から下').map(numeralsIn)).toEqual([
      ['4', '6,410'],
      ['5', '5,980'],
      ['5', '5,980'],
      ['7', '5,215'],
    ]);
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveClass('font-numeral');
  });

  it('回答者画面の最終ランキングは、飾り文字を使わない', () => {
    const { container } = render(<FinalRanking ranking={finalRanking} variant="mobile" />);

    expect(container.querySelector('.font-numeral, .font-display')).toBeNull();
  });
});
