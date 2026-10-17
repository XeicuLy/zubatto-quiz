import { MAX_CHOICES, MAX_LIMIT_MS, MIN_CHOICES, MIN_LIMIT_MS } from '@zubatto-quiz/protocol';
import { useId, type Dispatch } from 'react';

import type { DraftErrors, EditorAction, QuestionDraft } from './question-set-draft';

interface QuestionEditorProps {
  question: QuestionDraft;
  /** 何問目か（0始まり） */
  index: number;
  /** 問題の数。端の問題の並べ替えと、最後の1問を消すことを止める */
  count: number;
  /** 下書き全体の誤り。この問題の場所（questions.<index>.*）のものだけを出す */
  errors: DraftErrors;
  dispatch: Dispatch<EditorAction>;
}

/** 選択肢の番号の丸。回答者画面の早押しパネルと同じ色にする。Tailwind はクラス名を文字のまま探すので、書き出しておく */
const choiceBadge = [
  'bg-choice-1 text-on-choice',
  'bg-choice-2 text-on-choice',
  'bg-choice-3 text-on-choice',
  'bg-choice-4 text-on-choice-4',
] as const;

const field =
  'rounded-chip border-2 border-backstage-line bg-backstage-surface px-3 py-2 focus-visible:border-stage focus-visible:outline-none aria-invalid:border-alert-strong';

const smallButton =
  'shrink-0 text-sm underline focus-visible:outline-2 focus-visible:outline-stage disabled:no-underline disabled:opacity-50';

