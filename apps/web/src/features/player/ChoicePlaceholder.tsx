/**
 * 受付の前に、選択肢のボタンが出る場所。選択肢は受付開始まで届かないので（P2）、数は分からず、いつも4つの点線の枠を出す。
 * 枠は画面の高さを分け合い、受付が始まったときにボタンが同じ場所に出る。枠は飾りなので読み上げず、下の説明文だけを読む
 */
export function ChoicePlaceholder() {
  return (
    <>
      <div className="mt-8 flex flex-1 flex-col gap-3" aria-hidden="true">
        {[0, 1, 2, 3].map((slot) => (
          <div key={slot} className="flex-1 rounded-panel border-2 border-dashed border-border" />
        ))}
      </div>
      <p className="mt-4 text-center font-bold text-muted-foreground">選択肢は、ホストが受付を始めると出ます</p>
    </>
  );
}
