// src/main.ts
export {};

declare global {
  interface Window {
    turnstile: any;
  }
}

// WebCrypto helper functions
async function encrypt(text: string): Promise<{ ciphertext: string, key: string }> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    enc.encode(text)
  );

  const exportedKey = await crypto.subtle.exportKey("raw", key);
  
  // Pack IV and ciphertext together
  const packed = new Uint8Array(iv.length + ciphertextBuf.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertextBuf), iv.length);
  
  // Base64 encode
  const base64Ciphertext = btoa(String.fromCharCode(...packed));
  const base64Key = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));

  return { ciphertext: base64Ciphertext, key: base64Key };
}

async function decrypt(base64Ciphertext: string, base64Key: string): Promise<string | null> {
  try {
    const keyBuf = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    const packedBuf = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));
    
    // Unpack IV and ciphertext
    const iv = packedBuf.slice(0, 12);
    const ciphertext = packedBuf.slice(12);

    const key = await crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const decryptedBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuf);
  } catch (err) {
    console.error("Decryption failed", err);
    return null;
  }
}

declare global {
  interface Window {
    turnstile: any;
  }
}

// State
let selectedTtl = 3600;
let turnstileWidgetId: string | null = null;
let currentTurnstileToken = '';

function initCreateScreen() {
    console.log("Create screen initialized");

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocal) {
        currentTurnstileToken = 'bypass';
        const tsContainer = document.getElementById('turnstile-container');
        if (tsContainer) tsContainer.style.display = 'none';
        console.log('Local environment detected: Turnstile bypassed.');
    } else {
        const tsScript = document.createElement('script');
        tsScript.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback";
        tsScript.async = true;
        tsScript.defer = true;
        document.head.appendChild(tsScript);

        (window as any).onloadTurnstileCallback = function() {
            if (!document.getElementById('turnstile-container')) return;
            turnstileWidgetId = window.turnstile.render('#turnstile-container', {
                sitekey: '1x00000000000000000000AA', // Dummy test key
                callback: function(token: string) {
                    currentTurnstileToken = token;
                },
            });
        };
    }

    const ttlButtons = document.querySelectorAll('#ttl-buttons button');
    
    // Default selection
    ttlButtons.forEach(btn => {
        if (parseInt((btn as HTMLElement).dataset.ttl || '0') === selectedTtl) {
            btn.className = "px-5 py-2.5 rounded-full text-sm font-semibold bg-primary text-on-primary shadow-lg shadow-primary/20 transition-all";
        } else {
            btn.className = "px-5 py-2.5 rounded-full text-sm font-semibold bg-white/60 text-on-surface-variant border border-outline-variant/20 hover:bg-white transition-all";
        }
    });

    ttlButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            selectedTtl = parseInt(target.dataset.ttl || '3600');
            
            ttlButtons.forEach(b => {
                b.className = "px-5 py-2.5 rounded-full text-sm font-semibold bg-white/60 text-on-surface-variant border border-outline-variant/20 hover:bg-white transition-all";
            });
            target.className = "px-5 py-2.5 rounded-full text-sm font-semibold bg-primary text-on-primary shadow-lg shadow-primary/20 transition-all";
        });
    });

    const actionBtn = document.getElementById('action-btn');
    actionBtn?.addEventListener('click', async () => {
        const secretInput = document.getElementById('secret-input') as HTMLTextAreaElement;
        const text = secretInput.value.trim();
        if (!text) {
            alert('Please enter a secret.');
            return;
        }

        if (!currentTurnstileToken) {
            alert('Please complete the captcha.');
            return;
        }

        const actionText = document.getElementById('action-text');
        if (actionText) actionText.innerText = "Encrypting...";
        actionBtn.classList.add('opacity-50', 'pointer-events-none');

        try {
            const { ciphertext, key } = await encrypt(text);
            
            const res = await fetch('/api/secrets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ciphertext,
                    ttl: selectedTtl,
                    turnstileToken: currentTurnstileToken
                })
            });

            if (!res.ok) {
                throw new Error("Failed to create secret on server");
            }

            const data = await res.json();
            
            // Build sharing URL
            const url = new URL(window.location.href);
            const params = new URLSearchParams();
            params.set('id', data.id);
            params.set('key', key);
            url.hash = params.toString();
            
            // Display Result
            const inputContainer = document.getElementById('input-container');
            const ttlContainer = document.getElementById('ttl-container');
            const turnstileContainer = document.getElementById('turnstile-container');

            if (ttlContainer) ttlContainer.style.display = 'none';
            if (turnstileContainer) turnstileContainer.style.display = 'none';
            
            if (inputContainer) {
                inputContainer.innerHTML = `
                    <label class="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3 ml-1">Your Shareable Link</label>
                    <div class="relative w-full">
                        <textarea readonly id="share-link" class="w-full min-h-[120px] bg-surface-container-lowest border border-primary/20 rounded-lg p-6 text-primary focus:ring-4 focus:ring-primary/10 transition-all shadow-sm text-lg leading-relaxed break-all resize-none">${url.toString()}</textarea>
                        <button id="copy-btn" class="absolute bottom-4 right-4 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors">
                            <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">content_copy</span> Copy
                        </button>
                    </div>
                `;
                
                document.getElementById('copy-btn')?.addEventListener('click', () => {
                    navigator.clipboard.writeText(url.toString());
                    const copyBtnText = document.getElementById('copy-btn');
                    if (copyBtnText) copyBtnText.innerHTML = `<span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">check</span> Copied`;
                });
            }

            // Transform Action button to "Create Another"
            if (actionText) actionText.innerText = "Create Another Secret";
            const icon = actionBtn.querySelector('.material-symbols-outlined');
            if (icon) icon.innerHTML = 'add';
            
            actionBtn.classList.remove('opacity-50', 'pointer-events-none');
            
            // Reset click behaviour
            actionBtn.replaceWith(actionBtn.cloneNode(true));
            document.getElementById('action-btn')?.addEventListener('click', () => {
                window.location.href = window.location.pathname;
            });

        } catch (err: any) {
            alert("Error: " + err.message);
            if (actionText) actionText.innerText = "Create Secret link";
            actionBtn.classList.remove('opacity-50', 'pointer-events-none');
        }
    });
}

