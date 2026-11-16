import { useMutation, useQueryClient } from '@tanstack/react-query';
import { githubLoginSchema } from '@zubatto-quiz/protocol';
import { useState, type SubmitEvent } from 'react';

import { ApiError } from '@/api/errors';
import { addHost, hostsQueryOptions } from '@/api/hosts';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ActionError } from '@/shared/feedback/ActionError';
import { describeApiError } from '@/shared/feedback/api-error';
import { notify } from '@/shared/feedback/notify';

const INVALID_LOGIN = 'GitHub のユーザー名は、英数字とハイフンの39文字までです。';

/**
 * GitHub のユーザー名でホストを足す（ADR 0013）。API が名前を数値の ID に変えて許可リストに入れる。
 * 誤りは、直す場所で出し分ける
 * - 入れた名前で直せるもの（形の誤り、GitHub にいない 404、もういる 409）: 欄の下
 * - やり直せば通るかもしれないもの（GitHub が答えない 502、通信の失敗、401 など）: ボタンのそばの ActionError
 */
export function AddHostForm() {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const refreshHosts = () => queryClient.invalidateQueries({ queryKey: hostsQueryOptions.queryKey });
  const add = useMutation({
    mutationFn: addHost,
    onSuccess: async (host, sent) => {
      // メモには GitHub が返した書き方の名前が入る（octocat と打っても Octocat）
      notify(`「${host.note ?? sent}」をホストに追加しました`);
      // 送っているあいだに打ち替えた名前は、まだ送っていないので残す。送った名前のままのときだけ空にする
      setLogin((current) => (normalizeLogin(current) === sent ? '' : current));
      await refreshHosts();
    },
    // 409 は別のタブなどで先に足されていたので、一覧を読み直して見せる。
    // ほかの失敗では読み直さない。401 で読み直すと、一覧の場所にも同じ誤りが出て2回読まれる
    onError: async (error) => {
      if (describeApiError(error) === 'conflict') {
        await refreshHosts();
      }
    },
  });
  const fieldError = inputError ?? fieldErrorOf(add.error);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = normalizeLogin(login);
    add.reset();
    if (value === '') {
      setInputError('GitHub のユーザー名を入れてください。');
      return;
    }
    const result = githubLoginSchema.safeParse(value);
    if (!result.success) {
      setInputError(INVALID_LOGIN);
      return;
    }
    setInputError(null);
    add.mutate(result.data);
  }

  return (
    <form className="mt-8 flex max-w-md flex-col gap-cluster" noValidate onSubmit={handleSubmit}>
      <Field
        label="GitHub のユーザー名"
        hint="github.com/octocat の octocat の部分です。追加した人は、GitHub でログインできるようになります。"
        error={fieldError}
      >
        <Input
          name="login"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="例: octocat"
        />
      </Field>
      <Button type="submit" disabled={add.isPending} className="self-start">
        ホストに追加する
      </Button>
      {add.isError && fieldErrorOf(add.error) === null && (
        <ActionError
          error={add.error}
          failed={
            add.error instanceof ApiError && add.error.code === 'github_unavailable'
              ? '追加できませんでした。GitHub に問い合わせられなかったので、少し待ってからもう一度押してください。'
              : '追加できませんでした。もう一度押してください。'
          }
        />
      )}
    </form>
  );
}

/**
 * 欄の値を、送る名前の形に整える。前後の空白を除き、先頭の @ を1つだけ外す（GitHub のページでは名前が @octocat と出るため）。
 * ほかの形の誤りは githubLoginSchema に任せる
 */
function normalizeLogin(raw: string): string {
  return raw.trim().replace(/^@/, '');
}

/** API の失敗のうち、入れた名前を直せば通るものを、欄の下に出す文にする。それ以外は null（ボタンのそばに出す） */
function fieldErrorOf(error: unknown): string | null {
  switch (describeApiError(error)) {
    case 'notFound':
      return 'GitHub にこのユーザーが見つかりません。名前を確かめてください。';
    // POST /api/admin/hosts の 409 は already_exists だけ
    case 'conflict':
      return 'この人はもうホストです。';
    default:
      return null;
  }
}
