import { render } from 'preact';
import { App } from './app.tsx';
import './styles.css';

render(<App />, document.getElementById('app')!);

// The service worker lives at the deploy base so its scope covers the whole app,
// including under a GitHub Pages project path.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A worker that reaches "installed" while one is already controlling
          // the page is a new version waiting behind the current one.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(() => {
              installing.postMessage({ type: 'SKIP_WAITING' });
            });
          }
        });
      });
    }).catch(() => {
      // An unregistrable SW costs offline support, not the app. Fail quietly.
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
}

function showUpdateToast(onAccept: () => void) {
  const toast = document.createElement('button');
  toast.className = 'update-toast';
  toast.type = 'button';
  toast.textContent = 'New version available — tap to reload';
  toast.addEventListener('click', onAccept);
  document.body.appendChild(toast);
}
