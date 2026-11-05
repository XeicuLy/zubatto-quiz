import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

const childRendered = vi.fn<() => void>();

function Child() {
  childRendered();
  return <p>子</p>;
}

// label の既定値が要点。Babel 8 の構文木では、Compiler はこの形の部品をエラーなしで飛ばす（2026-11-05 に確かめた）
function Parent({ label = '増やす' }: { label?: string }) {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        {label}: {count}
      </button>
      <Child />
    </div>
  );
}

// vitest.config.ts は vite.config.ts を読まないので、テストでも本番と同じ変換が動いていることをここで確かめる。
// Compiler がなければ、親の state が変わるたびに <Child /> の要素が作り直され、子も描き直される
it('React Compiler が効いていて、親の state が変わっても props の変わらない子は描き直されない', () => {
  childRendered.mockClear();
  render(<Parent />);

  fireEvent.click(screen.getByRole('button', { name: '増やす: 0' }));

  expect(screen.getByRole('button', { name: '増やす: 1' })).toBeInTheDocument();
  expect(childRendered).toHaveBeenCalledTimes(1);
});
