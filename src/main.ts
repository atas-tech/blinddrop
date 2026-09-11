import { API_BASE_URL } from './config.js';
import {
  ENVELOPE_VERSION,
  assertPlaintextSize,
  decryptSecret,
  encryptSecret
} from './crypto.js';

declare global {
  interface Window {
    turnstile: any;
    onloadTurnstileCallback?: () => void;
  }
}

const API_URL = API_BASE_URL.replace(/\/$/, '');

interface RevealMeta {
  status: 'active';
  requires_passphrase: boolean;
}

interface RevealEnvelope {
  version: number;
  ciphertext: string;
  salt?: string;
}

async function readApiError(response: Response, fallback: string): Promise<Error> {
  const data = await response.json().catch(() => ({})) as { error?: unknown };
  return new Error(typeof data.error === 'string' ? data.error : fallback);
}

function secretUrl(id: string, suffix: string): string {
  return `${API_URL}/api/secrets/${encodeURIComponent(id)}${suffix}`;
}

function setInlineError(container: HTMLElement, message: string): void {
  container.querySelector('#reveal-error')?.remove();
  const error = document.createElement('div');
  error.id = 'reveal-error';
  error.className = 'mt-6 p-4 bg-error/10 rounded-lg border border-error/20 text-center';
  const paragraph = document.createElement('p');
  paragraph.className = 'text-error-dim font-medium';
  paragraph.textContent = message;
  error.appendChild(paragraph);
  container.appendChild(error);
}

function clearInlineError(container: HTMLElement): void {
  container.querySelector('#reveal-error')?.remove();
}

function renderNotice(container: HTMLElement, message: string): void {
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center p-8 bg-error/10 rounded-lg border border-error/20 text-center">
      <span class="material-symbols-outlined text-5xl text-error mb-4" style="font-variation-settings: 'FILL' 1;">error</span>
      <h3 class="text-error font-bold text-xl mb-2">Notice</h3>
      <p id="notice-message" class="text-error-dim font-medium max-w-sm"></p>
    </div>
  `;
  const messageElement = container.querySelector('#notice-message');
  if (messageElement) messageElement.textContent = message;
}

function renderShareLink(container: HTMLElement, shareUrl: string): void {
  container.innerHTML = `
    <label class="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3 ml-1">Your Shareable Link</label>
    <div class="relative w-full">
      <textarea readonly id="share-link" spellcheck="false" autocomplete="off" class="w-full min-h-[120px] bg-surface-container-lowest border border-primary/20 rounded-lg p-6 text-primary focus:ring-4 focus:ring-primary/10 transition-all shadow-sm text-lg leading-relaxed break-all resize-none"></textarea>
      <button id="copy-btn" class="absolute bottom-4 right-4 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors">
        <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">content_copy</span> Copy
      </button>
    </div>
  `;

  const shareLink = container.querySelector('#share-link') as HTMLTextAreaElement | null;
  if (shareLink) shareLink.value = shareUrl;

  container.querySelector('#copy-btn')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(shareUrl);
    const copyButton = container.querySelector('#copy-btn');
    if (copyButton) copyButton.innerHTML = `<span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">check</span> Copied`;
  });
}

function renderDecryptedSecret(container: HTMLElement, plaintext: string): void {
  container.innerHTML = `
    <label id="decrypted-label" class="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3 ml-1">Decrypted Secret (server deletion confirmed)</label>
    <div class="relative w-full">
      <textarea readonly id="decrypted-secret" spellcheck="false" autocomplete="off" class="w-full min-h-[160px] bg-surface-container-lowest border border-success/20 rounded-lg p-6 text-on-surface focus:ring-4 focus:ring-primary/10 transition-all shadow-sm text-lg leading-relaxed resize-none"></textarea>
      <button id="copy-secret-btn" class="absolute bottom-4 right-4 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors">
        <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">content_copy</span> Copy
      </button>
    </div>
  `;

  const decryptedSecret = container.querySelector('#decrypted-secret') as HTMLTextAreaElement | null;
  if (decryptedSecret) decryptedSecret.value = plaintext;

  container.querySelector('#copy-secret-btn')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(plaintext);
    const copyButton = container.querySelector('#copy-secret-btn');
    if (copyButton) copyButton.innerHTML = `<span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">check</span> Copied`;
  });
}

