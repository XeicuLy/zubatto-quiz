import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createAppRouter } from '@/router';

import { GUIDE_VIEWPORTS, hostSteps, playerSteps, type GuideStep } from './guide-steps';

async function openGuide() {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/guide'] }) });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return router;
}

/** 節の中の手順を、番号の順に、見出しと画像の組で読む */
function stepsIn(sectionName: string) {
  const section = screen.getByRole('region', { name: sectionName });
  return within(within(section).getByRole('list', { name: sectionName })).getAllByRole('listitem');
}

describe('使い方のページ', () => {
  it('ログインせずに開け、見出し「使い方」を出す', async () => {
    await openGuide();

    expect(await screen.findByRole('heading', { level: 1, name: '使い方' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('使い方 | ズバクイ'));
  });

  it.each<[string, readonly GuideStep[]]>([
    ['ホストの流れ', hostSteps],
    ['回答者の流れ', playerSteps],
  ])('「%s」に、手順を番号の順に、見出しと画像で並べる', async (sectionName, steps) => {
    await openGuide();
    await screen.findByRole('heading', { level: 1, name: '使い方' });

    const items = stepsIn(sectionName);
    expect(items).toHaveLength(steps.length);
    for (const [index, step] of steps.entries()) {
      const item = within(items[index]!);
      expect(item.getByRole('heading', { level: 3, name: step.heading })).toBeInTheDocument();
      expect(item.getByText(step.description)).toBeInTheDocument();
      // 画像の幅と高さを先に書き、読み込む前から場所を取る（読み込むと下の文がずれない）
      const image = item.getByRole('img', { name: step.alt });
      expect(image).toHaveAttribute('src', expect.stringContaining(`${step.image}.png`));
      expect(image).toHaveAttribute('width', String(GUIDE_VIEWPORTS[step.device].width));
      expect(image).toHaveAttribute('height', String(GUIDE_VIEWPORTS[step.device].height));
    }
  });

  it('ページの中の2つの流れへ飛べる。回答者がホストの手順を読み飛ばせる', async () => {
    await openGuide();

    const nav = await screen.findByRole('navigation', { name: 'このページの中身' });
    for (const sectionName of ['ホストの流れ', '回答者の流れ']) {
      const link = within(nav).getByRole('link', { name: sectionName });
      const section = screen.getByRole('region', { name: sectionName });
      expect(link).toHaveAttribute('href', `#${section.id}`);
    }
  });

  it('ホストの流れから、ログインの画面へ進める', async () => {
    await openGuide();

    const section = await screen.findByRole('region', { name: 'ホストの流れ' });
    expect(within(section).getByRole('link', { name: 'ホストとしてログインする' })).toHaveAttribute('href', '/login');
  });
});
