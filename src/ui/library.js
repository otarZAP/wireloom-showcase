// The module library: built-in modules (bundled from /library) plus modules the user
// imports, which persist on this machine.

import { validateModule, MODULE_FORMAT } from '../core/index.js';

const BUILTIN = Object.values(import.meta.glob('../../library/*.module.json', { eager: true, import: 'default' }));
const USER_KEY = 'wireloom.userModules.v1';

export function userModules() {
  try { const list = JSON.parse(localStorage.getItem(USER_KEY)) || []; return list.filter(m => !validateModule(m).length); }
  catch { return []; }
}
function saveUser(list) { localStorage.setItem(USER_KEY, JSON.stringify(list)); }

export function addUserModule(m) {
  const list = userModules().filter(x => x.id !== m.id);
  list.push(m); saveUser(list);
}
export function removeUserModule(id) { saveUser(userModules().filter(m => m.id !== id)); }

/** Built-ins first; a user module with the same id overrides the built-in one. */
export function allModules() {
  const user = userModules(), ids = new Set(user.map(m => m.id));
  return [...BUILTIN.filter(m => !ids.has(m.id)).map(m => ({ ...m, origin: 'built-in' })),
          ...user.map(m => ({ ...m, origin: 'yours' }))]
    .sort((a, b) => (a.category || 'Other').localeCompare(b.category || 'Other') || a.name.localeCompare(b.name));
}

/** A starting point for someone writing their own module definition. */
export function moduleTemplate() {
  return {
    format: MODULE_FORMAT, version: 1,
    id: 'my-module',
    name: 'My module',
    category: 'Other',
    size: { w: 8, h: 6 },
    pins: [
      { name: 'VCC', x: 1, y: 5 }, { name: 'GND', x: 2, y: 5 },
      { name: 'SDA', x: 3, y: 5 }, { name: 'SCL', x: 4, y: 5 },
    ],
    antenna: null,
    metal: false, offboard: false,
    color: '#2b313b', note: '',
    verify: 'Pin positions are local holes (0.1" grid), parts side up, x right, y down from the top-left.',
    verified: false,
    source: '',
  };
}
