import './theme.js';
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

type NoticeTone = 'danger' | 'warning' | 'info';

async function readApiError(response: Response, fallback: string): Promise<Error> {
  const data = await response.json().catch(() => ({})) as { error?: unknown };
  return new Error(typeof data.error === 'string' ? data.error : fallback);
}

function secretUrl(id: string, suffix: string): string {
  return `${API_URL}/api/secrets/${encodeURIComponent(id)}${suffix}`;
}

/* ------------------------------------------------------------------ */
/* Small UI helpers                                                    */
/* ------------------------------------------------------------------ */

function icon(name: string, extraClass = ''): string {
  return `<span class="material-symbols-outlined is-filled ${extraClass}" aria-hidden="true">${name}</span>`;
}

function setHero(iconName: string, title?: string, subtitle?: string): void {
  const heroIcon = document.getElementById('hero-icon');
  if (heroIcon) heroIcon.textContent = iconName;
  if (title !== undefined) {
    const heading = document.getElementById('hero-title');
    if (heading) heading.textContent = title;
  }
  if (subtitle !== undefined) {
    const paragraph = document.getElementById('hero-subtitle');
    if (paragraph) paragraph.textContent = subtitle;
  }
}

function setActionBusy(button: HTMLButtonElement, busy: boolean, label?: string): void {
  const text = document.getElementById('action-text');
  const iconElement = document.getElementById('action-icon');
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  if (label && text) text.textContent = label;
  if (iconElement) {
    iconElement.classList.toggle('spin', busy);
    if (busy) {
      iconElement.dataset.restore = iconElement.textContent ?? '';
      iconElement.textContent = 'progress_activity';
    } else if (iconElement.dataset.restore !== undefined) {
      iconElement.textContent = iconElement.dataset.restore;
      delete iconElement.dataset.restore;
    }
  }
}

function setActionIcon(name: string): void {
  const iconElement = document.getElementById('action-icon');
  if (iconElement) iconElement.textContent = name;
}

/** Replaces the action button with a fresh "start over" button. */
function convertActionToRestart(button: HTMLButtonElement, label: string): void {
  const text = document.getElementById('action-text');
  if (text) text.textContent = label;
  setActionIcon('add');
  setActionBusy(button, false);
  button.replaceWith(button.cloneNode(true));
  document.getElementById('action-btn')?.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });
}

function showCreateError(message: string): void {
  const box = document.getElementById('create-error');
  if (!box) return;
  box.innerHTML = `${icon('error', 'text-[20px] shrink-0')}<span></span>`;
  const span = box.querySelector('span:last-child');
  if (span) span.textContent = message;
  box.hidden = false;
}

function clearCreateError(): void {
  const box = document.getElementById('create-error');
  if (box) box.hidden = true;
}

function setInlineError(container: HTMLElement, message: string): void {
  container.querySelector('#reveal-error')?.remove();
  const error = document.createElement('div');
  error.id = 'reveal-error';
  error.className = 'inline-error mt-4';
  error.setAttribute('role', 'alert');
  error.innerHTML = `${icon('error', 'text-[20px] shrink-0')}<span></span>`;
  const span = error.querySelector('span:last-child');
  if (span) span.textContent = message;
  container.appendChild(error);
}

function clearInlineError(container: HTMLElement): void {
  container.querySelector('#reveal-error')?.remove();
}

interface NoticeStyle {
  tone: NoticeTone;
  iconName: string;
  heading: string;
  subtitle: string;
}

