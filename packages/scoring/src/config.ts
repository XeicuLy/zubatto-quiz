/** F12 の早押しボーナス。経過時間が withinMs 以内（ちょうども含む）で正解したら points を足す */
export type QuickBonus = {
  withinMs: number;
  points: number;
};

/**
 * 配点の設定値（要件定義書「スコアの計算」の「設定値」）。配点を変えるときは、ここだけを変える（M2）。
 * 0.01秒単位の切り捨て・速さの点を直線で減らすこと・ボーナスの「以内」は式（score.ts）で決め、設定値にはしない
 */
export type ScoringConfig = {
  /** 正解したときの基本点 */
  basePoints: number;
  /** 速さによる点の上限。経過時間が0秒のときの点 */
  maxSpeedPoints: number;
  /** F12 の早押しボーナス。入れなければ、ボーナスはいつも0点（式の3） */
  quickBonus?: QuickBonus;
};

export const defaultScoring: ScoringConfig = {
  basePoints: 500,
  maxSpeedPoints: 500,
  quickBonus: { withinMs: 1000, points: 200 },
};

/**
 * 回答時間の下限（flooredElapsedMs）で、サーバーから見た経過時間から引く通信の余裕（ミリ秒）。
 *
 * 端末の時計は受付開始のメッセージが届いて選択肢を描いてから動き始めるので、正直な申告は、サーバーから見た経過時間より
 * 「下りの配信 + 描画 + 回答の上り」のぶん小さい。余裕はこの差を吸う。P1 は下りの配信に1秒を見込んでいて、
 * O2 のリハーサル（2026-10）で測った下りは最大 82 ms だった。1秒あれば、会場の Wi-Fi で往復がその10倍遅れても、正直な人の時間は変わらない。
 * 差が1秒を超えた正直な回答は、超えたぶんだけ長く記録される。サーバーには、正直な遅れとごまかしを見分ける手がかりが無い。
 * 余裕は、申告をごまかした端末が縮められる時間の上限でもある。大きくすると、0 を送った端末が早押しボーナスを取りやすくなる
 */
export const ANSWER_TIME_ALLOWANCE_MS = 1_000;
