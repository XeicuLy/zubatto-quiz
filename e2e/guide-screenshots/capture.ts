import { fileURLToPath } from 'node:url';

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  GUIDE_VIEWPORTS,
  hostSteps,
  playerSteps,
  type GuideImage,
} from '../../apps/web/src/features/guide/guide-steps';
import { loginAsHost } from '../helpers/login';
import { expectWaiting, joinRoom, submitName } from '../helpers/player';

/**
 * 使い方のページ（/guide）の画像を撮り直す。e2e:serve に、ホスト1人と回答者3人で1回遊び、要所で撮る。
 * 画面を変えたら、次で撮り直して差分を見る（docs/architecture/testing.md の「使い方の画像を撮り直す」）。
 *
 *   pnpm run guide:shots
 *
 * 写る名前と問題は、ここに書いた仮のもの。部屋の ID と QR は e2e の手元の部屋のもので、本番では開けない
 */

const IMAGES_DIR = fileURLToPath(new URL('../../apps/web/src/features/guide/images/', import.meta.url));

const TITLE = 'ズバクイ体験会';
/**
 * correct は正解の番号（0から）。締切はホストが「いま締め切る」で行うので、制限時間は長めにする。
 * 第1問は2択にする。編集画面の画像（1280×800）に、名前から制限時間までの欄が収まる
 */
const QUESTIONS = [
  { text: '1 + 1 は？', choices: ['1', '2'], correct: 1 },
  { text: '日本でいちばん高い山は？', choices: ['富士山', '北岳', '奥穂高岳', '槍ヶ岳'], correct: 0 },
  { text: '晴れた日の空の色は？', choices: ['赤', '青', '緑', '黄'], correct: 1 },
  { text: '日本の首都は？', choices: ['大阪', '東京', '京都'], correct: 1 },
] as const;
/**
 * 遊ぶ画面を撮る問題（0から）。選択肢の4色が並ぶ4択にする。
 * 最後の2問は回答者の順位を伏せる（F15）ので、そこに入らない問題にする
 */
const SHOT_QUESTION = 1;
const LIMIT_SECONDS = '60';

/** 回答者と、問題ごとに押す選択肢。たろうはいつも正解し、撮るのはたろうの画面 */
const PLAYERS = [
  { name: 'たろう', picks: [1, 0, 1, 1] },
  { name: 'はなこ', picks: [1, 1, 3, 1] },
  { name: 'じろう', picks: [0, 0, 1, 2] },
] as const;

const deviceOf = new Map([...hostSteps, ...playerSteps].map((step) => [step.image, step.device]));

/**
 * いまの画面を images/<name>.png に撮る。画面の大きさは、その手順の device と同じでなければ止める。
 * <img> の width・height は device から書くので、違う大きさで撮ると、読み込んだときに場所がずれる
 */
async function shot(page: Page, name: GuideImage) {
  const device = deviceOf.get(name);
  if (device === undefined) {
    throw new Error(`${name} を使う手順が guide-steps.ts にない`);
  }
  expect(page.viewportSize()).toEqual(GUIDE_VIEWPORTS[device]);
  await page.screenshot({ path: `${IMAGES_DIR}${name}.png`, animations: 'disabled' });
}

async function newPage(browser: Browser, device: keyof typeof GUIDE_VIEWPORTS) {
  const context = await browser.newContext({ viewport: GUIDE_VIEWPORTS[device] });
  return { context, page: await context.newPage() };
}

/** 編集画面で、n 問目（0から）を QUESTIONS[n] の中身にする（full-game.spec.ts と同じ手順） */
async function fillQuestion(page: Page, index: number) {
  const question = QUESTIONS[index]!;
  const item = page.getByRole('listitem', { name: `第${index + 1}問` });
  await item.getByLabel('問題文').fill(question.text);
  for (let choice = 2; choice < question.choices.length; choice += 1) {
    await item.getByRole('button', { name: '選択肢を足す' }).click();
  }
  for (const [choice, text] of question.choices.entries()) {
    await item.getByLabel(`選択肢${choice + 1}`, { exact: true }).fill(text);
  }
  await item.getByLabel(`選択肢${question.correct + 1}を正解にする`).check();
  await item.getByLabel('制限時間').fill(LIMIT_SECONDS);
}

/** 回答者の選択肢のボタン。名前は「番号 + 選択肢」になる（full-game.spec.ts の choiceButton） */
const choiceButton = (player: Page, choiceIndex: number, choice: string) =>
  player.getByRole('button', { name: new RegExp(`^${choiceIndex + 1}\\s*${choice}$`) });

