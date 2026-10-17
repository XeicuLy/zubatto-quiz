import { useState } from 'react';

import { JoinQrCode } from './JoinQrCode';

type CopyStatus = 'idle' | 'copied' | 'failed';

const copyMessages: Record<CopyStatus, string> = {
  idle: '',
  copied: 'コピーしました',
  failed: 'コピーできませんでした。URL を選んでコピーしてください',
};

/**
 * 参加用の URL（F1）。会場ではカメラで QR を読むのがいちばん早く、QR を読めない人のために URL も vw で伸びる文字で全部出す。
 * URL は推測できない64桁の ID を含んで長いので（S3）、どこでも折り返す
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
      className="flex flex-col gap-4 self-start rounded-panel bg-stage-raised p-stage"
    >
      <h2 id="join-url-heading" className="font-display text-stage-title">
        スマホで参加
      </h2>
      {/* 文字の側は 14rem を基準にする。flex-1（基準 0）だと折り返さず、スマホでは QR の横に細く押し込まれる。
          投影では QR の横に並び、ホストのスマホ（390px）では QR の下に回る */}
      <div className="flex flex-wrap items-center gap-stage">
        <JoinQrCode url={joinUrl} />
        <div className="flex min-w-0 grow basis-56 flex-col gap-4">
          <div>
            <p className="text-stage-label text-on-stage-muted">
              カメラで読み取るか、この URL を開いて、名前を入れてください
            </p>
            <p className="mt-1 text-stage-title font-bold wrap-anywhere">{joinUrl}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-full border-2 border-on-stage-muted px-5 py-2 text-stage-label font-bold focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-on-stage"
            >
              URL をコピー
            </button>
            {/* 知らせる場所は先に置いておき、文だけを替える。あとから足した role="status" は読み上げられないことがある */}
            <p role="status" className="text-stage-label">
              {copyMessages[status]}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