function noticeToneFor(message: string): NoticeStyle {
  const lower = message.toLowerCase();
  if (lower.includes('already been viewed') || lower.includes('burned')) {
    return {
      tone: 'warning',
      iconName: 'local_fire_department',
      heading: 'This secret is gone',
      subtitle: 'One-time links cannot be reopened. Ask the sender for a new one if you still need it.'
    };
  }
  if (lower.includes('not found') || lower.includes('expired')) {
    return {
      tone: 'warning',
      iconName: 'timer_off',
      heading: 'Link expired or invalid',
      subtitle: 'The secret was never stored here or its time-to-live has passed. Nothing remains on the server.'
    };
  }
  if (lower.includes('missing')) {
    return {
      tone: 'danger',
      iconName: 'link_off',
      heading: 'Incomplete link',
      subtitle: 'The decryption key travels after the # in the link. Copy the full link exactly as it was shared.'
    };
  }
  return {
    tone: 'danger',
    iconName: 'error',
    heading: 'Something went wrong',
    subtitle: 'Do not refresh or retry automatically; the server state may be unknown.'
  };
}

function renderNotice(container: HTMLElement, message: string): void {
  const { tone, iconName, heading, subtitle } = noticeToneFor(message);
  container.innerHTML = `
    <div class="notice notice-${tone}">
      ${icon(iconName, 'text-5xl mb-4')}
      <h3 class="font-display font-bold text-xl mb-2 tracking-tight"></h3>
      <p id="notice-message" class="font-medium max-w-sm text-fg-muted"></p>
    </div>
  `;
  const headingElement = container.querySelector('h3');
  if (headingElement) headingElement.textContent = heading;
  const messageElement = container.querySelector('#notice-message');
  if (messageElement) messageElement.textContent = message;
  setHero(iconName, heading, subtitle);
}

function wireCopyButton(button: HTMLElement | null, getValue: () => string): void {
  button?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getValue());
      button.innerHTML = `${icon('check', 'text-[18px]')} Copied`;
      button.classList.add('is-done');
      window.setTimeout(() => {
        button.innerHTML = `${icon('content_copy', 'text-[18px]')} Copy`;
        button.classList.remove('is-done');
      }, 2200);
    } catch {
      button.innerHTML = `${icon('error', 'text-[18px]')} Copy failed`;
    }
  });
}

function renderShareLink(container: HTMLElement, shareUrl: string): void {
  container.innerHTML = `
    <div>
      <div class="flex items-center justify-between mb-2.5 px-1">
        <label for="share-link" class="label">Your one-time link</label>
        <span class="tag">Ready</span>
      </div>
      <div class="relative w-full">
        <textarea readonly id="share-link" spellcheck="false" autocomplete="off" class="field field-mono field-primary pb-16 break-all"></textarea>
        <button id="copy-btn" type="button" class="btn-soft absolute bottom-3 right-3">${icon('content_copy', 'text-[18px]')} Copy</button>
      </div>
      <div class="notice notice-warning !flex-row !items-start !text-left gap-3 !p-4 mt-4 text-sm">
        ${icon('warning', 'text-[20px] shrink-0')}
        <p class="font-medium text-fg-muted">Anyone with this link can read the secret, and it works exactly once. Send it through a channel you trust; the key after <span class="font-mono">#</span> never reaches our server.</p>
      </div>
    </div>
  `;

  const shareLink = container.querySelector('#share-link') as HTMLTextAreaElement | null;
  if (shareLink) {
    shareLink.value = shareUrl;
    shareLink.addEventListener('focus', () => shareLink.select());
  }
  wireCopyButton(container.querySelector('#copy-btn'), () => shareUrl);
}

function renderDecryptedSecret(container: HTMLElement, plaintext: string): void {
  container.innerHTML = `
    <div>
      <div class="flex items-center justify-between mb-2.5 px-1">
        <label id="decrypted-label" for="decrypted-secret" class="label">Decrypted secret</label>
        <span class="tag text-success border-success/30">${icon('check', 'text-[13px] mr-1')} Server copy deleted</span>
      </div>
      <div class="relative w-full">
        <textarea readonly id="decrypted-secret" spellcheck="false" autocomplete="off" class="field field-mono field-success pb-16"></textarea>
        <button id="copy-secret-btn" type="button" class="btn-soft absolute bottom-3 right-3">${icon('content_copy', 'text-[18px]')} Copy</button>
      </div>
      <p class="hint mt-3 px-1">This is the only copy. Store it somewhere safe now; reloading this page will not bring it back.</p>
    </div>
  `;

  const decryptedSecret = container.querySelector('#decrypted-secret') as HTMLTextAreaElement | null;
  if (decryptedSecret) decryptedSecret.value = plaintext;
  wireCopyButton(container.querySelector('#copy-secret-btn'), () => plaintext);
}

