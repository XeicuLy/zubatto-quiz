/**
 * Analytics Engine の binding（ANALYTICS）の代わり（ADR 0015）。
 *
 * ローカルの本物の binding は書き込みを捨てるので、何が書かれたかをテストから読めない。
 * これを env の ANALYTICS に入れ、書かれたデータ点を書かれた順に集める。
 * ルートのテストでは、app.request の env に入れて渡す（host-request.ts の apiRequestAs の bindings）
 */
export interface FakeAnalytics extends AnalyticsEngineDataset {
  /** 書かれた順のデータ点 */
  readonly points: readonly AnalyticsEngineDataPoint[];
}

/** 書き込みを集める binding を作る */
export function createFakeAnalytics(): FakeAnalytics {
  const points: AnalyticsEngineDataPoint[] = [];
  return {
    points,
    writeDataPoint(point) {
      if (point) {
        points.push(point);
      }
    },
  };
}

/**
 * 書き込みのたびに投げる binding。上限を超えたときの動きは文書にないので、投げる場合を確かめる（ADR 0015）。
 * calls は呼ばれた回数で、投げる所まで届いたこと（確かめが空振りしていないこと）を見るために使う
 */
export function createThrowingAnalytics(): AnalyticsEngineDataset & { readonly calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    writeDataPoint() {
      calls += 1;
      throw new Error('writeDataPoint failed');
    },
  };
}
