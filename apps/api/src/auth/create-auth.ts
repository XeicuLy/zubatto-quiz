import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';

import { createDb } from '@/db';
import * as schema from '@/db/schema';

import { isAllowedGithubUser, isAllowedUser } from './allowlist';
import { EMPTIED_ACCOUNT_FIELDS, EMPTIED_SESSION_FIELDS, hostUserFromGithub } from './host-data-policy';

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
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        // 公開のプロフィール（ID と login）だけで足りるので、scope を求めない（ADR 0016 の U1）。
        // 既定の read:user・user:email を外すと、認可の URL に scope が付かない。/user/emails は失敗するが、Better Auth は応答を捨てる
        disableDefaultScope: true,
        // 本名・email・アバターを保存せず、login と合成の email を入れる（ADR 0016、host-data-policy.ts）
        mapProfileToUser: hostUserFromGithub,
      },
    },
    // トークンは account の hook で空にする。空にできなかったとき（Better Auth の版を上げて hook が効かなくなったときなど）に
    // 平文で残らないよう、暗号化も残しておく（ADR 0016）
    account: { encryptOAuthTokens: true },
    // 本番の約2時間とその前の準備の間にログインが切れないよう、7日にし、使っていれば1日ごとに延ばす（ADR 0003）
    session: { expiresIn: 7 * DAY_SECONDS, updateAge: DAY_SECONDS },
    // 既定と同じ値でも書いておき、Better Auth の既定が変わってもこの判断のとおりに動かす。
    // Secure と __Secure- は baseURL が https で始まるかで決まるので、secure と useSecureCookies は書かない（ADR 0003）
    advanced: {
      defaultCookieAttributes: { sameSite: 'lax' },
      // 要求から IP を読まない。session の ip_address に入れないため（ADR 0016）。Better Auth の rate limiter も IP を鍵にできなくなる
      ipAddress: { disableIpTracking: true },
    },
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
      // 1回目のログインでは create、2回目からは update が呼ばれる。どちらでもトークンと scope を空にする（ADR 0016）。
      // 2回目に渡る値には scope が無いが、空にした値を重ねるので、前に保存した scope もここで消える
      account: {
        create: { before: async (data) => ({ data: { ...data, ...EMPTIED_ACCOUNT_FIELDS } }) },
        update: { before: async (data) => ({ data: { ...data, ...EMPTIED_ACCOUNT_FIELDS } }) },
      },
      session: {
        create: {
          // セッションを作るたび（ログインのたび）に確かめる。許可リストから外したホストは、次のログインで拒否される（ADR 0003）
          before: async (session) => {
            if (!(await isAllowedUser(db, session.userId))) {
              throw new APIError('FORBIDDEN', { code: HOST_NOT_ALLOWED, message: HOST_NOT_ALLOWED });
            }
            // User-Agent を保存しない。IP は disableIpTracking で読まないが、ほかの経路で入っても同じ規則で空にする（ADR 0016）
            return { data: { ...session, ...EMPTIED_SESSION_FIELDS } };
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

/** 本番の auth インスタンス。D1 の binding を使うので、リクエストごとに作る */
export const createAuth = (env: Env) => betterAuth(createAuthOptions(env));

export type Auth = ReturnType<typeof createAuth>;
