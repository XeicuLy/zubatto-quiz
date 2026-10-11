/** 伏せた値の代わりに入れる文字列 */
export const REDACTED = '[REDACTED]';

/**
 * ログに出す前に、再接続用の秘密（token）を伏せる（ADR 0004）。
 *
 * - 検査に通らなかったメッセージもログに出すので、形を決めつけずに、入れ子の中の token も伏せる
 * - 渡した値は書き換えず、伏せた写しを返す
 * - JSON として読めなかった文字列は、ここを通さずに、長さだけをログに出す
 */
export function redactToken(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactToken);
  }
  // 文字列・数・null などは、たどる先がないのでそのまま返す（typeof null は 'object' になるので別に見る）
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  // token は値の型によらず伏せ、ほかのキーは中をさらにたどる。新しいオブジェクトを作るので、元は書き換わらない
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, key === 'token' ? REDACTED : redactToken(inner)]),
  );
}
