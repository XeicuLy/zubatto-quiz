import type { Preview } from '@storybook/react-vite';

import './preview.css';

/**
 * ストーリーの共通の設定。test/stories.test.tsx の煙テストも、これを setProjectAnnotations で読む。
 * 色は役割の名前で選び、面（明るい・暗い）で値が入れ替わる（docs/design/README.md の面）。
 * 部品は面を variant に持たないので、面はストーリーの外側の箱で決める
 */
const preview: Preview = {
  // すべてのストーリーに autodocs（props の表と、ストーリーの一覧のページ）を付ける
  tags: ['autodocs'],
  globalTypes: {
    surface: {
      description: '部品を置く面',
      toolbar: {
        title: '面',
        items: [
          { value: 'admin', title: '明るい面（管理画面）' },
          { value: 'stage', title: '暗い面（進行画面・回答者画面）' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { surface: 'admin' },
  decorators: [
    (Story, { globals, viewMode }) =>
      // 暗い面は、画面と同じく .stage の箱で包み、背景と文字の色を付ける。明るい面は :root の値のまま。
      // ストーリーの画面では、箱を画面の高さまで伸ばす。docs のページでは、ストーリーごとの枠が縦に伸びないよう伸ばさない
      globals.surface === 'stage' ? (
        <div
          className={
            viewMode === 'story'
              ? 'stage min-h-dvh bg-background p-6 text-foreground'
              : 'stage bg-background p-6 text-foreground'
          }
        >
          <Story />
        </div>
      ) : (
        <div className="p-6">
          <Story />
        </div>
      ),
  ],
  parameters: {
    // 余白はデコレータの箱が持つ
    layout: 'fullscreen',
    // 画面の大きさ。variant のある部品は、ストーリーの globals で variant に合う方を選ぶ（globals: { viewport: { value: 'mobile' } }）。
    // docs のページはストーリーをページの中に描くので、大きさは当たらない
    viewport: {
      options: {
        mobile: {
          name: '回答者画面（スマホの縦向き 390×844）',
          styles: { width: '390px', height: '844px' },
          type: 'mobile',
        },
        projector: {
          name: '進行画面（投影 1920×1080）',
          styles: { width: '1920px', height: '1080px' },
          type: 'desktop',
        },
      },
    },
  },
};

export default preview;