/* ------------------------------------------------------------------ */
/* Create screen                                                       */
/* ------------------------------------------------------------------ */

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
            clearCreateError();
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

  // Passphrase visibility toggle
  const passphraseInput = document.getElementById('passphrase-input') as HTMLInputElement | null;
  const passphraseToggle = document.getElementById('passphrase-toggle') as HTMLButtonElement | null;
  passphraseToggle?.addEventListener('click', () => {
    if (!passphraseInput) return;
    const reveal = passphraseInput.type === 'password';
    passphraseInput.type = reveal ? 'text' : 'password';
    passphraseToggle.setAttribute('aria-pressed', reveal ? 'true' : 'false');
    passphraseToggle.setAttribute('aria-label', reveal ? 'Hide passphrase' : 'Show passphrase');
    const toggleIcon = passphraseToggle.querySelector('.material-symbols-outlined');
    if (toggleIcon) toggleIcon.textContent = reveal ? 'visibility_off' : 'visibility';
  });

  // Expiry selection
  let selectedTtl = 3600;
  const ttlButtons = document.querySelectorAll<HTMLButtonElement>('#ttl-buttons button');
  ttlButtons.forEach(button => {
    button.setAttribute('aria-pressed', Number(button.dataset.ttl) === selectedTtl ? 'true' : 'false');
    button.addEventListener('click', event => {
      const target = event.currentTarget as HTMLButtonElement;
      selectedTtl = Number(target.dataset.ttl);
      ttlButtons.forEach(item => item.setAttribute('aria-pressed', 'false'));
      target.setAttribute('aria-pressed', 'true');
    });
  });

  document.getElementById('secret-input')?.addEventListener('input', clearCreateError);

  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement | null;
  actionBtn?.addEventListener('click', async () => {
    const secretInput = document.getElementById('secret-input') as HTMLTextAreaElement | null;
    const text = secretInput?.value ?? '';
    if (!text || /^\s*$/.test(text)) {
      showCreateError('Enter a secret to share.');
      secretInput?.focus();
      return;
    }

    try {
      assertPlaintextSize(text);
    } catch (error) {
      showCreateError(error instanceof Error ? error.message : 'Secret is too large.');
      return;
    }

    if (!currentTurnstileToken) {
      showCreateError(siteKeyMissingMessage());
      return;
    }

    clearCreateError();
    setActionBusy(actionBtn, true, 'Encrypting…');

    try {
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

      setHero('check', 'Your link is ready', passphrase
        ? 'Share the link and the passphrase through two different channels.'
        : 'Send it to one person. It opens once, then the secret is destroyed.');
      convertActionToRestart(actionBtn, 'Create another secret');
    } catch (error) {
      showCreateError(error instanceof Error ? error.message : 'Unable to create secret.');
      setActionBusy(actionBtn, false, 'Create secret link');
    }
  });

  function siteKeyMissingMessage(): string {
    return isLocal
      ? 'Please configure Turnstile or explicitly enable the local test bypass.'
      : 'Please complete the captcha.';
  }

  void turnstileWidgetId;
}

/* ------------------------------------------------------------------ */
/* Reveal screen                                                       */
/* ------------------------------------------------------------------ */

