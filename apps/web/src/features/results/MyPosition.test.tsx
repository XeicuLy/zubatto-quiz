import { render } from '@testing-library/react';
import type { PlayerPosition } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { goalOf, MyPosition } from './MyPosition';

function renderPosition(position: PlayerPosition, remainingQuestions = 7) {
  return render(
    <MyPosition
      position={position}
      totalScore={2410}
      remainingMaxPoints={remainingQuestions * 1000}
      remainingQuestions={remainingQuestions}
    />,
  ).container;
}

describe('次の目標（goalOf）', () => {
  // 「1つ上の人」との差を、順位の数字を漏らさずに言う。[自分の位置, 出す1行]
  it.each<[PlayerPosition, ReturnType<typeof goalOf>]>([
    [
      { kind: 'leader', rankUp: 0, leadOverNext: 120 },
      { label: '2位との差', points: 120 },
    ],
    [
      { kind: 'leader', rankUp: 0, leadOverNext: 0 },
      { label: '2位との差', points: 0 },
    ],
    [{ kind: 'leader', rankUp: 0, leadOverNext: null }, null],
    [
      { kind: 'podium', rank: 2, rankUp: 0, gapToAbove: 80 },
      { label: '1位まで あと', points: 80 },
    ],
    [
      { kind: 'podium', rank: 3, rankUp: 0, gapToAbove: 435 },
      { label: '2位まで あと', points: 435 },
    ],
    [
      { kind: 'chasing', rankUp: 0, gapToAbove: 224, gapToTop: 1104 },
      { label: '1つ上の人まで あと', points: 224 },
    ],
    [{ kind: 'hidden' }, null],
  ])('%o は %o', (position, expected) => {
    expect(goalOf(position)).toEqual(expected);
  });
});

describe('回答者画面の自分の位置（F15）', () => {
  describe('1〜3位', () => {
    it('1位なら、順位と2位との差と合計を出す', () => {
      const container = renderPosition({ kind: 'leader', rankUp: 0, leadOverNext: 120 });

      expect(container).toHaveTextContent('1位');
      expect(container).toHaveTextContent('2位との差 120点');
      expect(container).toHaveTextContent('合計 2,410点');
    });

    it('ほかに回答者がいない1位なら、2位との差を出さない', () => {
      const container = renderPosition({ kind: 'leader', rankUp: 0, leadOverNext: null });

      expect(container).toHaveTextContent('1位');
      expect(container).not.toHaveTextContent('2位');
    });

    it('2・3位なら、順位と、1つ上の順位までの差を出す', () => {
      const container = renderPosition({ kind: 'podium', rank: 3, rankUp: 0, gapToAbove: 435 });

      expect(container).toHaveTextContent('3位');
      expect(container).toHaveTextContent('2位まで あと 435点');
      expect(container).not.toHaveTextContent('残り');
    });
  });

  describe('4位以下', () => {
    it('順位の数字は出さず、1つ上の人との差・トップとの差・残りで取れる最大の点を出す', () => {
      const container = renderPosition({ kind: 'chasing', rankUp: 0, gapToAbove: 224, gapToTop: 1104 });

      expect(container).not.toHaveTextContent(/\d+位/);
      expect(container).toHaveTextContent('1つ上の人まで あと 224点');
      // 合計とトップとの差は、dt と dd に分けて並べる
      expect(container).toHaveTextContent(/トップとの差\s*1,104点/);
      expect(container).toHaveTextContent(/合計\s*2,410点/);
      expect(container).toHaveTextContent('残り7問で、最大 7,000点 取れます');
    });
  });

  describe('順位が上がったときの矢印', () => {
    it.each<[PlayerPosition, string]>([
      [{ kind: 'leader', rankUp: 1, leadOverNext: 120 }, '▲1つ 順位が上がりました'],
      [{ kind: 'podium', rank: 3, rankUp: 2, gapToAbove: 435 }, '▲2つ 順位が上がりました'],
      [{ kind: 'chasing', rankUp: 5, gapToAbove: 224, gapToTop: 1104 }, '▲5つ 順位が上がりました'],
    ])('上がったら、上げた幅と一緒に出す（%o）', (position, expected) => {
      expect(renderPosition(position)).toHaveTextContent(expected);
    });

    it.each<PlayerPosition>([
      { kind: 'leader', rankUp: 0, leadOverNext: 120 },
      { kind: 'podium', rank: 3, rankUp: 0, gapToAbove: 435 },
      { kind: 'chasing', rankUp: 0, gapToAbove: 224, gapToTop: 1104 },
    ])('上がらなかったら（下がったときも）出さない（%o）', (position) => {
      const container = renderPosition(position);

      expect(container).not.toHaveTextContent('▲');
      expect(container).not.toHaveTextContent('順位が上がりました');
    });
  });

  describe('最後の2問', () => {
    it('順位と差を伏せ、最終発表まで伏せていると出す', () => {
      const container = renderPosition({ kind: 'hidden' }, 1);

      expect(container).toHaveTextContent('ここからの順位は、最終発表まで伏せています');
      expect(container).not.toHaveTextContent(/\d+位|あと|差/);
      expect(container).toHaveTextContent('残り1問で、最大 1,000点 取れます');
    });

    it('最後の問題では、残りで取れる点を出さない', () => {
      const container = renderPosition({ kind: 'hidden' }, 0);

      expect(container).toHaveTextContent('最終発表まで伏せています');
      expect(container).not.toHaveTextContent('残り');
    });
  });

  it('style 属性を使わず、Tailwind のクラスだけで書く', () => {
    const container = renderPosition({ kind: 'chasing', rankUp: 5, gapToAbove: 224, gapToTop: 1104 });

    expect(container.querySelector('[style]')).toBeNull();
  });
});
