import './styles.css';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createSoundPlayer, unlockOnGestures } from './features/sound/sound-player';
import { createAppRouter } from './router';

// ブラウザは操作の前に音を出させないので、画面のどこかを押すたびに鳴らせるようにする（F18）
const sound = createSoundPlayer();
unlockOnGestures(document, sound);

const router = createAppRouter({ sound });

const container = document.getElementById('app');
if (container === null) {
  throw new Error('index.html に #app がない');
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
