import { describe, expect, expectTypeOf, it } from 'vitest';

import { createFakeAnalytics, createThrowingAnalytics } from '../../test/fake-analytics';
import { EVENT_NAMES, recordEvent, type AnalyticsEnv, type EventName } from './record';

/** recordEvent で書ける出来事。room_ended は終えたときの段階が要るので、別の関数で書く（#367） */
const SIMPLE_EVENTS = EVENT_NAMES.filter((name): name is Exclude<EventName, 'room_ended'> => name !== 'room_ended');

describe('recordEvent（O4・ADR 0015）', () => {
  it.each(SIMPLE_EVENTS)('%s を、index に名前、blob1 に source、blob2・blob3 を空にした1点として書く', (name) => {
    const analytics = createFakeAnalytics();

    recordEvent({ ANALYTICS: analytics }, name);

    // doubles は使わない。部屋 ID や名前の入る欄はない
    expect(analytics.points).toEqual([{ indexes: [name], blobs: ['app', '', ''] }]);
  });

  it('binding がない環境（E2E）では何もしない', () => {
    expect(() => recordEvent({}, 'room_created')).not.toThrow();
  });

  it('writeDataPoint が投げても、投げ返さない。解析のために進行を止めない（A1）', () => {
    const analytics = createThrowingAnalytics();

    expect(() => recordEvent({ ANALYTICS: analytics }, 'room_created')).not.toThrow();
    expect(analytics.calls()).toBe(1);
  });

  it('引数は binding と決まった名前だけで、部屋 ID・名前・ownerId を渡す口がない（S3・S5）', () => {
    expectTypeOf(recordEvent).parameters.toEqualTypeOf<[AnalyticsEnv, Exclude<EventName, 'room_ended'>]>();
    // 呼び出さず、型だけを確かめる。pnpm run tsc はテストのファイルも検査するので、型エラーが出なくなると
    // 「使われていない @ts-expect-error」で CI が落ちる
    const outsideTheList = () => [
      // @ts-expect-error 決まった名前のほかの文字列（部屋 ID など）は渡せない
      recordEvent({}, '0123456789abcdef'),
      // @ts-expect-error 3つ目の引数はない
      recordEvent({}, 'room_created', { roomId: 'x' }),
      // @ts-expect-error room_ended は終えたときの段階が要るので、ここでは書けない（#367）
      recordEvent({}, 'room_ended'),
    ];

    expect(outsideTheList).toBeTypeOf('function');
  });

  it('出来事の名前は index の上限（96バイト）に収まる', () => {
    for (const name of EVENT_NAMES) {
      expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(96);
    }
  });
});
