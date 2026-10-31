import { NAME_MAX_LENGTH, playerNameSchema } from '@zubatto-quiz/protocol';
import { useState, type SubmitEvent } from 'react';

import type { JoinNotice } from './player-room';

interface JoinFormProps {
  /** 断られて戻ったときの理由。初めての入力では null */
  notice: JoinNotice | null;
  /** 入力欄に最初から入れておく名前。名前がかぶったときは、かぶった名前を残す */
  defaultName: string;
  /** protocol の playerNameSchema に通った名前（前後の空白を除いたもの）で呼ぶ */
  onJoin: (name: string) => void;
}

/**
 * 名前の入力（F2）。押すまで接続は開かない。名前を入れているあいだに、未確認の接続が10秒で閉じられないため（ADR 0004）。
 * 名前は送る前に protocol のスキーマで確かめる。通らない名前を送っても、部屋の DO は invalid_message を返すだけなので
 */
export function JoinForm({ notice, defaultName, onJoin }: JoinFormProps) {
  const [inputError, setInputError] = useState<string | null>(null);
  const error = inputError ?? (notice === 'name_taken' ? nameTakenMessage(defaultName) : null);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = new FormData(event.currentTarget).get('name');
    const result = playerNameSchema.safeParse(typeof raw === 'string' ? raw : '');
    if (!result.success) {
      setInputError(invalidNameMessage(typeof raw === 'string' ? raw : ''));
      return;
    }
    setInputError(null);
    onJoin(result.data);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-14 pb-24">
      {notice === 'resume_failed' ? (
        <>
          <h1 className="text-3xl leading-snug font-bold">前回の参加には戻れませんでした</h1>
          <p className="mt-4 leading-relaxed text-on-stage-muted">
            参加してから時間がたったか、参加の手続きが途中で切れたため、前回の名前と得点では戻れません。新しく名前を入れて参加してください。
          </p>
        </>
      ) : (
        <h1 className="font-logo text-5xl leading-tight">
          ズバッと
          <br />
          クイズ
        </h1>
      )}

      <form className="mt-12 flex flex-col gap-3" noValidate onSubmit={handleSubmit}>
        <label htmlFor="join-name" className="font-bold">
          名前
        </label>
        <input
          id="join-name"
          name="name"
          // nickname は HTML の仕様にある値（MDN で確かめた、2026-10-28）。oxlint 1.87.0 の一覧に抜けている
          // oxlint-disable-next-line jsx-a11y/autocomplete-valid
          autoComplete="nickname"
          defaultValue={defaultName}
          aria-invalid={error !== null}
          aria-describedby={error === null ? 'join-name-hint' : 'join-name-error'}
          className={`rounded-chip border-2 bg-stage-raised px-4 py-3 text-lg text-on-stage placeholder:text-on-stage-muted/70 focus-visible:outline-none ${
            error === null ? 'border-stage-line focus-visible:border-on-stage' : 'border-alert'
          }`}
          placeholder="例: たろう"
        />
        {error === null ? (
          <p id="join-name-hint" className="text-sm text-on-stage-muted">
            ランキングに出る名前です。同じ部屋の人とかぶらない名前にしてください。
          </p>
        ) : (
          <p id="join-name-error" className="font-bold text-alert" role="alert">
            {error}
          </p>
        )}
        <button className="mt-6 rounded-panel bg-on-stage py-4 text-lg font-bold text-stage shadow-panel focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-on-stage active:translate-y-1.5 active:shadow-none">
          参加する
        </button>
      </form>
    </main>
  );
}

function nameTakenMessage(name: string): string {
  return `「${name}」はこの部屋でもう使われています。別の名前を入れてください。`;
}

/** playerNameSchema に通らなかった理由を、入れた人に分かる言葉にする */
function invalidNameMessage(raw: string): string {
  const name = raw.trim();
  if (name.replaceAll('\u200D', '').trim() === '') {
    return '名前を入れてください。';
  }
  if ([...name].length > NAME_MAX_LENGTH) {
    return `名前は${NAME_MAX_LENGTH}文字までです。`;
  }
  return '使えない文字が入っています。';
}
