const pointsFormat = new Intl.NumberFormat('ja-JP');

/** 点数を3桁ごとに区切って出す（例: 2410 → "2,410"） */
export function formatPoints(points: number): string {
  return pointsFormat.format(points);
}

/** 「2 アニソン」のように、番号と選択肢を並べる。番号は1から。選択肢が届いていなければ番号だけ */
export function choiceLabel(index: number, choices: string[] | null): string {
  const text = choices?.[index];
  return text === undefined ? String(index + 1) : `${index + 1} ${text}`;
}
