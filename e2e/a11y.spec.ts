import { expect, test, type BrowserContext } from '@playwright/test';
import { MAX_LIMIT_MS, type CreateRoomResponse } from '@zubatto-quiz/protocol';

import { a11yViolations } from './helpers/axe';
import { loginAsHost } from './helpers/login';
import { joinRoom, PHONE } from './helpers/player';
import { createRoom } from './helpers/room';

/**
 * 画面のアクセシビリティを axe で調べる（親 #108）。役割と名前で探すテストでは見つからない ARIA の誤りなどを止める。
 * 回答者の画面とホストの画面を1回の進行で通し、要所で調べる
 */

const TITLE = 'a11y の部屋';
/** 投影する進行画面の大きさ（docs/design/README.md） */
const PROJECTOR = { width: 1600, height: 900 };

/** 部屋の持ち主。E2E のログインは呼ぶたびに新しいホストを作るので、閉じずにテストの終わりまで使う */
let hostContext: BrowserContext;
let room: CreateRoomResponse;

test.beforeAll(async ({ browser }) => {
  hostContext = await browser.newContext({ viewport: PROJECTOR });
  await loginAsHost(hostContext);
  // 締切はホストが「いま締め切る」で行う。テストが遅れても先に時間切れにならないよう、制限時間は上限にする
  room = await createRoom(hostContext, {
    title: TITLE,
    questions: [{ text: '1 + 1 は？', choices: ['1', '2'], correctIndex: 1, limitMs: MAX_LIMIT_MS }],
  });
});

test.afterAll(async () => {
  await hostContext.close();
});

test('参加フォーム・回答中・ホストのロビーと進行に、WCAG 2 の A と AA の違反がない', async ({ browser }) => {
  const host = await hostContext.newPage();
  await host.goto(`/rooms/${room.roomId}/host`);
  await expect(host.getByRole('heading', { name: TITLE })).toBeVisible();

  const playerContext = await browser.newContext({ viewport: PHONE });
  const player = await playerContext.newPage();

  await test.step('参加フォーム', async () => {
    await player.goto(room.joinUrl);
    await expect(player.getByLabel('名前')).toBeVisible();
    expect(await a11yViolations(player)).toEqual([]);
  });

  await test.step('ホストのロビー', async () => {
    await joinRoom(player, room.joinUrl, 'たろう');
    await expect(host.getByRole('list', { name: '参加者' }).getByRole('listitem')).toHaveText(['たろう']);
    expect(await a11yViolations(host)).toEqual([]);
  });

  await test.step('回答中と、ホストの受付中', async () => {
    await host.getByRole('button', { name: '第1問を出す' }).click();
    await host.getByRole('button', { name: '受付を始める' }).click();
    await expect(player.getByRole('button', { name: /^2\s*2$/ })).toBeVisible();
    expect(await a11yViolations(player)).toEqual([]);
    expect(await a11yViolations(host)).toEqual([]);
  });

  await test.step('ホストの ① 締切', async () => {
    // 答えてから締め切り、回答の分布に棒が出た状態で調べる
    await player.getByRole('button', { name: /^2\s*2$/ }).click();
    await expect(host.getByText('1/ 1 人')).toBeVisible();
    await host.getByRole('button', { name: 'いま締め切る' }).click();
    await expect(host.getByRole('list', { name: '回答の分布' })).toBeVisible();
    expect(await a11yViolations(host)).toEqual([]);
  });

  await playerContext.close();
});

// 上の「違反がない」が空振りしていないことを確かめる。違反を起こせば、ちゃんと集まる
test('名前のないボタンを入れると、違反として集まる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // 中身も aria-label もないボタンは、読み上げで何のボタンか分からない（button-name）。
  // e2e の tsconfig には DOM の型がないので、ブラウザで走らせる式を文字列で渡す
  await page.evaluate("document.body.append(document.createElement('button'))");

  expect((await a11yViolations(page)).map((violation) => violation.id)).toContain('button-name');
});
