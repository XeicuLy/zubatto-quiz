import { encode } from 'uqr';

import { qrPathOf } from './qr-path';

/**
 * 規格が求める、まわりの余白（クワイエットゾーン）のマスの数。
 * 余白も viewBox のマスに含めるので、大きさを変えてもマスとの比が保たれる
 */
const QUIET_ZONE = 4;

/**
 * 参加用 URL の QR コード（F1）。投影した画面をスマホのカメラで読むだけで入れるようにする。
 * 誤り訂正は、投影の反射やぼけを考えて M 以上にする。boostEcc は、マスの数が同じまま入るなら Q・H に上げる。
 * 色はトークンに合わせ、強制カラーモードでも明るい地に暗いマスのまま描く。
 * 大きさは幅（vw）と高さ（vh）の小さいほうで決め、投影の待機画面がスクロールなしの1画面に収まるようにする
 */
export function JoinQrCode({ url }: { url: string }) {
  const { size, data } = encode(url, { ecc: 'M', boostEcc: true, border: QUIET_ZONE });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="参加用 URL の QR コード"
      className="size-[clamp(12rem,min(21vw,36vh),28rem)] shrink-0 rounded-chip bg-primary text-primary-foreground forced-color-adjust-none"
    >
      {/* crispEdges にしないと、隣り合う四角の境目がにじんで細い線が出ることがある */}
      <path fill="currentColor" shapeRendering="crispEdges" d={qrPathOf(data)} />
    </svg>
  );
}
