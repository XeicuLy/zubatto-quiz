/**
 * 使い方のページ（/guide）の手順。画面の文と画像の組を、ここだけに書く。
 * DOM にも Vite にも頼らない値だけにしている。撮影のスクリプト（e2e/guide-screenshots/capture.ts）と、
 * 画像がそろっているかを確かめるテスト（test/guide-images.test.ts）が、node からこのファイルを読む
 */

/**
 * 画像を撮る画面の大きさ。<img> の width・height にもこの値を書き、読み込む前から縦横比ぶんの場所を取る。
 * 管理画面は PC、投影はプロジェクター（16:9）、回答者はスマホの縦向き（docs/design/README.md）
 */
export const GUIDE_VIEWPORTS = {
  pc: { width: 1280, height: 800 },
  projector: { width: 1920, height: 1080 },
  phone: { width: 390, height: 844 },
} as const;

export type GuideDevice = keyof typeof GUIDE_VIEWPORTS;

/** 画像の名前。images/<名前>.png に置く。撮影のスクリプトも、この名前でしか撮れない */
export type GuideImage =
  | 'host-login'
  | 'host-edit-set'
  | 'host-create-room'
  | 'host-lobby'
  | 'host-answering'
  | 'host-reveal'
  | 'host-final'
  | 'player-join'
  | 'player-waiting'
  | 'player-answering'
  | 'player-result';

export interface GuideStep {
  heading: string;
  description: string;
  image: GuideImage;
  /** 画像に何が写っているか。画像が見えない人は、これで手順を追う */
  alt: string;
  device: GuideDevice;
}

/** ホストの流れ（ログイン → 問題セットを作る → 部屋を作る → 進行） */
export const hostSteps: readonly GuideStep[] = [
  {
    heading: 'GitHub でログインする',
    description:
      'ホストとして登録された GitHub アカウントでログインします。登録されていないときは、開発者にアカウントを伝えてください。',
    image: 'host-login',
    alt: 'ログインの画面。「GitHub でログイン」のボタンがある',
    device: 'pc',
  },
  {
    heading: '問題セットを作る',
    description:
      '「問題セットを作る」を押し、問題文と2〜4個の選択肢を入れて、正解と制限時間を決めます。問題は「問題を足す」で増やし、最後に「保存する」を押します。',
    image: 'host-edit-set',
    alt: '問題セットの編集の画面。問題セットの名前、問題文、選択肢、正解、制限時間を入れる欄が並ぶ',
    device: 'pc',
  },
  {
    heading: '部屋を作る',
    description:
      '問題セットの一覧で、使う問題セットの「部屋を作る」を押します。部屋は作ったときの問題を写して使うので、あとで問題セットを直しても、その部屋には反映されません。',
    image: 'host-create-room',
    alt: '問題セットの一覧の画面。作った問題セットの行に「部屋を作る」のボタンがある',
    device: 'pc',
  },
  {
    heading: '参加者を待つ',
    description:
      '部屋の画面をプロジェクターに映します。回答者が QR コードか URL から入ると、名前が並びます。そろったら「第1問を出す」を押します。',
    image: 'host-lobby',
    alt: '投影する待機の画面。参加用の QR コードと URL、入った3人の名前が並ぶ',
    device: 'projector',
  },
  {
    heading: '問題を出し、受付を始める',
    description:
      '問題を出すと、まず問題文だけが映ります。読み上げてから「受付を始める」を押すと、選択肢と残り時間、答えた人数が出ます。',
    image: 'host-answering',
    alt: '投影する受付中の画面。問題文、4つの選択肢、残り時間、答えた人数が出る',
    device: 'projector',
  },
  {
    heading: '締め切って、正解を見せる',
    description:
      '時間切れか「いま締め切る」で締め切ると、正解と、選択肢ごとの人数が出ます。続けて「最速正解を発表する」で速く正解した3人を、「途中経過を出す」で上位の順位を見せられます。',
    image: 'host-reveal',
    alt: '投影する締切のあとの画面。正解の選択肢と、選択肢ごとの回答の人数が棒で出る',
    device: 'projector',
  },
  {
    heading: '最終ランキングを出す',
    description: '最後の問題のあと、「最終ランキングを出す」で優勝者と全員の順位を見せて終わります。',
    image: 'host-final',
    alt: '投影する最終ランキングの画面。優勝した人の名前が大きく出て、2位と3位が並ぶ',
    device: 'projector',
  },
];

/** 回答者の流れ（QR から参加 → 回答 → 結果）。ログインは要らない */
export const playerSteps: readonly GuideStep[] = [
  {
    heading: 'QR コードから参加する',
    description: 'ホストが映した QR コードをスマホで読み、名前を入れて「参加する」を押します。ログインは要りません。',
    image: 'player-join',
    alt: '参加の画面。名前を入れる欄と「参加する」のボタンがある',
    device: 'phone',
  },
  {
    heading: '始まるのを待つ',
    description: '自分の名前と、ほかの参加者が出ます。ホストが問題を出すまで待ちます。',
    image: 'player-waiting',
    alt: '待機の画面。自分の名前と「ホストが始めるのを待っています」の文、参加者の一覧が出る',
    device: 'phone',
  },
  {
    heading: '選択肢を押して答える',
    description:
      '受付が始まると、選択肢のボタンが出ます。正解なら、早く押すほど点が高くなります。押したあとは選び直せません。',
    image: 'player-answering',
    alt: '回答の画面。番号と色の付いた4つの選択肢のボタンが並ぶ',
    device: 'phone',
  },
  {
    heading: '結果を見る',
    description:
      '締め切ると、正解したかと入った点、いまの順位が出ます。最後の2問は、順位を最終ランキングまで伏せます。',
    image: 'player-result',
    alt: '結果の画面。「○ 正解」と入った点、自分の順位が出る',
    device: 'phone',
  },
];
