import { createCn } from 'cn/config';

/**
 * 部品の class をつなぐ（shadcn/ui の cn）。同じ性質の class が重なると、あとに書いたほうだけを残す。
 * styles.css の @theme で足した名前は、教えないと別の性質と取り違える（text-stage-label を文字の色とみなし、
 * text-on-stage と重ねると文字の大きさが消える）。@theme に名前を足したら、ここにも足す（test/cn-theme.test.ts が確かめる）。
 * 色と字体の名前は、教えなくても正しく扱われる
 */
export const cn = createCn({
  extend: {
    theme: {
      text: [
        'title',
        'heading',
        'body',
        'note',
        'label',
        'stage-label',
        'stage-title',
        'question',
        'choice',
        'timer',
        'hero',
      ],
      spacing: ['related', 'item', 'cluster', 'section', 'stage'],
      radius: ['panel', 'chip'],
      shadow: ['panel'],
      animate: ['spotlight-in'],
    },
  },
});
