/**
 * 再接続用の秘密の SHA-256（32バイト）。参加者の表には、秘密そのものではなくこれを入れる（ADR 0004）。
 * join で保存するときと、resume で比べるとき（T20）の両方で使う
 */
export const hashToken = (token: string): Promise<ArrayBuffer> =>
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