test('使い方の画像を撮る', async ({ browser }) => {
  test.setTimeout(120_000);

  // ログインの画面は、ログインしていない人の画面で撮る
  const visitor = await newPage(browser, 'pc');
  await visitor.page.goto('/login');
  await expect(visitor.page.getByRole('button', { name: 'GitHub でログイン' })).toBeVisible();
  await shot(visitor.page, 'host-login');

  // 問題セットを作る
  const host = await newPage(browser, 'pc');
  // 管理画面の右上に名前が出る。渡さないと ID が写る
  await loginAsHost(host.context, { name: 'ホスト' });
  await host.page.goto('/admin');
  await host.page.getByRole('button', { name: '問題セットを作る' }).click();
  await host.page.getByLabel('問題セットの名前').fill(TITLE);
  await fillQuestion(host.page, 0);
  for (let index = 1; index < QUESTIONS.length; index += 1) {
    await host.page.getByRole('button', { name: '問題を足す' }).click();
    await fillQuestion(host.page, index);
  }
  // 見出しを上端に寄せる。上の「一覧に戻る」を外すと、名前から第1問の制限時間までが、下の保存のバーより上に収まる。
  // ルートの tsconfig には DOM の型がないので、ブラウザで走らせる式は文字列で渡す
  await host.page.evaluate("document.querySelector('h1').scrollIntoView()");
  await shot(host.page, 'host-edit-set');
  await host.page.getByRole('button', { name: '保存して一覧へ' }).click();

  // 一覧から部屋を作る
  await expect(host.page).toHaveURL(/\/admin$/);
  const row = host.page.getByRole('listitem').filter({ hasText: TITLE });
  await expect(row).toContainText(`${QUESTIONS.length}問`);
  await shot(host.page, 'host-create-room');
  // 部屋の画面は投影する大きさにする
  await host.page.setViewportSize(GUIDE_VIEWPORTS.projector);
  await row.getByRole('button', { name: '部屋を作る' }).click();
  await expect(host.page.getByRole('heading', { name: TITLE })).toBeVisible();
  const joinUrl = await host.page.getByRole('link', { name: '回答者としても参加する' }).getAttribute('href');

  // 回答者が入る。撮るのは最初の1人（たろう）の画面
  const players = await Promise.all(PLAYERS.map(() => newPage(browser, 'phone')));
  const taro = players[0]!.page;
  await taro.goto(joinUrl!);
  await taro.getByLabel('名前').fill(PLAYERS[0].name);
  await shot(taro, 'player-join');
  await submitName(taro, PLAYERS[0].name);
  await expectWaiting(taro, PLAYERS[0].name);
  for (const [index, player] of PLAYERS.entries()) {
    if (index > 0) {
      await joinRoom(players[index]!.page, joinUrl!, player.name);
    }
  }
  const names = PLAYERS.map((player) => player.name);
  await expect(host.page.getByRole('list', { name: '参加者' }).getByRole('listitem')).toHaveText(names);
  await expect(taro.getByRole('list', { name: '参加者' }).getByRole('listitem')).toHaveText(names);
  await shot(host.page, 'host-lobby');
  await shot(taro, 'player-waiting');

  for (const [index, question] of QUESTIONS.entries()) {
    const shooting = index === SHOT_QUESTION;
    await host.page.getByRole('button', { name: `第${index + 1}問を出す` }).click();
    await host.page.getByRole('button', { name: '受付を始める' }).click();
    await expect(choiceButton(taro, 0, question.choices[0])).toBeVisible();
    if (shooting) {
      await shot(taro, 'player-answering');
    }

    // 最後の1人を残して答え、受付中の人数が動いているところを撮る
    for (const [playerIndex, player] of PLAYERS.entries()) {
      const pick = player.picks[index]!;
      const page = players[playerIndex]!.page;
      await choiceButton(page, pick, question.choices[pick]!).click();
      await expect(page.getByText('締切を待っています', { exact: true })).toBeVisible();
      if (shooting && playerIndex === PLAYERS.length - 2) {
        await expect(host.page.getByText(`${PLAYERS.length - 1}/ ${PLAYERS.length} 人`)).toBeVisible();
        await shot(host.page, 'host-answering');
      }
    }

    await host.page.getByRole('button', { name: 'いま締め切る' }).click();
    await expect(host.page.getByRole('list', { name: '回答の分布' })).toBeVisible();
    await expect(taro.getByRole('region', { name: 'この問題の結果' })).toBeVisible();
    if (shooting) {
      await expect(taro.getByRole('region', { name: 'あなたの位置' })).toBeVisible();
      await shot(host.page, 'host-reveal');
      await shot(taro, 'player-result');
    }

    await host.page.getByRole('button', { name: '最速正解を発表する' }).click();
    await expect(host.page.getByRole('region', { name: '最速正解の発表' })).toBeVisible();
  }

  await host.page.getByRole('button', { name: '最終ランキングを出す' }).click();
  await expect(host.page.getByRole('region', { name: '優勝' })).toContainText(PLAYERS[0].name);
  await shot(host.page, 'host-final');

  await Promise.all([visitor, host, ...players].map(({ context }) => context.close()));
});
