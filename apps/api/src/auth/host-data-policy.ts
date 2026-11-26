/**
 * ホストについて D1 に何を保存するかの規則（ADR 0016、要件 S5）。
 *
 * アプリが読むのは user.id・user.name・account.account_id だけなので、それ以外の個人情報は持たない。
 * ログインの hook（create-auth.ts）と、既にある行の1回の書き換え（#347）の両方が、ここから値を引く。
 * 規則を1か所に置くのは、2つの経路で行の形がずれないようにするため。Go 版も同じ列に同じ値を入れる（ADR 0008）
 */

/** 合成の email のドメイン。.invalid は届かないことが決まっているトップレベルドメイン（RFC 6761） */
const SYNTHETIC_EMAIL_DOMAIN = 'users.zubakui.invalid';

/**
 * GitHub の ID から作る email。Better Auth は user.email に NOT NULL UNIQUE を求めるので、本物の代わりに入れる。
 * 中身は account.account_id にある ID だけなので、新しく分かることは無く、#347 でも同じ値を作り直せる
 */
export const syntheticEmail = (githubUserId: string) => `${githubUserId}@${SYNTHETIC_EMAIL_DOMAIN}`;

/**
 * GitHub のプロフィールから、user の行に入れる値を作る（github の mapProfileToUser）。
 * Better Auth は既定の値（本名・本物の email・アバター）の上にこの値を重ねるので、4つとも必ず書く。
 * image は、Better Auth の型が null を受けないので undefined をキーごと書く。キーがあれば既定のアバターを上書きし、D1 には NULL が入る。
 * emailVerified を false にすると、email の一致による別のアカウントとの暗黙の連携も止まる。
 * id は、Better Auth の型では string だが、GitHub の応答では number なので、どちらも受ける
 */
export const hostUserFromGithub = (profile: { id: string | number; login: string }) => ({
  name: profile.login,
  email: syntheticEmail(String(profile.id)),
  emailVerified: false,
  image: undefined,
});

/** account の行で空にする列。GitHub のトークンは使わないので持たない（scope は2回目のログインでは Better Auth が渡さない） */
export const EMPTIED_ACCOUNT_FIELDS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  scope: null,
} as const;

/** session の行で空にする列。ログインしたときの IP と User-Agent は使わないので持たない */
export const EMPTIED_SESSION_FIELDS = {
  ipAddress: null,
  userAgent: null,
} as const;
