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
