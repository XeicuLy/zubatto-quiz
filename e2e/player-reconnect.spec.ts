import { expect, test, type Page } from '@playwright/test';

import { tokenKey } from '../apps/web/src/features/player/token-storage';
import { loginAsHost } from './helpers/login';
import { countWebSockets, expectWaiting, joinRoom, PHONE, relayPlayerSocket, submitName } from './helpers/player';
import { createRoom } from './helpers/room';

/**
 * 回答者のつなぎ直しまわり（ADR 0004・A1・F19）。画面と部屋の DO は別々のテストで確かめてあるので、
 * ここでは本物のブラウザでしか確かめられないつなぎ目（localStorage・タブ・本物の close code）を押さえる。
 * 部屋は1つを使い回し、ケースごとにブラウザのコンテキスト（Cookie・localStorage）を分け、名前も変える
 */

test.use({ viewport: PHONE });

let room: { roomId: string; joinUrl: string };

/** 待機画面の参加者の一覧で、その名前と一致する人。「戻れない」と「戻れない2」のような名前を取り違えないよう、全体で比べる */
const participantsNamed = (player: Page, name: string) =>
  player.getByRole('list', { name: '参加者' }).getByText(name, { exact: true });

test.beforeAll(async ({ browser }) => {
  const host = await browser.newContext();
  await loginAsHost(host);
  room = await createRoom(host, {
    title: 'つなぎ直しの部屋',
    questions: [{ text: '1 + 1 は？', choices: ['1', '2'], correctIndex: 1 }],
  });
  await host.close();
});

test('読み込み直すと、名前を聞かずに同じ回答者として待機画面に戻る（F19）', async ({ page }) => {
  await joinRoom(page, room.joinUrl, 'リロード');

  await page.reload();

  await expectWaiting(page, 'リロード');
  await expect(page.getByLabel('名前')).toHaveCount(0);
  // join し直していれば同じ名前は断られるが、念のため、参加者が増えていないことも見る
  await expect(participantsNamed(page, 'リロード')).toHaveCount(1);
});

test('同じブラウザの別のタブで開くと、前のタブは閉じられ、つなぎ直さない（X1）', async ({ context, page }) => {
  const firstSockets = countWebSockets(page);
  await joinRoom(page, room.joinUrl, 'ふたつめ');

  // 同じコンテキストなので localStorage を共有し、あとのタブは保存した秘密で resume する
  const second = await context.newPage();
  await second.goto(room.joinUrl);
  await expectWaiting(second, 'ふたつめ');

  await expect(page.getByRole('heading', { name: '別のタブで開かれました' })).toBeVisible();
  // 前のタブがつなぎ直せば、あとのタブが閉じられる。最初のつなぎ直しの待ち（最長 500ms）より長く待って確かめる
  await page.waitForTimeout(1500);
  expect(firstSockets()).toBe(1);
  await expectWaiting(second, 'ふたつめ');
});

test('保存した秘密で戻れなければ、秘密を消して名前の入力に戻す', async ({ page }) => {
  await joinRoom(page, room.joinUrl, '戻れない');

  // 形は playerTokenSchema に通るので、部屋の DO まで届き、合う参加者がなくて resume_failed で閉じられる
  await page.evaluate(([key, token]) => localStorage.setItem(key, token), [tokenKey(room.roomId), 'A'.repeat(43)]);
  await page.reload();

  await expect(page.getByRole('heading', { name: '前回の参加には戻れませんでした' })).toBeVisible();
  await expect(page.getByLabel('名前')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), tokenKey(room.roomId))).toBeNull();

  // 前の名前はまだ部屋に残っているので、別の名前で入り直す
  await submitName(page, '戻れない2');
  await expectWaiting(page, '戻れない2');
});

test('接続が切れると「再接続中」を出し、つなぎ直したら待機画面に戻る（A1）', async ({ page }) => {
  const relay = await relayPlayerSocket(page);
  await joinRoom(page, room.joinUrl, '切れる');

  relay.cut();
  // 見える帯には role="status" を付けず、読み上げは __root に常にある領域が受け持つ（#110）
  const reconnecting = page.getByRole('paragraph').filter({ hasText: '接続が切れました。つなぎ直しています' });
  const announced = page.locator('[aria-live="polite"]');
  await expect(reconnecting).toBeVisible();
  await expect(announced).toHaveText('接続が切れました。つなぎ直しています');

  relay.restore();
  await expect(reconnecting).toBeHidden();
  await expect(announced).toHaveText('つながりました');
  await expectWaiting(page, '切れる');
  await expect(participantsNamed(page, '切れる')).toHaveCount(1);
});

test('別のブラウザで同じ名前を入れると、かぶっていると出て、入れ直せる（F2）', async ({ browser, page }) => {
  await joinRoom(page, room.joinUrl, 'かぶり');

  const other = await browser.newContext({ viewport: PHONE });
  const otherPage = await other.newPage();
  await otherPage.goto(room.joinUrl);
  await submitName(otherPage, 'かぶり');

  await expect(otherPage.getByRole('alert')).toHaveText(
    '「かぶり」はこの部屋でもう使われています。別の名前を入れてください。',
  );
  await expect(otherPage.getByLabel('名前')).toHaveValue('かぶり');

  await submitName(otherPage, 'かぶり2');
  await expectWaiting(otherPage, 'かぶり2');
  await other.close();
});

for (const roomId of ['not-a-room', 'A'.repeat(64)]) {
  test(`部屋 ID の形が違う /r/${roomId.slice(0, 12)}… は「ページが見つかりません」を出し、WebSocket を開かない`, async ({
    page,
  }) => {
    const sockets = countWebSockets(page);

    await page.goto(`/r/${roomId}`);

    await expect(page.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeVisible();
    await expect(page.getByLabel('名前')).toHaveCount(0);
    expect(sockets()).toBe(0);
  });
}
