import { useMemo } from 'react';
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
 * 色はトークンに合わせ、強制カラーモードでも明るい地に暗いマスのまま描く
 */
export function JoinQrCode({ url }: { url: string }) {
  // 参加者が入るたびに待機画面は描き直されるので、URL が変わったときだけ作り直す
  const { size, d } = useMemo(() => {
    const qr = encode(url, { ecc: 'M', boostEcc: true, border: QUIET_ZONE });
    return { size: qr.size, d: qrPathOf(qr.data) };
  }, [url]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="参加用 URL の QR コード"
      className="size-[clamp(12rem,14vw,16rem)] shrink-0 rounded-chip bg-on-stage text-stage forced-color-adjust-none"
    >
      {/* crispEdges にしないと、隣り合う四角の境目がにじんで細い線が出ることがある */}
      <path fill="currentColor" shapeRendering="crispEdges" d={d} />
    </svg>
  );
}
