import { playerTokenSchema } from '@zubatto-quiz/protocol';

/**
 * 回答者の再接続用の秘密を作り、部屋ごとに localStorage へ保存する（ADR 0004）。
 * 秘密は join で送る前に保存する。join の返事が届く前に切れても、保存した秘密の resume で同じ回答者に戻れる。
 * 秘密はページの URL にもログにも出さない。
 *
 * localStorage は、プライベートブラウズや設定で使えないと例外を投げる。ここで受け止め、画面を止めない
 */

const TOKEN_BYTES = 32;

export function tokenKey(roomId: string): string {
  return `zubakui:room:${roomId}:token`;
}

/** 32バイトの乱数を base64url（= なし）の43文字にする。protocol の playerTokenSchema の形 */
export function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  // btoa は1文字を1バイトとして扱うので、バイトの並びを文字コードの並びに置き換えてから渡す
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** 保存した秘密を読む。無いとき・読めないとき・形が違うときは null */
export function loadToken(roomId: string): string | null {
  let value: string | null;
  try {
    value = localStorage.getItem(tokenKey(roomId));
  } catch {
    return null;
  }
  return playerTokenSchema.safeParse(value).success ? value : null;
}

/** 保存できたら true。false のときは、タブのメモリだけで秘密を持つので、読み込み直すと戻れない */
export function saveToken(roomId: string, token: string): boolean {
  try {
    localStorage.setItem(tokenKey(roomId), token);
    return true;
  } catch {
    return false;
  }
}

export function clearToken(roomId: string): void {
  try {
    localStorage.removeItem(tokenKey(roomId));
  } catch {
    // 消せなくても、次の resume が resume_failed で閉じられ、そのときにまた消しにくるだけなので進める
  }
}
