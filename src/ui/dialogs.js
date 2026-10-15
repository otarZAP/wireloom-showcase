// Small modal dialogs and toasts. No framework: a dialog is HTML + named buttons.

const modal = () => document.getElementById('modal');
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let closeCurrent = null;
export const dialogOpen = () => !!closeCurrent;

/**
 * Show a dialog. buttons: [{ id, label, kind: 'primary'|'danger'|'', cancel: bool }].
 * Resolves to { button, form } where form is a { name: value } map of the dialog's inputs.
 */
export function dialog({ title, body, buttons = [{ id: 'ok', label: 'OK', kind: 'primary' }], width }) {
  return new Promise(resolve => {
    const m = modal();
    m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" ${width ? `style="width:min(${width}px,94vw)"` : ''}>
      <header>${title}</header><div class="body">${body}</div>
      <footer>${buttons.map(b => `<button class="btn ${b.kind || ''}" data-b="${b.id}">${b.label}</button>`).join('')}</footer></div>`;
    m.classList.remove('hidden');
    const form = () => Object.fromEntries([...m.querySelectorAll('[name]')].map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value]));
    const done = id => { m.classList.add('hidden'); m.innerHTML = ''; closeCurrent = null; document.removeEventListener('keydown', onKey, true); resolve({ button: id, form: f }); };
    let f = {};
    const cancelId = (buttons.find(b => b.cancel) || buttons[buttons.length - 1]).id;
    const primary = (buttons.find(b => b.kind === 'primary') || buttons[0]).id;
    m.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { f = form(); done(b.dataset.b); });
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(cancelId); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); e.stopPropagation(); f = form(); done(primary); }
    };
    document.addEventListener('keydown', onKey, true);
    m.onclick = e => { if (e.target === m) done(cancelId); };
    closeCurrent = () => done(cancelId);
    const first = m.querySelector('input,select,textarea') || m.querySelector(`[data-b="${primary}"]`);
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 0);
  });
}

export async function confirmDialog(title, text, okLabel = 'OK', kind = 'primary') {
  const r = await dialog({ title, body: `<p>${text}</p>`, buttons: [{ id: 'ok', label: okLabel, kind }, { id: 'cancel', label: 'Cancel', cancel: true }] });
  return r.button === 'ok';
}

/** Three-way: 'save' | 'discard' | 'cancel'. */
export async function unsavedDialog(name) {
  const r = await dialog({
    title: 'Unsaved changes',
    body: `<p>Save the changes to <b>${esc(name || 'this project')}</b> first?</p>`,
    buttons: [{ id: 'save', label: 'Save', kind: 'primary' }, { id: 'discard', label: "Don't save", kind: 'danger' }, { id: 'cancel', label: 'Cancel', cancel: true }],
  });
  return r.button;
}

let toastTimer = null;
export function toast(text, bad = false, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = text; t.classList.toggle('bad', bad); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
