import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { JoinQrCode } from './JoinQrCode';

type CopyStatus = 'idle' | 'copied' | 'failed';

const copyMessages: Record<CopyStatus, string> = {
  idle: '',
  copied: 'コピーしました',
  failed: 'コピーできませんでした。URL を選んでコピーしてください',
};

/**
 * 参加用の URL（F1）。会場ではカメラで QR を読むのがいちばん早いので、QR を主役にする。
 * URL は推測できない64桁の ID を含んで長く（S3）、手で打つ人はいない。QR を読めない人がホストの近くで読めるよう、
 * QR の下にカードの幅いっぱいで小さく出し、どこでも折り返す。人に送るときは「URL をコピー」を使う
 */
export function JoinUrlCard({ joinUrl }: { joinUrl: string }) {
  const [status, setStatus] = useState<CopyStatus>('idle');

  async function copy() {
    // 権限がないと書き込みが断られ、http のページ（localhost 以外）では navigator.clipboard そのものが無い。
    // どちらも catch に入るので、URL を選んで手でコピーしてもらう
    try {
      await navigator.clipboard.writeText(joinUrl);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <section
      aria-labelledby="join-url-heading"
      className="flex flex-col gap-4 self-start rounded-panel bg-card p-stage"
    >
      <h2 id="join-url-heading" className="text-stage-title font-bold">
        スマホで参加
      </h2>
      {/* 文字の側は 14rem を基準にする。flex-1（基準 0）だと折り返さず、スマホでは QR の横に細く押し込まれる。
          投影では QR の横に並び、ホストのスマホ（390px）では QR の下に回る */}
      <div className="flex flex-wrap items-center gap-stage">
        <JoinQrCode url={joinUrl} />
        <div className="flex min-w-0 grow basis-56 flex-col gap-4">
          {/* QR の横の狭い列で折れるので、文節で改行し、最後の1文字だけが次の行に落ちないようにする */}
          <p className="text-stage-label text-phrase text-muted-foreground">
            カメラで読み取るか、下の URL を開いて、名前を入れてください
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button variant="outline" size="stage" onClick={() => void copy()}>
              URL をコピー
            </Button>
            {/* 知らせる場所は先に置いておき、文だけを替える。あとから足した role="status" は読み上げられないことがある */}
            <p role="status" className="text-stage-label">
              {copyMessages[status]}
            </p>
          </div>
        </div>
      </div>
      <p className="text-stage-label wrap-anywhere text-muted-foreground">{joinUrl}</p>
    </section>
  );
}
