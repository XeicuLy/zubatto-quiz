import { createContext, use, useId, type ComponentProps, type ReactNode } from 'react';

import { cn } from '@/lib/tailwind';

/** Field が入力欄に渡す、ラベル・ヒント・誤りとのつなぎ */
interface FieldControl {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

const FieldControlContext = createContext<FieldControl | null>(null);

interface FieldProps {
  /** 入力欄の名前。ラベルとして出し、読み上げでも入力欄の名前になる */
  label: ReactNode;
  /** 何を入れるかの補足。誤りがあるあいだは、誤りに置き換える */
  hint?: string;
  /** 入れたものの誤り。null か undefined なら誤りなし。文字として描く（ADR 0004: 入れた名前が含まれることがある） */
  error?: string | null;
  className?: string;
  /** 入力欄（Input か Textarea）。Field の中に置くと、id と aria-* が自動でつながる */
  children: ReactNode;
}

/**
 * ラベル・入力欄・ヒント・誤りをまとめる（ADR 0007）。id は useId で作り、画面は id も aria-* も書かない。
 * shadcn/ui の field のひな形は、組み合わせる部品を並べるだけで id をつながないので、写さずに作った。
 * Base UI の Field も使わない。誤りを出すには match を渡す必要があり、検証と出し入れの状態も持つが、
 * このアプリは protocol のスキーマで確かめて、誤りの文字を渡すだけなので
 * - 誤りがあれば aria-invalid にし、ヒントのかわりに誤りを role="alert" で出して aria-describedby で指す
 * - 誤りがなければ、ヒントを aria-describedby で指す
 */
function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = error !== null && error !== undefined;
  const describedBy = invalid ? errorId : hint === undefined ? undefined : hintId;

  return (
    <div data-slot="field" className={cn('flex flex-col gap-related', className)}>
      <label htmlFor={id} className="text-label font-bold">
        {label}
      </label>
      <FieldControlContext value={{ id, 'aria-invalid': invalid, 'aria-describedby': describedBy }}>
        {children}
      </FieldControlContext>
      {invalid ? (
        <p id={errorId} role="alert" className="font-bold text-destructive">
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p id={hintId} className="text-note text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/**
 * 1行の入力欄（shadcn/ui の Input、CLI 4.22.1 の base-nova をもとにした。ADR 0007）。Field の中に置くと、つなぎを受け取る。
 * Field の外（ラベルを見せず aria-label で名付ける欄）では、ふつうの input として動く。
 * ひな形から、次のものを外した。
 * - フォーカスの class（outline-none・focus-visible:ring-3）: styles.css の :focus-visible が、面ごとの二重の枠を全体に出す（#125）
 * - transition-colors: 動きは最速正解者と優勝の発表の1か所だけにする（docs/design/README.md）
 * - file:・disabled:・dark: の class: 使っていない
 * - Base UI の Input: Field.Control を包んだもので、Field.Root の外では検証の仕組みを持ち込むだけなので、input を描く
 * 枠は border-input ではなく muted-foreground にし、どちらの面でも背景に 3:1 以上にする（文字でない部品、WCAG 1.4.11）。
 * placeholder の文字も muted-foreground にする。入れる値の例を読ませる文字なので、欄の背景（card）に 4.5:1 以上にする（test/contrast.test.ts）
 */
function Input({ className, ...props }: ComponentProps<'input'>) {
  const control = use(FieldControlContext);
  return (
    <input
      data-slot="input"
      className={cn(
        'w-full min-w-0 rounded-chip border-2 border-muted-foreground bg-card px-4 py-3 text-body text-card-foreground placeholder:text-muted-foreground aria-invalid:border-destructive',
        className,
      )}
      {...props}
      // つなぎは props のあとに置き、画面から id を渡してもラベルとのつなぎが崩れないようにする
      {...control}
    />
  );
}

/**
 * 複数行の入力欄（shadcn/ui の Textarea、CLI 4.22.1 の base-nova をもとにした。ADR 0007）。Input と同じく、Field の中に置くと、つなぎを受け取る。
 * 枠と色は Input とそろえ、ひな形から外したものも Input と同じ。class は定数にまとめず書き下す。oxfmt が並べ替えるのは
 * className と cn・cva の引数の文字だけで、定数の文字は並べ替えないため。
 * field-sizing-content は残し、打った行の分だけ高くする（効かないブラウザでは rows の高さになる）
 */
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  const control = use(FieldControlContext);
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content min-h-16 w-full rounded-chip border-2 border-muted-foreground bg-card px-4 py-3 text-body text-card-foreground placeholder:text-muted-foreground aria-invalid:border-destructive',
        className,
      )}
      {...props}
      {...control}
    />
  );
}

export { Field, Input, Textarea };
