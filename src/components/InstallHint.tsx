import { useEffect, useState } from 'preact/hooks';

/**
 * Install affordances, which differ fundamentally by platform.
 *
 * iOS has NO install prompt API. Installing is Share → Add to Home Screen, in
 * Safari specifically, and nothing the page does can trigger it — so all we can
 * do is explain the two steps. Android and desktop fire beforeinstallprompt,
 * which we capture and defer behind a discreet header button.
 *
 * The hint appears early on purpose: on iOS an installed PWA gets a storage
 * partition separate from Safari's, so a watchlist built in the browser does not
 * follow the user into the installed app. Better to prompt before anyone has
 * invested in a list than to lose it afterwards.
 */

const DISMISS_KEY = 'value.installHintDismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  // Safari's own non-standard flag; matchMedia alone misses installed iOS apps.
  (navigator as { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports as a Mac; the touch points give it away.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function dismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Suppress the default mini-infobar; we surface our own button instead.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', () => setDeferred(null));
    return () => removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return {
    canInstall: deferred !== null,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    },
  };
}

export function IosInstallSheet() {
  const [hidden, setHidden] = useState(() => dismissed() || isStandalone() || !isIos());

  if (hidden) return null;

  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* not worth failing over */ }
    setHidden(true);
  };

  return (
    <aside class="install-sheet" role="complementary" aria-label="Install Value">
      <div class="install-copy">
        <strong>Add Value to your home screen</strong>
        <ol class="install-steps">
          <li>Tap <span class="ios-share" aria-label="the Share button">􀈂</span> Share in Safari</li>
          <li>Choose <b>Add to Home Screen</b></li>
        </ol>
        <p class="install-note">
          Favourites are stored on this device, and the installed app keeps its own
          store — copy your watchlist link first if you have already starred anything.
        </p>
      </div>
      <button class="install-dismiss" type="button" onClick={close} aria-label="Dismiss">✕</button>
    </aside>
  );
}
