'use strict';

// Copy-on-write compatibility for existing task state transitions. Reading a
// task must not clone its input/result (which can contain large receipts).
const drafts = new WeakMap();
function createTaskDraft(base) {
  function wrap(value, parent = null, key = null) {
    if (!value || typeof value !== 'object') return value;
    const state = { base: value, copy: null, parent, key, children: new Map(), proxy: null };
    const changed = () => {
      if (!state.copy) {
        state.copy = Array.isArray(state.base) ? state.base.slice() : { ...state.base };
        if (state.parent) state.parent.changed();
      }
    };
    state.changed = changed;
    state.proxy = new Proxy(value, {
      get(_target, property) {
        const current = (state.copy || state.base)[property];
        if (!current || typeof current !== 'object') return current;
        const existing = state.children.get(property);
        if (existing && drafts.get(existing).base === current) return existing;
        if (drafts.has(current)) return current;
        const child = wrap(current, state, property);
        state.children.set(property, child);
        return child;
      },
      set(_target, property, next) {
        if (Object.is((state.copy || state.base)[property], next)) return true;
        changed(); state.copy[property] = next; state.children.delete(property); return true;
      },
      deleteProperty(_target, property) {
        if (!(property in (state.copy || state.base))) return true;
        changed(); delete state.copy[property]; state.children.delete(property); return true;
      },
      has: (_target, property) => property in (state.copy || state.base),
      ownKeys: () => Reflect.ownKeys(state.copy || state.base),
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Object.getOwnPropertyDescriptor(state.copy || state.base, property);
        return descriptor ? { ...descriptor, configurable: property === 'length' && Array.isArray(value) ? false : true } : undefined;
      },
    });
    drafts.set(state.proxy, state);
    return state.proxy;
  }
  return wrap(base);
}

function finishTaskDraft(value) {
  const state = value && typeof value === 'object' ? drafts.get(value) : null;
  if (!state) {
    if (Array.isArray(value)) return value.map(finishTaskDraft);
    return value;
  }
  if (!state.copy) return state.base;
  const result = state.copy;
  for (const [key, child] of state.children) {
    if (result[key] === drafts.get(child).base) result[key] = finishTaskDraft(child);
  }
  for (const key of Object.keys(result)) if (drafts.has(result[key])) result[key] = finishTaskDraft(result[key]);
  return result;
}

module.exports = { createTaskDraft, finishTaskDraft };