async function initRevealScreen(hashParams: URLSearchParams) {
    const id = hashParams.get('id');
    const key = hashParams.get('key');
    
    // Modify the DOM to show Reveal state
    const inputContainer = document.getElementById('input-container');
    const ttlContainer = document.getElementById('ttl-container');
    const turnstileContainer = document.getElementById('turnstile-container');
    const actionBtn = document.getElementById('action-btn');
    const actionText = document.getElementById('action-text');

    if (ttlContainer) ttlContainer.style.display = 'none';
    if (turnstileContainer) turnstileContainer.style.display = 'none';

    document.title = "Reveal Secret — BlindDrop";
    
    // Change intro text
    const titleH1 = document.querySelector('h1');
    if (titleH1) titleH1.innerText = "Unlock Secret";
    const subP = document.querySelector('p');
    if (subP) subP.innerText = "This secret will be permanently destroyed once viewed.";

    if (inputContainer) {
        inputContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 bg-surface-container-lowest rounded-lg border border-primary/10 shadow-sm text-center">
                <span class="material-symbols-outlined text-5xl text-primary mb-4" style="font-variation-settings: 'FILL' 1;">lock</span>
                <p class="text-on-surface font-semibold text-lg max-w-sm">You have received an encrypted secret. Ready to unlock?</p>
            </div>
        `;
    }

    if (actionText) actionText.innerText = "Reveal & Destroy Secret";
    if (actionBtn) {
        const icon = actionBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.innerHTML = 'lock_open';
        
        actionBtn.addEventListener('click', async () => {
            if (actionText) actionText.innerText = "Decrypting...";
            actionBtn.classList.add('opacity-50', 'pointer-events-none');
            
            try {
                const res = await fetch(`/api/secrets/${id}`);
                
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${res.status}`);
                }
                
                const data = await res.json();
                const ciphertext = data.ciphertext;
                
                const plaintext = await decrypt(ciphertext, key as string);
                
                if (!plaintext) {
                    throw new Error("Invalid decryption key or corrupt payload.");
                }

                if (inputContainer) {
                    inputContainer.innerHTML = `
                        <label class="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3 ml-1">Decrypted Secret (Destroyed from server)</label>
                        <div class="relative w-full">
                            <textarea readonly id="decrypted-secret" class="w-full min-h-[160px] bg-surface-container-lowest border border-success/20 rounded-lg p-6 text-on-surface focus:ring-4 focus:ring-primary/10 transition-all shadow-sm text-lg leading-relaxed resize-none">${plaintext}</textarea>
                            <button id="copy-secret-btn" class="absolute bottom-4 right-4 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors">
                                <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">content_copy</span> Copy
                            </button>
                        </div>
                    `;
                    
                    document.getElementById('copy-secret-btn')?.addEventListener('click', () => {
                        navigator.clipboard.writeText(plaintext);
                        const btn = document.getElementById('copy-secret-btn');
                        if (btn) btn.innerHTML = `<span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">check</span> Copied`;
                    });
                }

                // Change button to return home
                if (actionText) actionText.innerText = "Create Your Own Secret";
                if (icon) icon.innerHTML = 'add';
                actionBtn.classList.remove('opacity-50', 'pointer-events-none');
                actionBtn.replaceWith(actionBtn.cloneNode(true));
                document.getElementById('action-btn')?.addEventListener('click', () => {
                    window.location.href = window.location.pathname;
                });

            } catch (err: any) {
                if (inputContainer) {
                    inputContainer.innerHTML = `
                        <div class="flex flex-col items-center justify-center p-8 bg-error/10 rounded-lg border border-error/20 text-center">
                            <span class="material-symbols-outlined text-5xl text-error mb-4" style="font-variation-settings: 'FILL' 1;">error</span>
                            <h3 class="text-error font-bold text-xl mb-2">Notice</h3>
                            <p class="text-error-dim font-medium max-w-sm">${err.message}</p>
                        </div>
                    `;
                }
                actionBtn.style.display = 'none';
            }
        });
    }
}

// Bootstrapping
const hashParams = new URLSearchParams(window.location.hash.slice(1));
if (hashParams.has('id') && hashParams.has('key')) {
    initRevealScreen(hashParams);
} else {
    initCreateScreen();
}

