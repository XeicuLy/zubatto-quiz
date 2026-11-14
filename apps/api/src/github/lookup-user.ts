import { githubLoginSchema } from '@zubatto-quiz/protocol';
import * as z from 'zod';

/** GitHub の名前から ID を引いた結果 */
export type GithubUserLookup =
  /** User が見つかった。githubUserId は許可リストと同じ数の文字列、login は GitHub が返した書き方 */
  | { kind: 'found'; githubUserId: string; login: string }
  /** その名前の User がない（形の違う名前・GitHub の 404・Organization） */
  | { kind: 'notFound' }
  /** GitHub が答えなかった（403・429・5xx・時間切れ・形の違う応答） */
  | { kind: 'unavailable' };

/** 送り先。名前のほかは固定にし、名前で別のホストや経路へ向けられないようにする */
const USERS_URL = 'https://api.github.com/users/';

/** GitHub を待つ時間。管理者が画面で待つので、上限に当たったときも早めに 502 で返す */
const TIMEOUT_MS = 5_000;

/** GET /users/{username} の応答のうち、使う項目。ほかの項目は読まない */
const githubUserSchema = z.object({
  id: z.int().positive(),
  login: z.string(),
  type: z.string(),
});

/**
 * GitHub の名前から数値の ID を引く（ADR 0013）。Worker が外へ fetch する唯一の経路。
 *
 * 未認証の GET /users/{username} を使う。上限は送り元の IP ごとに60回/時で、Workers の出口の IP は共有なので、
 * こちらが使っていなくても尽きていることがある。そのときは unavailable を返し、管理者が時間をおいて入れ直す。
 * 名前は先に githubLoginSchema で形を確かめ、合わなければ送らない。そのうえで encodeURIComponent で経路に入れる。
 * 名前も ID もログに出さない
 */
export async function lookupGithubUser(login: string): Promise<GithubUserLookup> {
  const parsedLogin = githubLoginSchema.safeParse(login);
  if (!parsedLogin.success) {
    return { kind: 'notFound' };
  }

  let response: Response;
  try {
    response = await fetch(`${USERS_URL}${encodeURIComponent(parsedLogin.data)}`, {
      // GitHub の API は User-Agent のない要求を断る
      headers: { 'User-Agent': 'zubakui-api', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // 時間切れ（TimeoutError）と通信の失敗
    return { kind: 'unavailable' };
  }

  if (response.status === 404) {
    return { kind: 'notFound' };
  }
  if (!response.ok) {
    // 403・429 は上限、5xx は GitHub の不調。どれも時間をおけば通りうる
    return { kind: 'unavailable' };
  }

  const user = githubUserSchema.safeParse(await response.json().catch(() => undefined));
  if (!user.success) {
    return { kind: 'unavailable' };
  }
  // Organization はログインできないので、許可リストに入れても意味がない
  if (user.data.type !== 'User') {
    return { kind: 'notFound' };
  }
  return { kind: 'found', githubUserId: String(user.data.id), login: user.data.login };
}
