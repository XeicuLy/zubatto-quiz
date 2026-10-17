/**
 * QR のマス（true が黒）を、1本の SVG path の d にする。1マスが座標の1に当たる。
 * 行ごとに、横に続く黒いマスを1つの四角にまとめるので、d が短くなり、要素も1つで済む。
 * ライブラリが返す SVG の文字列は innerHTML 系の API でしか入れられないので使わず、JSX の <path> に渡す（ADR 0004）
 */
export function qrPathOf(modules: readonly (readonly boolean[])[]): string {
  let d = '';
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (row[x]) x++;
      const width = x - start;
      d += `M${start} ${y}h${width}v1h-${width}z`;
    }
  });
  return d;
}
