import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QuestionSetDetail } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { createAppRouter } from '@/router';

import { stubFakeApi } from '../../../test/fake-api';

const SET: QuestionSetDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '2026 内輪クイズ',
  questions: [
    {
      text: '部長の十八番は？',
      choices: ['演歌', 'アニソン', '洋楽ロック', '歌わない'],
      correctIndex: 1,
      limitMs: 10_000,
    },
    { text: 'ポトス太郎は夏を越せた？', choices: ['越せた', '枯れた'], correctIndex: 0, limitMs: 5_000 },
  ],
};

const EDIT_PATH = `/admin/sets/${SET.id}`;
const NEW_PATH = '/admin/sets/new';

/** 一覧から移ってきたことにして開く。戻る操作でどこへ戻るかを確かめるため */
async function openEditor(path = EDIT_PATH) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/admin', path] }) });
  const view = render(<RouterProvider router={router} />);
  await act(() => router.load());
  return { router, unmount: view.unmount };
}

const card = (number: number) => screen.getByRole('listitem', { name: `第${number}問` });
const cardTitles = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
const saveButton = () => screen.getByRole('button', { name: '保存する' });
const saveAndListButton = () => screen.getByRole('button', { name: '保存して一覧へ' });
const toasts = () => screen.getByRole('region', { name: '通知' });

