/**
 * アクセス解析の書き込みの窓口（O4・ADR 0015）。Analytics Engine へは、このファイルからだけ書く。
 *
 * 引数は決まった名前の型だけを受けるので、部屋 ID・名前・セット名・IP・ownerId を渡す口がない。
 * 何を書くか・書かないかは docs/architecture/backend.md の「計測」にある
 */

/**
 * 部屋と問題セットの出来事の名前。データ点の index1 に入れる。
 * Analytics Engine は index ごとに間引くので、数の多い answer_accepted が先に間引かれ、ほかは間引かれにくい。
 * 画面ごとの PV（page_view）は、ルートのテンプレートを書く別の関数で足す（#368）
 */
export const EVENT_NAMES = [
  'room_created',
  'question_set_created',
  'participant_joined',
  'game_started',
  'final_reached',
  'room_ended',
  'answer_accepted',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/**
 * 書き込み先の binding。wrangler.jsonc の先頭（本番）にだけあり、env.e2e にはないので、E2E では undefined になる。
 * Env 全体ではなくこれだけを受けるので、Worker の env も DO の env もそのまま渡せる
 */
export interface AnalyticsEnv {
  readonly ANALYTICS?: AnalyticsEngineDataset;
}

/** blob1。ふつうの利用は app。負荷試験のボットを見分ける bot は #369 で足す */
const SOURCE = 'app';

/**
 * 出来事を1点書く。room_ended は終えたときの段階（blob3）が要るので、ここでは書けない（#367）。
 * blob2（PV のルート）と blob3（room_ended の段階）は空にして、どの出来事も同じ3つの欄を書く。doubles は使わない
 */
export function recordEvent(env: AnalyticsEnv, name: Exclude<EventName, 'room_ended'>): void {
  write(env, name, [SOURCE, '', '']);
}

/**
 * writeDataPoint はすぐに戻るので await しない。上限を超えたときに投げるかは文書にないので try/catch で包み、
 * 失敗しても投げ返さず、ログにも出さない。解析のために API の応答や部屋の進行を止めない（A1）
 */
function write(env: AnalyticsEnv, index: EventName, blobs: [source: string, route: string, phase: string]) {
  try {
    env.ANALYTICS?.writeDataPoint({ indexes: [index], blobs });
  } catch {
    // 数が欠けるだけにする。理由はログに出さない（ログの約束: docs/runbooks/logs.md）
  }
}
