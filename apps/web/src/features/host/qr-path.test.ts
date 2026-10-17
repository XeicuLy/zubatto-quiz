import { describe, expect, it } from 'vitest';

import { qrPathOf } from './qr-path';

/** '#' を黒いマス、'.' を白いマスとして、マスの2次元配列にする */
const modules = (...rows: string[]) => rows.map((row) => [...row].map((cell) => cell === '#'));

describe('qrPathOf: QR のマスを、1本の path の d にする', () => {
  it.each<[string, boolean[][], string]>([
    ['白いマスだけなら、何も描かない', modules('..', '..'), ''],
    ['黒いマス1つは、1×1 の四角', modules('.#', '..'), 'M1 0h1v1h-1z'],
    ['横に続く黒いマスは、1本の四角にまとめる', modules('###.', '....'), 'M0 0h3v1h-3z'],
    ['白いマスで切れたら、別の四角にする', modules('#.##'), 'M0 0h1v1h-1zM2 0h2v1h-2z'],
    ['行の右端で終わる黒いマスも描く', modules('..', '.#'), 'M1 1h1v1h-1z'],
    ['縦に並んでも、行ごとに分ける', modules('#.', '#.'), 'M0 0h1v1h-1zM0 1h1v1h-1z'],
  ])('%s', (_case, input, expected) => {
    expect(qrPathOf(input)).toBe(expected);
  });
});
