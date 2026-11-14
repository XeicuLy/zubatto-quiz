import { fileURLToPath } from 'node:url';

import type { PluginConfig } from '@cloudflare/vite-plugin';
import type { ConfigEnv } from 'vite';

type AuxiliaryWorker = NonNullable<PluginConfig['auxiliaryWorkers']>[number];

/** vite dev の API の Worker の入口。本番の app に Swagger UI（ADR 0011）だけを足す */
const DEV_ENTRY = fileURLToPath(new URL('../api/test/dev-entry.ts', import.meta.url));

/**
 * 画面の Vite が一緒に動かす API の Worker（auxiliaryWorkers）の設定。
 *
 * vite dev のときだけ、main を開発の入口に替え、/api/docs で Swagger UI を開けるようにする。
 * 開発のときだけにするのは、どの入口をバンドルするかで分け、実行時の環境変数では分けない。設定の誤りひとつで、
 * 回答者の secret がある本番のオリジンに外部の CDN のスクリプトが出るため（ADR 0011）。
 * wrangler.jsonc に env を足さないのは、Worker の名前が変わると、部屋の DO のデータの置き場所
 * （.wrangler/state/v3/do/<Worker の名前>-RoomDurableObject）が変わり、開発の部屋が見えなくなるため
 */
export function apiWorker({ command, isPreview }: Pick<ConfigEnv, 'command' | 'isPreview'>): AuxiliaryWorker {
  const configPath = '../api/wrangler.jsonc';
  // vite preview（e2e:serve）は、ビルドした Worker をそのまま動かす。ビルドは本番と同じ入口のままにする
  if (command !== 'serve' || isPreview === true) return { configPath };
  return { configPath, config: { main: DEV_ENTRY } };
}
