import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { collectCspViolations } from './helpers/csp';
import { loginAsHost } from './helpers/login';

/** 作る問題セット。correct は正解の番号（0から）。たろうはいつも正解し、はなこは第2問だけ正解する */
const QUESTIONS = [
  { text: '日本でいちばん高い山は？', choices: ['富士山', '高尾山', '阿蘇山'], correct: 0, hanako: 1 },
  { text: '1 + 1 は？', choices: ['1', '2'], correct: 1, hanako: 1 },
  { text: '晴れた日の空の色は？', choices: ['赤', '青', '緑', '黄'], correct: 1, hanako: 3 },
] as const;

const TITLE = 'E2E の問題セット';
/** 締切はホストが「いま締め切る」で行う。制限時間は、テストが遅れても先に時間切れにならない長さにする（F9 の上限は60秒） */
const LIMIT_SECONDS = '60';

/** 投影する進行画面と、回答者のスマホの大きさ（docs/design/README.md） */
const PROJECTOR = { width: 1600, height: 900 };
const PHONE = { width: 390, height: 844 };

interface Actor {
  context: BrowserContext;
  page: Page;
  violations: string[];
}

/** ブラウザの保存領域（Cookie・localStorage）を分けた1人ぶんを作る。回答者の秘密が混ざらない */
async function newActor(browser: Browser, viewport: { width: number; height: number }): Promise<Actor> {
  const context = await browser.newContext({ viewport });
  const violations = collectCspViolations(context);
  return { context, page: await context.newPage(), violations };
}

/** 編集画面で、n 問目（0から）を QUESTIONS[n] の中身にする（F4・F9） */
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

/** 参加用の URL を開き、名前を入れて入る（F2） */
async function join(player: Page, joinUrl: string, name: string) {
  await player.goto(joinUrl);
  await player.getByLabel('名前').fill(name);
  await player.getByRole('button', { name: '参加する' }).click();
  await expect(player.getByRole('heading', { name })).toBeVisible();
  await expect(player.getByText('ホストが始めるのを待っています')).toBeVisible();
}

/**
 * 回答者の選択肢のボタン。名前は「番号 + 選択肢」になる（番号の丸もボタンの中の文字なので）。
 * 選択肢の文字だけで探すと、「1」と「11」のような選択肢を取り違える
 */
const choiceButton = (player: Page, choiceIndex: number, choice: string) =>
  player.getByRole('button', { name: new RegExp(`^${choiceIndex + 1}\\s*${choice}$`) });

/** 受付中の回答者の画面で、選択肢のボタンを押す（F10）。押したら、選び直せない一覧に変わる */
async function answer(player: Page, choices: readonly string[], choiceIndex: number) {
  await choiceButton(player, choiceIndex, choices[choiceIndex]!).click();
  await expect(player.getByText('締切を待っています')).toBeVisible();
  await expect(player.getByRole('button', { name: new RegExp(`^${choiceIndex + 1}`) })).toHaveCount(0);
}

