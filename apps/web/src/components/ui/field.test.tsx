import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, Input } from './field';

describe('Field', () => {
  it('ラベルの文字で入力欄が見つかる', () => {
    render(
      <Field label="名前">
        <Input name="name" />
      </Field>,
    );

    expect(screen.getByLabelText('名前')).toBe(screen.getByRole('textbox'));
  });

  it('ヒントがあれば、入力欄の説明としてヒントを読み、誤りとはしない', () => {
    render(
      <Field label="名前" hint="ランキングに出る名前です。">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText('名前');
    expect(input).toHaveAccessibleDescription('ランキングに出る名前です。');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('誤りがあれば aria-invalid にし、ヒントのかわりに誤りを知らせて説明として読む', () => {
    render(
      <Field label="名前" hint="ランキングに出る名前です。" error="名前を入れてください。">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText('名前');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('名前を入れてください。');
    expect(input).toHaveAccessibleDescription('名前を入れてください。');
    expect(screen.queryByText('ランキングに出る名前です。')).toBeNull();
  });

  it('ヒントも誤りもなければ、説明を指さない', () => {
    render(
      <Field label="問題セットの名前" error={null}>
        <Input />
      </Field>,
    );

    expect(screen.getByLabelText('問題セットの名前')).not.toHaveAttribute('aria-describedby');
  });

  it('同じ画面に2つ置いても、id がかぶらない', () => {
    render(
      <>
        <Field label="問題文" error="問題文を入れてください。">
          <Input />
        </Field>
        <Field label="制限時間" error="1〜60秒にしてください。">
          <Input />
        </Field>
      </>,
    );

    expect(screen.getByLabelText('問題文')).toHaveAccessibleDescription('問題文を入れてください。');
    expect(screen.getByLabelText('制限時間')).toHaveAccessibleDescription('1〜60秒にしてください。');
  });

  // 画面が id を渡しても、ラベルとのつなぎは Field が決める
  it('画面から id を渡しても、ラベルとのつなぎは崩れない', () => {
    render(
      <Field label="名前">
        <Input id="join-name" />
      </Field>,
    );

    expect(screen.getByLabelText('名前')).toBe(screen.getByRole('textbox'));
  });
});

describe('Input', () => {
  it('Field の外では、渡した aria-label で読まれ、つなぎの属性を持たない', () => {
    render(<Input aria-label="選択肢1" />);

    const input = screen.getByRole('textbox', { name: '選択肢1' });
    expect(input).not.toHaveAttribute('id');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  // 色は役割の名前だけで選ぶ。枠は文字でない部品として、どちらの面でも隣の色に 3:1 以上にする（ADR 0007）
  it('役割の色で出て、誤りのときは枠を destructive にする', () => {
    render(<Input aria-label="名前" />);

    expect(screen.getByRole('textbox')).toHaveClass(
      'border-muted-foreground',
      'bg-card',
      'text-card-foreground',
      'aria-invalid:border-destructive',
    );
  });

  it('className は足され、同じ性質の class はあとから渡したほうが勝つ', () => {
    render(<Input aria-label="制限時間" className="w-20 text-right" />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveClass('w-20', 'text-right');
    expect(input).not.toHaveClass('w-full');
  });

  // フォーカスリングは styles.css の :focus-visible が全体に出す（#125）。部品が上書きすると、面ごとの二重の枠が崩れる
  it('フォーカスの見た目を自分で決めない', () => {
    render(<Input aria-label="名前" />);

    expect(screen.getByRole('textbox').className).not.toMatch(/focus-visible:|focus:|outline-none|ring-/);
  });
});