async function initRevealScreen(hashParams: URLSearchParams): Promise<void> {
  const id = hashParams.get('id');
  const key = hashParams.get('key');
  if (!id) return;

  const inputContainer = document.getElementById('input-container');
  const ttlContainer = document.getElementById('ttl-container');
  const turnstileContainer = document.getElementById('turnstile-container');
  const createError = document.getElementById('create-error');
  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement | null;
  const actionText = document.getElementById('action-text');
  if (!inputContainer || !actionBtn) return;

  if (ttlContainer) ttlContainer.style.display = 'none';
  if (turnstileContainer) turnstileContainer.style.display = 'none';
  if (createError) createError.remove();
  document.title = 'Reveal Secret — BlindDrop';

  setHero('lock', 'Unlock secret', 'This secret will be permanently destroyed once delivered. Refreshing requires reopening the original link.');
  document.querySelectorAll('.nav-link, .menu-item').forEach(link => link.classList.remove('is-active'));

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
    <div class="notice notice-info">
      ${icon('encrypted', 'text-5xl mb-4')}
      <p class="text-fg font-semibold text-lg max-w-sm">You have received an encrypted secret. Ready to unlock?</p>
      <p class="hint mt-2 max-w-sm">Nothing is fetched until you press the button below. This step is irreversible.</p>
    </div>
  `;
  if (meta.requires_passphrase) {
    const passphraseWrapper = document.createElement('div');
    passphraseWrapper.className = 'mt-6 w-full text-left';
    passphraseWrapper.innerHTML = `
      <div class="flex items-center gap-2 mb-2.5 px-1">
        <label for="reveal-passphrase" class="label">Passphrase</label>
        <span class="tag">Required</span>
      </div>
      <input type="password" id="reveal-passphrase" spellcheck="false" autocomplete="off" autocapitalize="off" class="field" placeholder="Enter the passphrase the sender gave you" />
    `;
    inputContainer.appendChild(passphraseWrapper);
  }

  if (actionText) actionText.textContent = 'Reveal & Destroy Secret';
  setActionIcon('lock_open');

  let envelope: RevealEnvelope | null = null;
  let deletionConfirmed = false;
  let finished = false;

  actionBtn.addEventListener('click', async () => {
    if (finished) return;

    const passphraseInput = document.getElementById('reveal-passphrase') as HTMLInputElement | null;
    const passphrase = passphraseInput?.value ?? '';
    if (meta.requires_passphrase && !passphrase) {
      setInlineError(inputContainer, 'A passphrase is required.');
      passphraseInput?.focus();
      return;
    }
    if (!key) {
      renderNotice(inputContainer, 'This link is missing its decryption key.');
      actionBtn.style.display = 'none';
      return;
    }

    clearInlineError(inputContainer);
    setActionBusy(actionBtn, true, 'Decrypting…');

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
          setActionBusy(actionBtn, false, 'Try Again');
          return;
        }
        throw new Error('The encrypted secret was delivered and deleted, but this link could not decrypt it.');
      }

      renderDecryptedSecret(inputContainer, plaintext);
      finished = true;
      setHero('lock_open', 'Secret revealed', 'The server copy has been destroyed. This page holds the only remaining copy.');
      convertActionToRestart(actionBtn, 'Create your own secret');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reveal secret.';
      renderNotice(inputContainer, message);
      // A failed reveal request may have reached the server. Do not retry or
      // claim deletion when the response status is unknown.
      actionBtn.style.display = 'none';
    }
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

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

  const setOpen = (open: boolean) => {
    mobileDropdown.classList.toggle('opacity-0', !open);
    mobileDropdown.classList.toggle('invisible', !open);
    mobileDropdown.classList.toggle('scale-95', !open);
    mobileDropdown.classList.toggle('opacity-100', open);
    mobileDropdown.classList.toggle('visible', open);
    mobileDropdown.classList.toggle('scale-100', open);
    menuIcon.textContent = open ? 'close' : 'menu';
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };

  menuToggle.addEventListener('click', event => {
    setOpen(mobileDropdown.classList.contains('opacity-0'));
    event.stopPropagation();
  });

  document.addEventListener('click', event => {
    if (!mobileDropdown.contains(event.target as Node) && !menuToggle.contains(event.target as Node)) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setOpen(false);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) setOpen(false);
  });
});