describe('問題セットの編集（F4・F7・F9）', () => {
  it('開くと、保存した問題セットが入っている', async () => {
    stubFakeApi({ questionSetDetails: [SET] });

    await openEditor();

    expect(await screen.findByLabelText('問題セットの名前')).toHaveValue(SET.title);
    expect(within(card(1)).getByLabelText('問題文')).toHaveValue('部長の十八番は？');
    expect(within(card(1)).getByRole('radio', { name: '選択肢2を正解にする' })).toBeChecked();
    expect(within(card(1)).getByLabelText('制限時間')).toHaveValue(10);
    expect(within(card(2)).getByLabelText('選択肢2')).toHaveValue('枯れた');
    expect(within(card(2)).getByLabelText('制限時間')).toHaveValue(5);
  });

  it('問題を足す・並べ替える・消すができる。足した問題は2択・正解なし・10秒で始まる', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    await openEditor();
    await screen.findByLabelText('問題セットの名前');

    fireEvent.click(screen.getByRole('button', { name: '問題を足す' }));
    expect(cardTitles()).toEqual(['第1問', '第2問', '第3問']);
    expect(within(card(3)).getAllByRole('textbox', { name: /^選択肢/ })).toHaveLength(2);
    expect(within(card(3)).getByLabelText('制限時間')).toHaveValue(10);
    for (const radio of within(card(3)).getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }

    fireEvent.click(within(card(2)).getByRole('button', { name: '第2問を上へ' }));
    expect(within(card(1)).getByLabelText('問題文')).toHaveValue('ポトス太郎は夏を越せた？');
    expect(within(card(2)).getByLabelText('問題文')).toHaveValue('部長の十八番は？');

    fireEvent.click(within(card(1)).getByRole('button', { name: 'この問題を消す' }));
    expect(cardTitles()).toEqual(['第1問', '第2問']);
    expect(within(card(1)).getByLabelText('問題文')).toHaveValue('部長の十八番は？');
  });

  it('保存して開き直すと、同じ内容になる（F7）', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    const first = await openEditor();
    await screen.findByLabelText('問題セットの名前');

    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: '書き換えた名前' } });
    fireEvent.click(within(card(2)).getByRole('button', { name: '選択肢を足す' }));
    fireEvent.change(within(card(2)).getByLabelText('選択肢3'), { target: { value: '植え替えた' } });
    fireEvent.click(within(card(2)).getByRole('radio', { name: '選択肢3を正解にする' }));
    fireEvent.change(within(card(2)).getByLabelText('制限時間'), { target: { value: '30' } });
    fireEvent.click(saveButton());

    // 成功は toast だけで知らせ、保存の帯には出さない（2回読まれないため）
    expect(await within(toasts()).findByText('「書き換えた名前」を保存しました')).toBeVisible();
    expect(screen.queryByText('保存しました')).not.toBeInTheDocument();
    expect(screen.queryByText('保存していない変更があります')).not.toBeInTheDocument();
    expect(api.requestsTo('PUT', `/api/question-sets/${SET.id}`)).toHaveLength(1);

    first.unmount();
    await openEditor();

    expect(await screen.findByLabelText('問題セットの名前')).toHaveValue('書き換えた名前');
    expect(within(card(2)).getByLabelText('選択肢3')).toHaveValue('植え替えた');
    expect(within(card(2)).getByRole('radio', { name: '選択肢3を正解にする' })).toBeChecked();
    expect(within(card(2)).getByLabelText('制限時間')).toHaveValue(30);
  });

  it('正解を選んでいない問題があれば保存せず、直すところを示し、直すと誤りが消える（F4）', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    await openEditor();
    await screen.findByLabelText('問題セットの名前');

    fireEvent.click(screen.getByRole('button', { name: '問題を足す' }));
    fireEvent.change(within(card(3)).getByLabelText('問題文'), { target: { value: '新しい問題' } });
    fireEvent.change(within(card(3)).getByLabelText('選択肢1'), { target: { value: 'はい' } });
    fireEvent.change(within(card(3)).getByLabelText('選択肢2'), { target: { value: 'いいえ' } });
    // 保存を押すまでは、誤りを出さない
    expect(screen.queryByText('正解を1つ選んでください')).not.toBeInTheDocument();

    fireEvent.click(saveButton());

    expect(await screen.findByText('第3問に直すところがあります')).toBeInTheDocument();
    expect(within(card(3)).getByText('正解を1つ選んでください')).toBeInTheDocument();
    expect(api.requestsTo('PUT', `/api/question-sets/${SET.id}`)).toEqual([]);

    // 一度保存を押したあとは、直したそばから誤りが消える
    fireEvent.click(within(card(3)).getByRole('radio', { name: '選択肢1を正解にする' }));
    expect(screen.queryByText('正解を1つ選んでください')).not.toBeInTheDocument();
    expect(screen.queryByText('第3問に直すところがあります')).not.toBeInTheDocument();

    fireEvent.click(saveButton());
    expect(await within(toasts()).findByText(`「${SET.title}」を保存しました`)).toBeVisible();
  });

  it('直すところがあれば、「保存して一覧へ」でも保存せず、編集画面に留まる（F4）', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    const { router } = await openEditor();
    await screen.findByLabelText('問題セットの名前');

    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: '' } });
    fireEvent.click(saveAndListButton());

    expect(await screen.findByText('問題セットの名前に直すところがあります')).toBeInTheDocument();
    expect(api.requestsTo('PUT', `/api/question-sets/${SET.id}`)).toEqual([]);
    expect(router.state.location.pathname).toBe(EDIT_PATH);
  });

  it('名前を空にして保存すると、名前の欄に誤りを出して読み上げる（F4）', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    await openEditor();
    await screen.findByLabelText('問題セットの名前');

    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: '' } });
    fireEvent.click(saveButton());

    expect(screen.getByLabelText('問題セットの名前')).toHaveAccessibleDescription('問題セットの名前を入れてください');
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toContain(
      '問題セットの名前を入れてください',
    );
  });

  it('選択肢は4つより増やせず、2つより減らせない（F4）', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    await openEditor();
    await screen.findByLabelText('問題セットの名前');

    // 第1問は4択、第2問は2択
    expect(within(card(1)).queryByRole('button', { name: '選択肢を足す' })).not.toBeInTheDocument();
    expect(within(card(2)).getByRole('button', { name: '選択肢1を消す' })).toBeDisabled();
  });

  it('保存していない変更があれば、離れる前に確かめ、「編集に戻る」なら書いた内容が残る', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    const { router } = await openEditor();
    await screen.findByLabelText('問題セットの名前');
    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: 'まだ保存していない' } });

    fireEvent.click(screen.getByRole('link', { name: '問題セットの一覧に戻る' }));
    const dialog = await screen.findByRole('alertdialog', { name: '保存していない変更があります' });
    // 押し間違えても書いた内容が消えない方に、初めからフォーカスがある
    expect(within(dialog).getByRole('button', { name: '編集に戻る' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: '編集に戻る' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(EDIT_PATH);
    expect(screen.getByLabelText('問題セットの名前')).toHaveValue('まだ保存していない');

    fireEvent.click(screen.getByRole('link', { name: '問題セットの一覧に戻る' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存せずに離れる' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('離れる確かめは保存の帯に出し、Esc でも編集に戻って、押したリンクへフォーカスを戻す', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    const { router } = await openEditor();
    await screen.findByLabelText('問題セットの名前');
    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: 'まだ保存していない' } });

    const back = screen.getByRole('link', { name: '問題セットの一覧に戻る' });
    back.focus();
    fireEvent.click(back);
    const dialog = await screen.findByRole('alertdialog', { name: '保存していない変更があります' });
    expect(dialog).toHaveAccessibleDescription('このまま離れると、書いた内容は消えます。');
    // 画面を覆わず、保存の帯の中身と入れ替わる
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('button', { name: '保存する' })).not.toBeInTheDocument();

    fireEvent.keyDown(within(dialog).getByRole('button', { name: '編集に戻る' }), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(EDIT_PATH);
    expect(back).toHaveFocus();
    expect(saveButton()).toBeInTheDocument();
  });

  it('保存したあとや、何も変えていなければ、確かめずに離れる', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    const { router } = await openEditor();
    await screen.findByLabelText('問題セットの名前');
    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: '保存する名前' } });
    fireEvent.click(saveButton());
    await within(toasts()).findByText('「保存する名前」を保存しました');

    fireEvent.click(screen.getByRole('link', { name: '問題セットの一覧に戻る' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // 一覧も、保存した名前で読み直している
    expect(await screen.findByRole('heading', { level: 2, name: '保存する名前' })).toBeInTheDocument();
  });

  it('「保存して一覧へ」は、保存してから確かめずに一覧へ移り、一覧でも toast が見える', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    const { router } = await openEditor();
    await screen.findByLabelText('問題セットの名前');
    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: '書き終えた名前' } });

    fireEvent.click(saveAndListButton());

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.requestsTo('PUT', `/api/question-sets/${SET.id}`)).toHaveLength(1);
    expect(await screen.findByRole('heading', { level: 2, name: '書き終えた名前' })).toBeInTheDocument();
    expect(within(toasts()).getByText('「書き終えた名前」を保存しました')).toBeVisible();
  });

  it('保存のときにログインが切れていたら、ログインし直すよう促し、書いた内容は残す', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    await openEditor();
    await screen.findByLabelText('問題セットの名前');
    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: '消えては困る名前' } });

    api.expireSession();
    fireEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('ログインが切れました');
    expect(screen.getByLabelText('問題セットの名前')).toHaveValue('消えては困る名前');
  });

  it('ない（または他人の）問題セットを開くと、見つからないと知らせて一覧へ戻れるようにする', async () => {
    stubFakeApi({ questionSetDetails: [SET] });

    await openEditor('/admin/sets/99999999-9999-4999-8999-999999999999');

    expect(await screen.findByRole('heading', { name: '問題セットが見つかりません' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '問題セットの一覧に戻る' })).toHaveAttribute('href', '/admin');
  });
});

