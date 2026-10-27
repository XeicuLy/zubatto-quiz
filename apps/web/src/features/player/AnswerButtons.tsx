import { useLayoutEffect, useRef } from 'react';

interface AnswerButtonsProps {
  /** 2〜4択。受付開始（answeringStarted）で届いたもの */
  choices: string[];
  /** 自分が選んだ選択肢の番号（0から）。答えていなければ null */
  chosen: number | null;
  /** 渡すと押せるボタンにする。渡さなければ、押せない一覧にする（回答済み・締切のあと） */
  onChoose?: (choiceIndex: number) => void;
  /** 押せない一覧を出したときに、一覧へフォーカスを移す。押したボタンが消えてフォーカスが落ちるので、この画面で押した直後だけ渡す */
  focusList?: boolean;
}

/**
 * 選択肢の早押しパネル（F10・F17）。色だけに頼らず、必ず番号と一緒に出す。
 * Tailwind はクラス名を文字列のまま探すので、色のクラスは組み立てずに選択肢ごとに書いておく
 */
const panelColors = [
  { panel: 'bg-choice-1 text-on-choice', badge: 'bg-stage/25' },
  { panel: 'bg-choice-2 text-on-choice', badge: 'bg-stage/25' },
  { panel: 'bg-choice-3 text-on-choice', badge: 'bg-stage/25' },
  // 黄色の上は白い字が読めないので、濃い字にする
  { panel: 'bg-choice-4 text-on-choice-4', badge: 'bg-stage/15' },
] as const;

/** 1回押したら選び直せない。二度押しを止めるのは、送る側（QuestionView）の役目 */
export function AnswerButtons({ choices, chosen, onChoose, focusList = false }: AnswerButtonsProps) {
  if (onChoose === undefined) {
    return <AnsweredList choices={choices} chosen={chosen} focus={focusList} />;
  }
  return (
    <div className="mt-6 flex flex-1 flex-col gap-3">
      {choices.map((choice, index) => (
        <button
          // 選択肢は受付中に変わらないので、番号を key にしてよい
          key={index}
          type="button"
          onClick={() => onChoose(index)}
          className={`flex max-h-40 min-h-16 flex-1 items-center gap-4 rounded-panel px-4 py-3 text-left text-xl font-bold shadow-panel focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-on-stage active:translate-y-1.5 active:shadow-none ${panelColors[index].panel}`}
        >
          <ChoiceNumber index={index} className={panelColors[index].badge} />
          <span className="min-w-0 wrap-anywhere">{choice}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 回答済みと締切のあと。選んだものだけを色で残し、ほかは薄くする。
 * フォーカスは受けられるが Tab では止まらない（tabIndex={-1}）。枠は :focus-visible に任せ、キーボードで押したときだけ出す
 */
function AnsweredList({ choices, chosen, focus }: { choices: string[]; chosen: number | null; focus: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  // 出した直後に1回だけ移す。残りの秒で描き直すたびに移すと、読み上げソフトが一覧の名前を読み直す
  useLayoutEffect(() => {
    if (focus) {
      listRef.current?.focus();
    }
  }, [focus]);

  return (
    <ul
      ref={listRef}
      tabIndex={-1}
      aria-label={chosen === null ? '選択肢' : 'あなたの回答'}
      // 選んだ項目の ring は ring-offset と合わせて 8px はみ出すので、枠はその外に出す
      className="mt-6 flex flex-col gap-3 rounded-panel focus-visible:outline-4 focus-visible:outline-offset-12 focus-visible:outline-on-stage"
    >
      {choices.map((choice, index) =>
        index === chosen ? (
          <li
            key={index}
            className={`flex items-center gap-4 rounded-panel px-4 py-3 text-xl font-bold ring-4 ring-on-stage ring-offset-4 ring-offset-stage ${panelColors[index].panel}`}
          >
            <ChoiceNumber index={index} className={panelColors[index].badge} />
            <span className="min-w-0 wrap-anywhere">{choice}</span>
            <span className="ml-auto shrink-0 text-base">あなたの回答</span>
          </li>
        ) : (
          <li
            key={index}
            className="flex items-center gap-4 rounded-panel bg-stage-raised px-4 py-3 text-xl font-bold text-on-stage-muted opacity-60"
          >
            <ChoiceNumber index={index} className="bg-stage" />
            <span className="min-w-0 wrap-anywhere">{choice}</span>
          </li>
        ),
      )}
    </ul>
  );
}

function ChoiceNumber({ index, className }: { index: number; className: string }) {
  return (
    <span className={`grid size-11 shrink-0 place-items-center rounded-full font-display text-2xl ${className}`}>
      {index + 1}
    </span>
  );
}