function initCreateScreen(): void {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  let currentTurnstileToken = '';
  let turnstileWidgetId: string | null = null;

  if (isLocal && import.meta.env.VITE_ALLOW_TURNSTILE_BYPASS === '1') {
    currentTurnstileToken = 'bypass';
    const turnstileContainer = document.getElementById('turnstile-container');
    if (turnstileContainer) turnstileContainer.style.display = 'none';
  } else {
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (siteKey) {
      window.onloadTurnstileCallback = () => {
        if (!document.getElementById('turnstile-container') || !window.turnstile) return;
        turnstileWidgetId = window.turnstile.render('#turnstile-container', {
          sitekey: siteKey,
          action: import.meta.env.VITE_TURNSTILE_ACTION || undefined,
          callback: (token: string) => {
            currentTurnstileToken = token;
          }
        });
      };
      const turnstileScript = document.createElement('script');
      turnstileScript.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback';
      turnstileScript.async = true;
      turnstileScript.defer = true;
      document.head.appendChild(turnstileScript);
    }
  }

  let selectedTtl = 3600;
  const ttlButtons = document.querySelectorAll('#ttl-buttons button');
  const activeClasses = 'px-5 py-2.5 rounded-full text-sm font-semibold bg-primary text-on-primary shadow-lg shadow-primary/20 transition-all';
  const inactiveClasses = 'px-5 py-2.5 rounded-full text-sm font-semibold bg-white/60 text-on-surface-variant border border-outline-variant/20 hover:bg-white transition-all';

  ttlButtons.forEach(button => {
    const isSelected = Number((button as HTMLElement).dataset.ttl) === selectedTtl;
    button.className = isSelected ? activeClasses : inactiveClasses;
    button.addEventListener('click', event => {
      const target = event.currentTarget as HTMLElement;
      selectedTtl = Number(target.dataset.ttl);
      ttlButtons.forEach(item => { item.className = inactiveClasses; });
      target.className = activeClasses;
    });
  });

  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement | null;
  actionBtn?.addEventListener('click', async () => {
    const secretInput = document.getElementById('secret-input') as HTMLTextAreaElement | null;
    const text = secretInput?.value ?? '';
    if (!text || /^\s*$/.test(text)) {
      alert('Please enter a secret.');
      return;
    }

    try {
      assertPlaintextSize(text);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Secret is too large.');
      return;
    }

    if (!currentTurnstileToken) {
      alert(siteKeyMissingMessage());
      return;
    }

    const actionText = document.getElementById('action-text');
    if (actionText) actionText.textContent = 'Encrypting...';
    actionBtn.disabled = true;
    actionBtn.classList.add('opacity-50', 'pointer-events-none');

    try {
      const passphraseInput = document.getElementById('passphrase-input') as HTMLInputElement | null;
      const passphrase = passphraseInput?.value ?? '';
      const encrypted = await encryptSecret(text, passphrase || undefined);

      const response = await fetch(`${API_URL}/api/secrets`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: ENVELOPE_VERSION,
          ciphertext: encrypted.ciphertext,
          ttl: selectedTtl,
          turnstileToken: currentTurnstileToken,
          passphrase_salt: encrypted.passphraseSalt
        })
      });
      if (!response.ok) throw await readApiError(response, 'Failed to create secret on server.');

      const data = await response.json() as { id?: unknown };
      if (typeof data.id !== 'string') throw new Error('The server returned an invalid share link.');

      const url = new URL(window.location.href);
      const params = new URLSearchParams({ id: data.id });
      params.set('key', encrypted.fragmentKey);
      url.hash = params.toString();

      const inputContainer = document.getElementById('input-container');
      const ttlContainer = document.getElementById('ttl-container');
      const turnstileContainer = document.getElementById('turnstile-container');
      if (ttlContainer) ttlContainer.style.display = 'none';
      if (turnstileContainer) turnstileContainer.style.display = 'none';
      if (inputContainer) renderShareLink(inputContainer, url.toString());

      if (actionText) actionText.textContent = 'Create Another Secret';
      const icon = actionBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'add';
      actionBtn.disabled = false;
      actionBtn.classList.remove('opacity-50', 'pointer-events-none');
      actionBtn.replaceWith(actionBtn.cloneNode(true));
      document.getElementById('action-btn')?.addEventListener('click', () => {
        window.location.href = window.location.pathname;
      });
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Unable to create secret.'}`);
      if (actionText) actionText.textContent = 'Create Secret link';
      actionBtn.disabled = false;
      actionBtn.classList.remove('opacity-50', 'pointer-events-none');
    }
  });

  function siteKeyMissingMessage(): string {
    return isLocal
      ? 'Please configure Turnstile or explicitly enable the local test bypass.'
      : 'Please complete the captcha.';
  }

  void turnstileWidgetId;
}

