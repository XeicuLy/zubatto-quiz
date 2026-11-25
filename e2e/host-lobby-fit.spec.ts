import { expect, test, type Browser, type Page } from '@playwright/test';
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

/** 上限の長さ（32文字）の名前。かぶった名前は断られるので、末尾の番号で分ける */
const longName = (i: number) => `${'ながいなまえ'.repeat(6)}${String(i).padStart(2, '0')}`.slice(-NAME_MAX_LENGTH);

/** ふだんの長さの名前に、上限の長さの名前を1割まぜる */
const MIXED_NAMES = Array.from({ length: MAX_PARTICIPANTS }, (_, i) => {
  if (i % 10 === 9) {
    return longName(i);
  }
  const base = ['たろう', 'はなこ', '部長', '経理のたなか', 'さとう', 'Christopher', '🎍みかん🎍', 'すずき', 'やまだ'];
  return `${base[i % 10]}${Math.floor(i / 10) + 1}`;
});

/** 全員が上限の長さの名前。チップがいちばん広くなり、1行に並ぶ人数がいちばん少なくなる */
const longNames = (count: number) => Array.from({ length: count }, (_, i) => longName(i));

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

/** 新しいホストで部屋を作り、投影の大きさで待機画面を開く */
async function openLobby(browser: Browser) {
  const context = await browser.newContext({ viewport: PROJECTORS[0] });
  await loginAsHost(context);
  const room = await createRoom(context, {
    title: TITLE,
    questions: [{ text: '1 + 1 は？', choices: ['1', '2'], correctIndex: 1, limitMs: 10_000 }],
  });
  const host = await context.newPage();
  await host.goto(`/rooms/${room.roomId}/host`);
  await expect(host.getByRole('heading', { name: TITLE })).toBeVisible();
  return { context, host, roomId: room.roomId };
}

/**
 * 人数分の画面を開くと重いので、O2 のリハーサルのボット（tools/loadtest）を入れ、待機画面に全員が並ぶまで待つ。
 * Node の WebSocket は Origin を付けられるので、本物の回答者と同じく Origin の確かめ（ADR 0006）を通る
 */
async function joinBots(host: Page, roomId: string, names: readonly string[]): Promise<Bot[]> {
  const { origin } = new URL(host.url());
  const playUrl = `${origin.replace(/^http/, 'ws')}/api/rooms/${roomId}/ws/play`;
  const bots = await Promise.all(names.map((name) => Bot.join(playUrl, origin, name, 'spread')));
  await expect(host.getByRole('list', { name: '参加者' }).getByRole('listitem')).toHaveCount(names.length);
  return bots;
}

test(`投影の待機画面は、だれもいないときも${MAX_PARTICIPANTS}人が入っても、スクロールなしの1画面に収まる`, async ({
  browser,
}) => {
  const { context, host, roomId } = await openLobby(browser);

  await test.step('まだだれも入っていない', async () => {
    await expect(host.getByText('まだだれも入っていません')).toBeVisible();
    await expectFitsOnScreen(host);
  });

  const bots = await joinBots(host, roomId, MIXED_NAMES);
  await test.step(`${MAX_PARTICIPANTS}人が入った`, async () => {
    await expectFitsOnScreen(host);
  });

  for (const bot of bots) {
    bot.socket.close();
  }
  await context.close();
});

// 30人までは名前の長さに合わせたチップを折り返し、31人からは幅のそろった格子に並べる（HostLobby の LOOSE_MAX_PARTICIPANTS）。
// どちらの並べ方でも、名前がいちばん長いときに収まることを確かめる。9文字ほどの名前も、上限の幅のチップになるので、この中に入る
for (const count of [30, MAX_PARTICIPANTS]) {
  test(`全員が上限の長さの名前の${count}人でも、投影の待機画面はスクロールなしの1画面に収まる`, async ({ browser }) => {
    const { context, host, roomId } = await openLobby(browser);

    const bots = await joinBots(host, roomId, longNames(count));
    await expectFitsOnScreen(host);

    for (const bot of bots) {
      bot.socket.close();
    }
    await context.close();
  });
}