/** 1問の編集（F4・F9）。問題文・2〜4個の選択肢・正解・制限時間を入れ、並べ替えと消すもここから行う */
export function QuestionEditor({ question, index, count, errors, dispatch }: QuestionEditorProps) {
  const id = useId();
  const number = index + 1;
  const errorOf = (place: string) => errors[`questions.${index}.${place}`];
  const hasError = Object.keys(errors).some((key) => key.startsWith(`questions.${index}.`));
  const textError = errorOf('text');
  const correctError = errorOf('correctIndex') ?? errorOf('choices');
  const limitError = errorOf('limitMs');

  return (
    <li
      aria-labelledby={`${id}-heading`}
      className={`rounded-panel bg-backstage-surface p-5 ${hasError ? 'border-2 border-alert-strong' : 'border border-backstage-line'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={`${id}-heading`} className="font-display text-xl">
          第{number}問
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={`第${number}問を上へ`}
            disabled={index === 0}
            onClick={() => dispatch({ type: 'moveQuestion', index, offset: -1 })}
            className={smallButton}
          >
            上へ
          </button>
          <button
            type="button"
            aria-label={`第${number}問を下へ`}
            disabled={index === count - 1}
            onClick={() => dispatch({ type: 'moveQuestion', index, offset: 1 })}
            className={smallButton}
          >
            下へ
          </button>
          <button
            type="button"
            disabled={count <= 1}
            onClick={() => dispatch({ type: 'removeQuestion', index })}
            className={`${smallButton} text-alert-strong`}
          >
            この問題を消す
          </button>
        </div>
      </div>

      <label htmlFor={`${id}-text`} className="mt-4 block text-sm font-bold">
        問題文
      </label>
      <textarea
        id={`${id}-text`}
        rows={2}
        value={question.text}
        onChange={(event) => dispatch({ type: 'setText', index, text: event.target.value })}
        aria-invalid={textError !== undefined}
        aria-describedby={textError === undefined ? undefined : `${id}-text-error`}
        className={`mt-2 w-full leading-relaxed ${field}`}
      />
      {textError !== undefined && <FieldError id={`${id}-text-error`} message={textError} />}

      <fieldset className="mt-5" aria-describedby={correctError === undefined ? undefined : `${id}-correct-error`}>
        <legend className="text-sm font-bold">
          選択肢と正解{' '}
          <span className="font-normal text-backstage-muted">
            （{MIN_CHOICES}〜{MAX_CHOICES}個。正解を1つ選ぶ）
          </span>
        </legend>
        {correctError !== undefined && <FieldError id={`${id}-correct-error`} message={correctError} />}
        {/* grid-cols-1 は minmax(0, 1fr)。列を指さないと auto の列になり、スマホの幅で入力欄が元の幅より縮まずにはみ出す */}
        <div className="mt-2 grid grid-cols-1 gap-2">
          {question.choices.map((choice, choiceIndex) => {
            const choiceNumber = choiceIndex + 1;
            const choiceError = errorOf(`choices.${choiceIndex}`);
            return (
              // 選択肢は並べ替えないので、番号を key にしてよい
              <div key={choiceIndex}>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`grid size-9 shrink-0 place-items-center rounded-full font-display ${choiceBadge[choiceIndex]}`}
                  >
                    {choiceNumber}
                  </span>
                  <input
                    aria-label={`選択肢${choiceNumber}`}
                    value={choice}
                    onChange={(event) => dispatch({ type: 'setChoice', index, choiceIndex, text: event.target.value })}
                    aria-invalid={choiceError !== undefined}
                    aria-describedby={choiceError === undefined ? undefined : `${id}-choice-${choiceIndex}-error`}
                    className={`min-w-0 flex-1 ${field}`}
                  />
                  <label
                    className={`flex shrink-0 items-center gap-1.5 text-sm ${question.correctIndex === choiceIndex ? 'font-bold' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`${id}-correct`}
                      aria-label={`選択肢${choiceNumber}を正解にする`}
                      checked={question.correctIndex === choiceIndex}
                      onChange={() => dispatch({ type: 'setCorrect', index, choiceIndex })}
                      className="size-4 accent-stage"
                    />
                    正解
                  </label>
                  <button
                    type="button"
                    aria-label={`選択肢${choiceNumber}を消す`}
                    disabled={question.choices.length <= MIN_CHOICES}
                    onClick={() => dispatch({ type: 'removeChoice', index, choiceIndex })}
                    className={`${smallButton} text-backstage-muted`}
                  >
                    消す
                  </button>
                </div>
                {choiceError !== undefined && (
                  <FieldError id={`${id}-choice-${choiceIndex}-error`} message={choiceError} indent />
                )}
              </div>
            );
          })}
        </div>
        {question.choices.length < MAX_CHOICES ? (
          <button
            type="button"
            onClick={() => dispatch({ type: 'addChoice', index })}
            className="mt-3 rounded-full border-2 border-dashed border-backstage-line px-4 py-1.5 text-sm font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-stage"
          >
            選択肢を足す
          </button>
        ) : (
          <p className="mt-3 text-sm text-backstage-muted">選択肢は{MAX_CHOICES}つまでです</p>
        )}
      </fieldset>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label htmlFor={`${id}-limit`} className="text-sm font-bold">
          制限時間
        </label>
        <input
          id={`${id}-limit`}
          type="number"
          inputMode="numeric"
          min={MIN_LIMIT_MS / 1000}
          max={MAX_LIMIT_MS / 1000}
          step={1}
          value={question.limitSeconds}
          onChange={(event) => dispatch({ type: 'setLimit', index, limitSeconds: event.target.value })}
          aria-invalid={limitError !== undefined}
          aria-describedby={limitError === undefined ? undefined : `${id}-limit-error`}
          className={`w-20 text-right tabular-nums ${field}`}
        />
        <span className="text-sm">秒</span>
        <span className="text-sm text-backstage-muted">受付を始めてからの時間</span>
      </div>
      {limitError !== undefined && <FieldError id={`${id}-limit-error`} message={limitError} />}
    </li>
  );
}

/** 入力欄の誤り。入力欄の aria-describedby から id で指す */
function FieldError({ id, message, indent = false }: { id: string; message: string; indent?: boolean }) {
  return (
    <p id={id} className={`mt-2 text-sm font-bold text-alert-strong ${indent ? 'pl-12' : ''}`}>
      {message}
    </p>
  );
}
