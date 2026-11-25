import { expect, test, type Page } from '@playwright/test';
import { MAX_PARTICIPANTS, NAME_MAX_LENGTH } from '@zubatto-quiz/protocol';

import { Bot } from '../tools/loadtest/src/bot';
import { loginAsHost } from './helpers/login';
import { createRoom } from './helpers/room';

/**
 * 投影する待機画面が、スクロールなしの1画面に収まるかを確かめる（#335）。
 * 会場の全員が最初に見る画面で、やることは QR を読むことだけなので、進行の帯まで1枚に見えていてほしい。
 * 並びは jsdom では計算されないので、本物のブラウザで document の高さを測る
 */

const TITLE = '待機画面の大きさの部屋';
/** 会場の投影でよく使う大きさ。1440×900 は、ノート PC をそのまま映したとき */
const PROJECTORS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
] as const;

/** ふだんの長さの名前に、上限の長さの名前を1割まぜる。かぶった名前は断られるので、番号を付けて分ける */
const NAMES = Array.from({ length: MAX_PARTICIPANTS }, (_, i) => {
  if (i % 10 === 9) {
    return `${'ながいなまえ'.repeat(6)}${String(i).padStart(2, '0')}`.slice(-NAME_MAX_LENGTH);
  }
  const base = ['たろう', 'はなこ', '部長', '経理のたなか', 'さとう', 'Christopher', '🎍みかん🎍', 'すずき', 'やまだ'];
  return `${base[i % 10]}${Math.floor(i / 10) + 1}`;
});

/** 字体が読み込まれてから、ページ全体の高さと画面の高さを比べる */
async function expectFitsOnScreen(page: Page) {
  for (const viewport of PROJECTORS) {
    await page.setViewportSize(viewport);
    // e2e の tsconfig には DOM の型がないので、ブラウザで走らせる式を文字列で渡す
    const [scrollHeight, innerHeight] = await page.evaluate<[number, number]>(
      'document.fonts.ready.then(() => [document.documentElement.scrollHeight, window.innerHeight])',
    );
    expect(scrollHeight, `${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(innerHeight);
  }
}

test(`投影の待機画面は、${MAX_PARTICIPANTS}人が入っても、スクロールなしの1画面に収まる`, async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: PROJECTORS[0] });
  await loginAsHost(hostContext);
  const room = await createRoom(hostContext, {
    title: TITLE,
    questions: [{ text: '1 + 1 は？', choices: ['1', '2'], correctIndex: 1, limitMs: 10_000 }],
  });
  const host = await hostContext.newPage();
  await host.goto(`/rooms/${room.roomId}/host`);
  await expect(host.getByRole('heading', { name: TITLE })).toBeVisible();

  await test.step('まだだれも入っていない', async () => {
    await expect(host.getByText('まだだれも入っていません')).toBeVisible();
    await expectFitsOnScreen(host);
  });

  // 50人分の画面を開くと重いので、O2 のリハーサルのボット（tools/loadtest）を50体入れる。
  // Node の WebSocket は Origin を付けられるので、本物の回答者と同じく Origin の確かめ（ADR 0006）を通る
  const { origin } = new URL(host.url());
  const playUrl = `${origin.replace(/^http/, 'ws')}/api/rooms/${room.roomId}/ws/play`;
  const bots = await Promise.all(NAMES.map((name) => Bot.join(playUrl, origin, name, 'spread')));

  await test.step(`${MAX_PARTICIPANTS}人が入った`, async () => {
    await expect(host.getByRole('list', { name: '参加者' }).getByRole('listitem')).toHaveCount(MAX_PARTICIPANTS);
    await expectFitsOnScreen(host);
  });

  for (const bot of bots) {
    bot.socket.close();
  }
  await hostContext.close();
});
