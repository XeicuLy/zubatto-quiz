/**
 * 進行画面で選択肢を出すときの色。受付中の選択肢と ① の回答の分布で使う。色だけに頼らず、必ず番号と一緒に出す。
 * Tailwind はクラス名を文字列のまま探すので、色のクラスは組み立てずに選択肢ごとに書いておく
 */
export const choiceColors = [
  {
    panel: 'bg-choice-1 text-on-choice',
    badge: 'bg-stage/25',
    badgeMuted: 'bg-choice-1 text-on-choice',
    bar: 'bg-choice-1/35',
  },
  {
    panel: 'bg-choice-2 text-on-choice',
    badge: 'bg-stage/25',
    badgeMuted: 'bg-choice-2 text-on-choice',
    bar: 'bg-choice-2/35',
  },
  {
    panel: 'bg-choice-3 text-on-choice',
    badge: 'bg-stage/25',
    badgeMuted: 'bg-choice-3 text-on-choice',
    bar: 'bg-choice-3/35',
  },
  // 黄色の上は白い字が読めないので、濃い字にする
  {
    panel: 'bg-choice-4 text-on-choice-4',
    badge: 'bg-stage/15',
    badgeMuted: 'bg-choice-4 text-on-choice-4',
    bar: 'bg-choice-4/35',
  },
] as const;

/** 選択肢の番号（1から）を丸で囲んで出す。進行画面（投影）だけで使うので、飾り文字にする */
export function ChoiceNumber({ index, className }: { index: number; className: string }) {
  return (
    <span className={`grid size-[1.6em] shrink-0 place-items-center rounded-full font-numeral ${className}`}>
      {index + 1}
    </span>
  );
}