describe('問題セットを作る（F4・F7）', () => {
  /** 空の下書きの第1問に、保存できる中身を入れる */
  function fillNewSet(title: string) {
    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: title } });
    fireEvent.change(within(card(1)).getByLabelText('問題文'), { target: { value: '部長の十八番は？' } });
    fireEvent.change(within(card(1)).getByLabelText('選択肢1'), { target: { value: '演歌' } });
    fireEvent.change(within(card(1)).getByLabelText('選択肢2'), { target: { value: 'アニソン' } });
    fireEvent.click(within(card(1)).getByRole('radio', { name: '選択肢2を正解にする' }));
  }

  it('空の下書きで始まり、入れる値の例を placeholder で見せる。開いただけでは何も作らない', async () => {
    const api = stubFakeApi();

    await openEditor(NEW_PATH);

    expect(await screen.findByRole('heading', { level: 1, name: '問題セットを作る' })).toBeInTheDocument();
    expect(screen.getByLabelText('問題セットの名前')).toHaveValue('');
    expect(screen.getByLabelText('問題セットの名前')).toHaveAttribute('placeholder', '例: 2026 内輪クイズ');
    expect(cardTitles()).toEqual(['第1問']);
    expect(within(card(1)).getByLabelText('問題文')).toHaveValue('');
    expect(within(card(1)).getByLabelText('問題文')).toHaveAttribute('placeholder', '例: 部長の十八番は？');
    // placeholder は名前の代わりにならないので、選択肢の名前は番号のまま
    const choices = within(card(1)).getAllByRole('textbox', { name: /^選択肢\d$/ });
    expect(choices.map((choice) => [choice.getAttribute('aria-label'), choice.getAttribute('placeholder')])).toEqual([
      ['選択肢1', '例: 演歌'],
      ['選択肢2', '例: アニソン'],
    ]);
    for (const radio of within(card(1)).getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    expect(within(card(1)).getByLabelText('制限時間')).toHaveValue(10);
    expect(api.requestsTo('POST', '/api/question-sets')).toEqual([]);
  });

  it('足した選択肢にも、番号ごとの例を出す', async () => {
    stubFakeApi();
    await openEditor(NEW_PATH);
    await screen.findByLabelText('問題セットの名前');

    fireEvent.click(within(card(1)).getByRole('button', { name: '選択肢を足す' }));
    fireEvent.click(within(card(1)).getByRole('button', { name: '選択肢を足す' }));

    expect(within(card(1)).getByLabelText('選択肢3')).toHaveAttribute('placeholder', '例: 洋楽ロック');
    expect(within(card(1)).getByLabelText('選択肢4')).toHaveAttribute('placeholder', '例: 歌わない');
  });

  it('空のまま保存すると、作らずに直すところを示す', async () => {
    const api = stubFakeApi();
    const { router } = await openEditor(NEW_PATH);
    await screen.findByLabelText('問題セットの名前');

    fireEvent.click(saveButton());

    expect(await screen.findByText('問題セットの名前・第1問に直すところがあります')).toBeInTheDocument();
    expect(api.requestsTo('POST', '/api/question-sets')).toEqual([]);
    expect(router.state.location.pathname).toBe(NEW_PATH);
  });

  it('「保存する」で作り、その編集画面へ置き換えて移って「保存する」にフォーカスし、作ったことを toast で知らせる', async () => {
    const api = stubFakeApi();
    const { router } = await openEditor(NEW_PATH);
    await screen.findByLabelText('問題セットの名前');
    fillNewSet('新しく作った問題セット');

    fireEvent.click(saveButton());

    expect(await screen.findByRole('heading', { level: 1, name: '問題セットの編集' })).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/admin\/sets\/[0-9a-f-]{36}$/);
    expect(saveButton()).toHaveFocus();
    expect(within(toasts()).getByText('「新しく作った問題セット」を作りました')).toBeVisible();
    // 移った先は、作ったセットを読み直した内容で始まる
    expect(screen.getByLabelText('問題セットの名前')).toHaveValue('新しく作った問題セット');
    expect(within(card(1)).getByRole('radio', { name: '選択肢2を正解にする' })).toBeChecked();
    expect(api.requestsTo('POST', '/api/question-sets')).toHaveLength(1);

    // 置き換えたので、戻ると空の作成画面ではなく一覧へ戻る
    act(() => router.history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('「保存して一覧へ」で作ってから一覧へ移り、一覧に作った問題セットが並ぶ', async () => {
    const api = stubFakeApi();
    const { router } = await openEditor(NEW_PATH);
    await screen.findByLabelText('問題セットの名前');
    fillNewSet('書き終えた問題セット');

    fireEvent.click(saveAndListButton());

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(await screen.findByRole('heading', { level: 2, name: '書き終えた問題セット' })).toBeInTheDocument();
    expect(within(toasts()).getByText('「書き終えた問題セット」を作りました')).toBeVisible();
    expect(api.requestsTo('POST', '/api/question-sets')).toHaveLength(1);
  });

  it('何か打ったら、作る前に離れようとすると確かめる', async () => {
    stubFakeApi();
    const { router } = await openEditor(NEW_PATH);
    await screen.findByLabelText('問題セットの名前');
    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: '書きかけ' } });

    fireEvent.click(screen.getByRole('link', { name: '問題セットの一覧に戻る' }));

    expect(await screen.findByRole('alertdialog', { name: '保存していない変更があります' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(NEW_PATH);
  });

  it('何も打たずに離れたら、確かめずに移り、一覧に何も増えない', async () => {
    const api = stubFakeApi();
    const { router } = await openEditor(NEW_PATH);
    await screen.findByLabelText('問題セットの名前');

    fireEvent.click(screen.getByRole('link', { name: '問題セットの一覧に戻る' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByText('まだ問題セットがありません')).toBeInTheDocument();
    expect(api.requestsTo('POST', '/api/question-sets')).toEqual([]);
  });
});
