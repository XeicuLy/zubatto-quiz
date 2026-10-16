import { render, screen, within } from '@testing-library/react';
import type { FastestRevealed } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { FastestCorrect } from './FastestCorrect';
import type { Variant } from './variant';

const choices = ['演歌', 'アニソン', '洋楽ロック', '歌っていない'];
const id = (n: number) => `6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e${String(n).padStart(2, '0')}`;
const LONG_NAME = 'ながいながいなまえのさんじゅうもじくらいあるひとです';

const fastest: FastestRevealed = {
  type: 'fastest',
  questionId: 'q-3',
  correctIndex: 1,
  fastest: [
    { participantId: id(1), name: '🎍たろう🎍', elapsedMs: 840 },
    { participantId: id(2), name: 'はなこ', elapsedMs: 1020 },
    { participantId: id(3), name: '👨\u200D👩\u200D👧\u200D👦ファミリー', elapsedMs: 1370 },
  ],
  correctCount: 8,
  answeredCount: 16,
  ranksHidden: false,
  biggestClimber: { participantId: id(4), name: '経理のたなか', rankUp: 5 },
};

const variants: Variant[] = ['projector', 'mobile'];

function renderFastest(message: FastestRevealed, variant: Variant) {
  return render(<FastestCorrect fastest={message} questionIndex={2} choices={choices} variant={variant} />).container;
}

describe.each(variants)('② 最速正解の発表（F14・%s）', (variant) => {
  it('最速の3人を速い順に、名前と0.01秒単位の秒数で出す', () => {
    renderFastest(fastest, variant);

    const list = screen.getByRole('list', { name: '最速の3人' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringMatching(/🎍たろう🎍.*0\.84秒/),
      expect.stringMatching(/はなこ.*1\.02秒/),
      expect.stringMatching(/👨\u200D👩\u200D👧\u200D👦ファミリー.*1\.37秒/),
    ]);
  });

  it('正解した人数と、回答した人数を出す', () => {
    expect(renderFastest(fastest, variant)).toHaveTextContent('16人中 8人が正解');
  });

  it('一番順位を上げた人は、上げた幅だけを出す', () => {
    const container = renderFastest(fastest, variant);

    expect(container).toHaveTextContent('この問題で一番順位を上げた人');
    expect(container).toHaveTextContent(/経理のたなか\s*▲5つ上げた/);
    expect(container).not.toHaveTextContent(/\d+位/);
  });

  it('第1問など、順位を上げた人がいないときは出さない', () => {
    const container = renderFastest({ ...fastest, ranksHidden: false, biggestClimber: null }, variant);

    expect(container).not.toHaveTextContent('一番順位を上げた人');
  });

  it('正解が1人なら、その1人だけを出す', () => {
    renderFastest({ ...fastest, fastest: fastest.fastest.slice(0, 1), correctCount: 1 }, variant);

    expect(within(screen.getByRole('list', { name: '最速の3人' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('同じ秒数の人は、届いた順（入室した順）のまま並べる', () => {
    const tie = [
      { participantId: id(5), name: 'さとう', elapsedMs: 1000 },
      { participantId: id(6), name: 'すずき', elapsedMs: 1000 },
    ];
    renderFastest({ ...fastest, fastest: tie, correctCount: 2 }, variant);

    expect(
      within(screen.getByRole('list', { name: '最速の3人' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([expect.stringMatching(/さとう.*1\.00秒/), expect.stringMatching(/すずき.*1\.00秒/)]);
  });

  it('全員が不正解なら、正解者なしと出す', () => {
    const container = renderFastest({ ...fastest, fastest: [], correctCount: 0, biggestClimber: null }, variant);

    expect(container).toHaveTextContent('正解者なし');
    expect(screen.queryByRole('list', { name: '最速の3人' })).toBeNull();
    // spotlight の色は、正解者がいるときの見せ場にだけ使う
    expect(container.querySelector('[class*="spotlight"]')).toBeNull();
  });

  it('長い名前も全部を文字で持つ', () => {
    renderFastest({ ...fastest, fastest: [{ participantId: id(1), name: LONG_NAME, elapsedMs: 1200 }] }, variant);

    expect(screen.getByRole('list', { name: '最速の3人' })).toHaveTextContent(LONG_NAME);
  });

  it('名前は文字として出す（ADR 0004）', () => {
    const name = '<img src=x onerror=alert(1)>';
    const container = renderFastest(
      {
        ...fastest,
        fastest: [{ participantId: id(1), name, elapsedMs: 840 }],
        biggestClimber: { participantId: id(4), name, rankUp: 2 },
      },
      variant,
    );

    expect(container).toHaveTextContent(name);
    expect(container.querySelector('img')).toBeNull();
  });

  it('style 属性を使わず、Tailwind のクラスだけで書く', () => {
    expect(renderFastest(fastest, variant).querySelector('[style]')).toBeNull();
  });
});

describe('② 最速正解の発表の、大きさごとの違い', () => {
  it('投影では、問題の番号と正解の選択肢を見出しに出す', () => {
    const container = renderFastest(fastest, 'projector');

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('第3問の最速正解');
    expect(container).toHaveTextContent('正解は 2 アニソン');
  });

  it('投影では、最後の2問は順位を伏せていると出す', () => {
    const container = renderFastest({ ...fastest, ranksHidden: true }, 'projector');

    expect(container).toHaveTextContent('ここからの順位は、最終発表まで伏せています');
    expect(container).not.toHaveTextContent('一番順位を上げた人');
  });

  it('回答者画面では、最後の2問は何も足さない（自分の位置の欄で伏せていると出す）', () => {
    const container = renderFastest({ ...fastest, ranksHidden: true }, 'mobile');

    expect(container).not.toHaveTextContent('伏せています');
    expect(container).not.toHaveTextContent('一番順位を上げた人');
  });

  it('投影では画面の幅で伸びる大きさ、回答者画面では固定の大きさにする（F16）', () => {
    const projector = renderFastest(fastest, 'projector');
    expect(projector.querySelector('.text-hero')).not.toBeNull();

    const mobile = renderFastest(fastest, 'mobile');
    expect(mobile.querySelector('[class*="text-stage"], .text-hero, .text-timer, .p-stage')).toBeNull();
  });
});
