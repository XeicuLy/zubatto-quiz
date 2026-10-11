import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';

import { createDb } from '../db';
import * as schema from '../db/schema';
import { isAllowedGithubUser, isAllowedUser } from './allowlist';

const DAY_SECONDS = 60 * 60 * 24;

/** 許可リストの外の人を拒否したときのエラーの名前。GitHub のログインの失敗では、画面の URL の ?error= に入る */
export const HOST_NOT_ALLOWED = 'host_not_allowed';

/**
 * Better Auth の設定（ADR 0003・0006）。
 *
 * 本番の createAuth と、テスト専用の auth インスタンス（test/auth/create-test-auth.ts）で共有する。
 * テスト専用の auth インスタンスは、これに testUtils の plugin を足すだけにして、許可リストの確認をテストでも同じに動かす。
 */
export function createAuthOptions(env: Env) {
  const db = createDb(env.DB);

  return {
    // ブラウザからは画面の Worker の /api/auth/* に見える。GitHub のコールバック URL は <baseURL>/api/auth/callback/github になる
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    socialProviders: {
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
    // GitHub のアクセストークンは使わないが、Better Auth は account に保存する。D1 が漏れても使えないよう、secret で暗号化して保存する
    account: { encryptOAuthTokens: true },
    // 本番の約2時間とその前の準備の間にログインが切れないよう、7日にし、使っていれば1日ごとに延ばす（ADR 0003）
    session: { expiresIn: 7 * DAY_SECONDS, updateAge: DAY_SECONDS },
    // 既定と同じ値でも書いておき、Better Auth の既定が変わってもこの判断のとおりに動かす。
    // Secure と __Secure- は baseURL が https で始まるかで決まるので、secure と useSecureCookies は書かない（ADR 0003）
    advanced: { defaultCookieAttributes: { sameSite: 'lax' } },
    user: {
      // 新しく登録するとき（と、GitHub でログインし直すとき）に、GitHub のプロフィールの ID で許可リストを確かめる（S1・ADR 0003）。
      // user を作る前に呼ばれるので、拒否すれば user の行も残らない。D1 ではトランザクションが使えず、
      // account.create.before で拒否すると、先に作られた user の行だけが残ってしまうので、そこでは確かめない
      validateUserInfo: async ({ source }) => {
        const githubUserId = source.oauth?.providerId === 'github' ? source.oauth.profile?.id : undefined;
        // GitHub 以外の方法（今はない）と、ID の形が想定と違うときも拒否の側に倒す
        if (typeof githubUserId !== 'number' && typeof githubUserId !== 'string') {
          return { error: HOST_NOT_ALLOWED };
        }
        // Better Auth は account.account_id に String(profile.id) を入れるので、許可リストとも文字列で比べる
        if (!(await isAllowedGithubUser(db, String(githubUserId)))) {
          return { error: HOST_NOT_ALLOWED };
        }
      },
    },
    databaseHooks: {
      session: {
        create: {
          // セッションを作るたび（ログインのたび）に確かめる。許可リストから外したホストは、次のログインで拒否される（ADR 0003）
          before: async (session) => {
            if (!(await isAllowedUser(db, session.userId))) {
              throw new APIError('FORBIDDEN', { code: HOST_NOT_ALLOWED, message: HOST_NOT_ALLOWED });
            }
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

/** 本番の auth インスタンス。D1 の binding を使うので、リクエストごとに作る */
export const createAuth = (env: Env) => betterAuth(createAuthOptions(env));

export type Auth = ReturnType<typeof createAuth>;
