import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QuestionSetDetail } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../../test/fake-api';
import { createAppRouter } from '../../router';

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

async function openEditor(path = EDIT_PATH) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  const view = render(<RouterProvider router={router} />);
  await act(() => router.load());
  return { router, unmount: view.unmount };
}

const card = (number: number) => screen.getByRole('listitem', { name: `第${number}問` });
const cardTitles = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
const saveButton = () => screen.getByRole('button', { name: '保存する' });

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

    expect(await screen.findByText('保存しました')).toBeInTheDocument();
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
    expect(await screen.findByText('保存しました')).toBeInTheDocument();
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
    fireEvent.click(within(dialog).getByRole('button', { name: '編集に戻る' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(EDIT_PATH);
    expect(screen.getByLabelText('問題セットの名前')).toHaveValue('まだ保存していない');

    fireEvent.click(screen.getByRole('link', { name: '問題セットの一覧に戻る' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存せずに離れる' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('保存したあとや、何も変えていなければ、確かめずに離れる', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    const { router } = await openEditor();
    await screen.findByLabelText('問題セットの名前');
    fireEvent.change(screen.getByLabelText('問題セットの名前'), { target: { value: '保存する名前' } });
    fireEvent.click(saveButton());
    await screen.findByText('保存しました');

    fireEvent.click(screen.getByRole('link', { name: '問題セットの一覧に戻る' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // 一覧も、保存した名前で読み直している
    expect(await screen.findByRole('heading', { level: 2, name: '保存する名前' })).toBeInTheDocument();
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
