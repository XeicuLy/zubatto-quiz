import { fireEvent, render, screen, within } from '@testing-library/react';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';

import { editorReducer, type DraftErrors, type QuestionDraft } from './question-set-draft';
import { QuestionEditor } from './QuestionEditor';

interface HarnessProps {
  question: QuestionDraft;
  index?: number;
  count?: number;
  errors?: DraftErrors;
}

/** 1問だけの下書きを reducer で持ち、入力が下書きに入って画面に戻ることまで確かめる */
function Harness({ question, index = 0, count = 1, errors = {} }: HarnessProps) {
  const [draft, dispatch] = useReducer(editorReducer, { title: 'クイズ', questions: [question] });
  return (
    <ol>
      <QuestionEditor question={draft.questions[0]!} index={index} count={count} errors={errors} dispatch={dispatch} />
    </ol>
  );
}

function question(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return { key: 'q', text: '', choices: ['', ''], correctIndex: null, limitSeconds: '10', ...overrides };
}

describe('1問の編集（F4・F9）', () => {
  it('問題文・選択肢・正解・制限時間を入力できる', () => {
    render(<Harness question={question()} />);

    fireEvent.change(screen.getByLabelText('問題文'), { target: { value: '部長の十八番は？' } });
    fireEvent.change(screen.getByLabelText('選択肢1'), { target: { value: '演歌' } });
    fireEvent.change(screen.getByLabelText('選択肢2'), { target: { value: 'アニソン' } });
    fireEvent.click(screen.getByRole('radio', { name: '選択肢2を正解にする' }));
    fireEvent.change(screen.getByLabelText('制限時間'), { target: { value: '30' } });

    expect(screen.getByLabelText('問題文')).toHaveValue('部長の十八番は？');
    expect(screen.getByLabelText('選択肢1')).toHaveValue('演歌');
    expect(screen.getByLabelText('選択肢2')).toHaveValue('アニソン');
    expect(screen.getByRole('radio', { name: '選択肢2を正解にする' })).toBeChecked();
    expect(screen.getByLabelText('制限時間')).toHaveValue(30);
  });

  it('制限時間は、初めは10秒（F9）', () => {
    render(<Harness question={question()} />);

    expect(screen.getByLabelText('制限時間')).toHaveValue(10);
  });

  it('選択肢は4つまで足せ、4つになると足すボタンが消える', () => {
    render(<Harness question={question()} />);

    fireEvent.click(screen.getByRole('button', { name: '選択肢を足す' }));
    fireEvent.click(screen.getByRole('button', { name: '選択肢を足す' }));

    expect(screen.getByLabelText('選択肢4')).toHaveValue('');
    expect(screen.queryByRole('button', { name: '選択肢を足す' })).not.toBeInTheDocument();
    expect(screen.getByText('選択肢は4つまでです')).toBeInTheDocument();
  });

  it('選択肢が2つのときは、消すボタンを押せない', () => {
    render(<Harness question={question({ choices: ['A', 'B'] })} />);

    expect(screen.getByRole('button', { name: '選択肢1を消す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '選択肢2を消す' })).toBeDisabled();
  });

  it('正解より前の選択肢を消しても、同じ選択肢が正解のまま残る', () => {
    render(<Harness question={question({ choices: ['A', 'B', 'C'], correctIndex: 2 })} />);

    fireEvent.click(screen.getByRole('button', { name: '選択肢1を消す' }));

    expect(screen.getByLabelText('選択肢2')).toHaveValue('C');
    expect(screen.getByRole('radio', { name: '選択肢2を正解にする' })).toBeChecked();
  });

  it('正解の選択肢を消すと、正解はどれも選ばれていない状態に戻る', () => {
    render(<Harness question={question({ choices: ['A', 'B', 'C'], correctIndex: 1 })} />);

    fireEvent.click(screen.getByRole('button', { name: '選択肢2を消す' }));

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
  });

  it('誤りを、その入力欄のそばに出す', () => {
    render(
      <Harness
        question={question()}
        index={1}
        count={2}
        errors={{
          'questions.1.text': '問題文を入れてください',
          'questions.1.choices.0': '選択肢を入れてください',
          'questions.1.correctIndex': '正解を1つ選んでください',
          'questions.1.limitMs': '制限時間は5〜60秒の整数で入れてください',
        }}
      />,
    );

    expect(screen.getByLabelText('問題文')).toHaveAccessibleDescription('問題文を入れてください');
    expect(screen.getByLabelText('選択肢1')).toHaveAccessibleDescription('選択肢を入れてください');
    expect(screen.getByLabelText('選択肢2')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('group', { name: /選択肢と正解/ })).toHaveAccessibleDescription('正解を1つ選んでください');
    expect(screen.getByLabelText('制限時間')).toHaveAccessibleDescription('制限時間は5〜60秒の整数で入れてください');
  });

  it('ほかの問題の誤りは出さない', () => {
    render(
      <Harness question={question()} index={0} count={2} errors={{ 'questions.1.text': '問題文を入れてください' }} />,
    );

    expect(screen.queryByText('問題文を入れてください')).not.toBeInTheDocument();
    expect(screen.getByLabelText('問題文')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    { index: 0, count: 3, up: false, down: true, remove: true },
    { index: 1, count: 3, up: true, down: true, remove: true },
    { index: 2, count: 3, up: true, down: false, remove: true },
    // 問題セットは1問以上ないと保存できないので、最後の1問は消せない
    { index: 0, count: 1, up: false, down: false, remove: false },
  ])('$count 問のうち $index 番目: 上へ $up・下へ $down・消す $remove', ({ index, count, up, down, remove }) => {
    render(<Harness question={question()} index={index} count={count} />);
    const card = screen.getByRole('listitem', { name: `第${index + 1}問` });

    expect(within(card).getByRole('button', { name: `第${index + 1}問を上へ` })).toHaveProperty('disabled', !up);
    expect(within(card).getByRole('button', { name: `第${index + 1}問を下へ` })).toHaveProperty('disabled', !down);
    expect(within(card).getByRole('button', { name: 'この問題を消す' })).toHaveProperty('disabled', !remove);
  });
});