async function initRevealScreen(hashParams: URLSearchParams): Promise<void> {
  const id = hashParams.get('id');
  const key = hashParams.get('key');
  if (!id) return;

  const inputContainer = document.getElementById('input-container');
  const ttlContainer = document.getElementById('ttl-container');
  const turnstileContainer = document.getElementById('turnstile-container');
  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement | null;
  const actionText = document.getElementById('action-text');
  if (!inputContainer || !actionBtn) return;

  if (ttlContainer) ttlContainer.style.display = 'none';
  if (turnstileContainer) turnstileContainer.style.display = 'none';
  document.title = 'Reveal Secret — BlindDrop';

  const title = document.querySelector('h1');
  if (title) title.textContent = 'Unlock Secret';
  const subtitle = document.querySelector('p');
  if (subtitle) subtitle.textContent = 'This secret will be permanently destroyed once delivered. Refreshing requires reopening the original link.';

  let meta: RevealMeta;
  try {
    const response = await fetch(secretUrl(id, '/meta'), { cache: 'no-store' });
    if (!response.ok) throw await readApiError(response, 'Failed to fetch metadata.');
    meta = await response.json() as RevealMeta;
  } catch (error) {
    renderNotice(inputContainer, error instanceof Error ? error.message : 'Failed to fetch metadata.');
    actionBtn.style.display = 'none';
    return;
  }

  inputContainer.innerHTML = `
    <div class="flex flex-col items-center justify-center p-8 bg-surface-container-lowest rounded-lg border border-primary/10 shadow-sm text-center">
      <span class="material-symbols-outlined text-5xl text-primary mb-4" style="font-variation-settings: 'FILL' 1;">lock</span>
      <p class="text-on-surface font-semibold text-lg max-w-sm">You have received an encrypted secret. Ready to unlock?</p>
    </div>
  `;
  if (meta.requires_passphrase) {
    const passphraseWrapper = document.createElement('div');
    passphraseWrapper.className = 'mt-8 w-full';
    passphraseWrapper.innerHTML = `
      <label class="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2 ml-1 text-left">Passphrase Required</label>
      <input type="password" id="reveal-passphrase" spellcheck="false" autocomplete="off" class="w-full bg-surface-container-lowest border-none rounded-sm px-6 py-4 text-on-surface placeholder:text-outline-variant focus:ring-2 focus:ring-primary/20 transition-all shadow-inner font-medium" placeholder="Enter passphrase to unlock" />
    `;
    inputContainer.appendChild(passphraseWrapper);
  }

  if (actionText) actionText.textContent = 'Reveal & Destroy Secret';
  const icon = actionBtn.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = 'lock_open';

  let envelope: RevealEnvelope | null = null;
  let deletionConfirmed = false;
  let finished = false;

  actionBtn.addEventListener('click', async () => {
    if (finished) return;

    const passphraseInput = document.getElementById('reveal-passphrase') as HTMLInputElement | null;
    const passphrase = passphraseInput?.value ?? '';
    if (meta.requires_passphrase && !passphrase) {
      setInlineError(inputContainer, 'A passphrase is required.');
      return;
    }
    if (!key) {
      renderNotice(inputContainer, 'This link is missing its decryption key.');
      actionBtn.style.display = 'none';
      return;
    }

    clearInlineError(inputContainer);
    if (actionText) actionText.textContent = 'Decrypting...';
    actionBtn.disabled = true;
    actionBtn.classList.add('opacity-50', 'pointer-events-none');

    try {
      if (!envelope) {
        let response: Response;
        try {
          response = await fetch(secretUrl(id, '/reveal'), {
            method: 'POST',
            cache: 'no-store'
          });
        } catch {
          throw new Error('Unable to reveal the secret. The server state is unknown; do not refresh or retry automatically.');
        }
        if (!response.ok) throw await readApiError(response, `Unable to reveal secret (HTTP ${response.status}).`);

        const data = await response.json() as Partial<RevealEnvelope>;
        if (data.version !== ENVELOPE_VERSION || typeof data.ciphertext !== 'string') {
          throw new Error('The server returned an invalid encrypted payload.');
        }
        envelope = {
          version: data.version,
          ciphertext: data.ciphertext,
          salt: typeof data.salt === 'string' ? data.salt : undefined
        };
        deletionConfirmed = true;
      }

      if (!key || !envelope) throw new Error('This link is missing decryption material.');

      const plaintext = await decryptSecret(
        envelope.ciphertext,
        key,
        meta.requires_passphrase ? passphrase : undefined,
        envelope.salt
      );
      if (plaintext === null) {
        if (deletionConfirmed && meta.requires_passphrase) {
          setInlineError(inputContainer, 'Incorrect passphrase or corrupt payload. The server deleted the secret; try again in this tab without refreshing.');
          if (actionText) actionText.textContent = 'Try Again';
          actionBtn.disabled = false;
          actionBtn.classList.remove('opacity-50', 'pointer-events-none');
          return;
        }
        throw new Error('The encrypted secret was delivered and deleted, but this link could not decrypt it.');
      }

      renderDecryptedSecret(inputContainer, plaintext);
      finished = true;
      if (actionText) actionText.textContent = 'Create Your Own Secret';
      if (icon) icon.textContent = 'add';
      actionBtn.disabled = false;
      actionBtn.classList.remove('opacity-50', 'pointer-events-none');
      actionBtn.replaceWith(actionBtn.cloneNode(true));
      document.getElementById('action-btn')?.addEventListener('click', () => {
        window.location.href = window.location.pathname;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reveal secret.';
      renderNotice(inputContainer, message);
      // A failed reveal request may have reached the server. Do not retry or
      // claim deletion when the response status is unknown.
      actionBtn.style.display = 'none';
    }
  });
}

const hashParams = new URLSearchParams(window.location.hash.slice(1));
if (hashParams.has('id')) {
  // The fragment is no longer needed after parsing. This keeps the key out of
  // the visible address bar and means refresh cannot accidentally repeat a
  // reveal; the original link must be reopened to try again.
  history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  void initRevealScreen(hashParams);
} else {
  initCreateScreen();
}

document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const mobileDropdown = document.getElementById('mobile-dropdown');
  const menuIcon = document.getElementById('menu-icon');

  if (!menuToggle || !mobileDropdown || !menuIcon) return;

  menuToggle.addEventListener('click', event => {
    const isOpen = !mobileDropdown.classList.contains('opacity-0');
    if (isOpen) {
      mobileDropdown.classList.add('opacity-0', 'invisible', 'scale-95');
      mobileDropdown.classList.remove('opacity-100', 'visible', 'scale-100');
      menuIcon.textContent = 'lock';
    } else {
      mobileDropdown.classList.remove('opacity-0', 'invisible', 'scale-95');
      mobileDropdown.classList.add('opacity-100', 'visible', 'scale-100');
      menuIcon.textContent = 'close';
    }
    event.stopPropagation();
  });

  document.addEventListener('click', event => {
    if (!mobileDropdown.contains(event.target as Node) && !menuToggle.contains(event.target as Node)) {
      mobileDropdown.classList.add('opacity-0', 'invisible', 'scale-95');
      mobileDropdown.classList.remove('opacity-100', 'visible', 'scale-100');
      menuIcon.textContent = 'lock';
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth < 768) return;
    mobileDropdown.classList.add('opacity-0', 'invisible', 'scale-95');
    mobileDropdown.classList.remove('opacity-100', 'visible', 'scale-100');
    menuIcon.textContent = 'lock';
  });
});
