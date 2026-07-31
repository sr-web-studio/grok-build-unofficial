/* mock.js - Interactive script for Grok Build UI design mock */

document.addEventListener('DOMContentLoaded', () => {
  // Global theme toggle button in mock nav
  const themeToggleBtn = document.getElementById('global-theme-toggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      themeToggleBtn.innerHTML = newTheme === 'dark' 
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg> Theme: Dark`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/></svg> Theme: Light`;
    });
  }

  // Collapsible thought toggle
  document.querySelectorAll('.gb-thought-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const container = toggle.closest('.gb-thought-block');
      if (container) {
        const body = container.querySelector('.gb-thought-expanded');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
        }
      }
    });
  });

  // Collapsible diff toggle
  document.querySelectorAll('.gb-diff-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const parent = btn.closest('.gb-tool-container') || btn.closest('.gb-approval-card');
      if (parent) {
        const diffView = parent.querySelector('.gb-diff-view');
        if (diffView) {
          const isHidden = diffView.style.display === 'none';
          diffView.style.display = isHidden ? 'block' : 'none';
          btn.textContent = isHidden ? 'collapse diff' : 'preview diff';
        }
      }
    });
  });

  // Question option row toggle (Radio & Checkbox) + Other free-text input reveal
  document.querySelectorAll('.gb-option-row').forEach(row => {
    row.addEventListener('click', () => {
      const list = row.closest('.gb-option-list');
      const card = row.closest('.gb-question-card');
      if (!list) return;

      const isRadio = !!row.querySelector('.gb-radio');
      const isCheckbox = !!row.querySelector('.gb-checkbox');

      if (isRadio) {
        list.querySelectorAll('.gb-option-row').forEach(r => {
          r.classList.remove('selected');
          const radio = r.querySelector('.gb-radio');
          if (radio) radio.classList.remove('selected');
        });
        row.classList.add('selected');
        const radio = row.querySelector('.gb-radio');
        if (radio) radio.classList.add('selected');
      } else if (isCheckbox) {
        row.classList.toggle('selected');
        const box = row.querySelector('.gb-checkbox');
        if (box) box.classList.toggle('selected');
      }

      // Check if Other... option is selected in this question card
      if (card) {
        const otherRow = Array.from(list.querySelectorAll('.gb-option-row')).find(r => r.textContent.includes('Other'));
        const otherInput = card.querySelector('.gb-question-input');
        if (otherInput && otherRow) {
          const isOtherSelected = otherRow.classList.contains('selected');
          otherInput.style.display = isOtherSelected ? 'block' : 'none';
        }
      }
    });
  });

  // Code block copy button stopPropagation & copy handling
  document.querySelectorAll('.gb-code-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const codeBlock = btn.closest('pre');
      if (codeBlock) {
        const text = codeBlock.innerText.replace(/^(COPY|HTML|TS|JS|CSS|JSON)\n/, '');
        navigator.clipboard.writeText(text).catch(() => {});
        const orig = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      }
    });
  });

  // User message copy button (C4)
  document.querySelectorAll('.gb-msg-copy-user').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const msg = btn.closest('.gb-user-msg');
      const text = btn.getAttribute('data-prompt') || (msg ? msg.querySelector('.gb-user-text')?.innerText || '' : '');
      if (text) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      btn.classList.add('copied');
      const useEl = btn.querySelector('use');
      if (useEl) useEl.setAttribute('href', '#icon-check');
      // Icon-only button: the confirmation must reach a screen reader too.
      btn.setAttribute('aria-label', 'Copied');
      setTimeout(() => {
        btn.classList.remove('copied');
        if (useEl) useEl.setAttribute('href', '#icon-copy');
        btn.setAttribute('aria-label', 'Copy message');
      }, 1200);
    });
  });

  // Assistant message copy button (C4)
  document.querySelectorAll('.gb-msg-copy-assistant').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-markdown') || '';
      if (text) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      btn.classList.add('copied');
      const useEl = btn.querySelector('use');
      if (useEl) useEl.setAttribute('href', '#icon-check');
      const label = btn.querySelector('span');
      if (label) label.textContent = 'Copied';
      setTimeout(() => {
        btn.classList.remove('copied');
        if (useEl) useEl.setAttribute('href', '#icon-copy');
        if (label) label.textContent = 'Copy';
      }, 1200);
    });
  });
});
