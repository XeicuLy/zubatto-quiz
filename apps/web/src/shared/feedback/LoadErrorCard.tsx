import { Link, type LinkProps } from '@tanstack/react-router';

import { Card } from '@/components/ui/card';

import { describeApiError } from './api-error';

interface LoadErrorCardProps {
  /** 投げられた値。ルートの errorComponent の error は unknown なので、そのまま渡せる */
  error: unknown;
  /** 読めなかったときの見出し。「問題セットを読めませんでした」 */
  failed: string;
  /** 「もう一度読む」で呼ぶ。query なら refetch、ルートの loader なら router.invalidate */
  retry: () => void;
  /** 404 の見出し・説明・戻り先。省くと、ほかの失敗と同じく failed と「もう一度読む」を出す */
  notFound?: { title: string; detail: string; back: { to: LinkProps['to']; label: string } };
  /** 見出しの要素。カードが画面の中身のすべて（ルートの errorComponent）なら h1、画面の見出しの下に置くなら p */
  titleAs: 'h1' | 'p';
  /** 外側の余白（mt-8 など） */
  className?: string;
}

const titleClass = 'font-bold text-destructive';
const linkClass = 'mt-3 inline-block font-bold underline';
const buttonClass = 'mt-3 font-bold underline';

/**
 * 画面の中身を読めなかったことを、中身の場所に出す。問題セットの一覧と編集画面が使う。
 * 消えない role="alert" で残し、種類（describeApiError）ごとに、ログインし直す・戻る・もう一度読む の導線を1つ出す
 */
export function LoadErrorCard({ error, failed, retry, notFound, titleAs: Title, className }: LoadErrorCardProps) {
  const kind = describeApiError(error);

  return (
    <Card variant="destructive" role="alert" className={className}>
      {kind === 'unauthorized' ? (
        <>
          <Title className={titleClass}>ログインが切れました</Title>
          <Link to="/login" className={linkClass}>
            ログインし直す
          </Link>
        </>
      ) : kind === 'notFound' && notFound !== undefined ? (
        <>
          <Title className={titleClass}>{notFound.title}</Title>
          <p className="mt-2 text-note text-muted-foreground">{notFound.detail}</p>
          <Link to={notFound.back.to} className={linkClass}>
            {notFound.back.label}
          </Link>
        </>
      ) : (
        <>
          <Title className={titleClass}>{failed}</Title>
          <button type="button" onClick={retry} className={buttonClass}>
            もう一度読む
          </button>
        </>
      )}
    </Card>
  );
}