test('ホストが問題セットを作って部屋を開き、2人が最後まで遊べる', async ({ browser }) => {
  const host = await newActor(browser, PROJECTOR);
  const taro = await newActor(browser, PHONE);
  const hanako = await newActor(browser, PHONE);

  // ログイン（ADR 0003）。GitHub は通らず、テスト専用の入口でセッションを作る
  await loginAsHost(host.context);
  await host.page.goto('/admin');
  await expect(host.page.getByText('まだ問題セットがありません')).toBeVisible();

  // 問題セットを作る（F4・F9）
  await host.page.getByRole('button', { name: '問題セットを作る' }).click();
  await expect(host.page.getByRole('heading', { name: '問題セットの編集' })).toBeVisible();
  await host.page.getByLabel('問題セットの名前').fill(TITLE);
  await fillQuestion(host.page, 0);
  for (let index = 1; index < QUESTIONS.length; index += 1) {
    await host.page.getByRole('button', { name: '問題を足す' }).click();
    await fillQuestion(host.page, index);
  }
  await host.page.getByRole('button', { name: '保存する' }).click();
  await expect(host.page.getByText('保存しました')).toBeVisible();

  // 部屋を作り、参加用の URL を出す（F1）
  await host.page.getByRole('link', { name: '問題セットの一覧に戻る' }).click();
  const row = host.page.getByRole('listitem').filter({ hasText: TITLE });
  await expect(row).toContainText(`${QUESTIONS.length}問`);
  await row.getByRole('button', { name: '部屋を作る' }).click();
  await expect(host.page).toHaveURL(/\/rooms\/[0-9a-f]{64}\/host$/);
  await expect(host.page.getByRole('heading', { name: TITLE })).toBeVisible();
  const joinUrl = await host.page.getByRole('link', { name: '回答者としても参加する' }).getAttribute('href');
  expect(joinUrl).toMatch(/^http:\/\/localhost:4173\/r\/[0-9a-f]{64}$/);

  // 2人が入り、ホストの待機画面に並ぶ（F2・F3）
  await join(taro.page, joinUrl!, 'たろう');
  await join(hanako.page, joinUrl!, 'はなこ');
  const participants = host.page.getByRole('list', { name: '参加者' });
  await expect(participants.getByRole('listitem')).toHaveText(['たろう', 'はなこ']);
  await expect(hanako.page.getByRole('list', { name: '参加者' }).getByRole('listitem')).toHaveText([
    'たろう',
    'はなこ',
  ]);

  const players = [taro.page, hanako.page];
  for (const [index, question] of QUESTIONS.entries()) {
    const number = index + 1;

    // 出題。読み上げのあいだは、回答者の画面にも問題文だけが出る（F8・F17）
    await host.page.getByRole('button', { name: `第${number}問を出す` }).click();
    await expect(host.page.getByRole('heading', { name: question.text })).toBeVisible();
    for (const player of players) {
      await expect(player.getByRole('heading', { name: question.text })).toBeVisible();
      await expect(choiceButton(player, 0, question.choices[0])).toHaveCount(0);
    }

    // 受付を始め、2人が答える（F8・F10）
    await host.page.getByRole('button', { name: '受付を始める' }).click();
    await answer(taro.page, question.choices, question.correct);
    await answer(hanako.page, question.choices, question.hanako);
    await expect(host.page.getByText('2/ 2 人')).toBeVisible();

    // ① 締切。正解した人だけに点が入る（F11）
    await host.page.getByRole('button', { name: 'いま締め切る' }).click();
    await expect(host.page.getByRole('list', { name: '回答の分布' })).toBeVisible();
    const taroResult = taro.page.getByRole('region', { name: 'この問題の結果' });
    await expect(taroResult.getByRole('heading', { name: '○ 正解' })).toBeVisible();
    await expect(taroResult).not.toContainText('+0点');
    await expect(taro.page.getByRole('region', { name: 'あなたの位置' })).toBeVisible();
    const hanakoResult = hanako.page.getByRole('region', { name: 'この問題の結果' });
    if (question.hanako === question.correct) {
      await expect(hanakoResult.getByRole('heading', { name: '○ 正解' })).toBeVisible();
    } else {
      await expect(hanakoResult.getByRole('heading', { name: '× 不正解' })).toBeVisible();
      await expect(hanakoResult).toContainText('+0点');
    }

    // ② 最速正解（F14）。たろうはいつも正解するので、必ず最速の3人に入る
    await host.page.getByRole('button', { name: '最速正解を発表する' }).click();
    await expect(host.page.getByRole('region', { name: '最速正解の発表' })).toContainText('たろう');
    for (const player of players) {
      await expect(player.getByRole('list', { name: '最速の3人' })).toContainText('たろう');
    }

    // ③ 途中経過は、ホストが出したいときに出す。最後の2問では出せない（F15）
    const standings = host.page.getByRole('button', { name: '途中経過を出す' });
    if (number <= QUESTIONS.length - 2) {
      await standings.click();
      await expect(host.page.getByRole('table', { name: '途中経過' })).toContainText('たろう');
      await expect(taro.page.getByRole('table', { name: '途中経過' })).toContainText('はなこ');
    } else {
      await expect(standings).toHaveCount(0);
    }
  }

  // 最終ランキング。3問とも正解したたろうが優勝する（F15・F16）
  await host.page.getByRole('button', { name: '最終ランキングを出す' }).click();
  for (const page of [host.page, ...players]) {
    await expect(page.getByRole('region', { name: '優勝' })).toContainText('たろう');
    await expect(page.getByRole('list', { name: '2位と3位' })).toContainText('はなこ');
  }

  // 開いたすべての画面で、CSP の違反がない（ADR 0004）
  expect([...host.violations, ...taro.violations, ...hanako.violations]).toEqual([]);

  await Promise.all([host.context.close(), taro.context.close(), hanako.context.close()]);
});
