import { Link } from '@tanstack/react-router';

/**
 * 部屋に入れない・部屋が終わった画面から、入口（/）へ出るリンク。回答者は QR から部屋に直接来るので、行き止まりにしない。
 * 形はホストの「問題セットの一覧に戻る」と同じ、下線の文字リンクにする
 */
export function TopLink() {
  return (
    <Link
      to="/"
      className="self-start text-body font-bold underline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      ズバクイのトップへ
    </Link>
  );
}
