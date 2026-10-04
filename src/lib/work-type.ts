// Windows or siding, as shown in the Command Center. The server owns the rule (a quote's type is
// fixed at creation and its invoice and job inherit it: functions/internal/_lib/work-types.mjs);
// this is only how a stored value is labelled and filtered on the phone.

export type WorkType = 'windows' | 'siding';

const LABEL: Record<WorkType, string> = { windows: 'Windows', siding: 'Siding' };

/** Anything that is not exactly "siding" is window work (rows that predate the column). */
export function normalizeWorkType(value: unknown): WorkType {
  return value === 'siding' ? 'siding' : 'windows';
}

export const workTypeLabel = (value: unknown): string => LABEL[normalizeWorkType(value)];

/** Jobs also include "general" work (non-window jobs added directly, no quote); it is labelled, not filtered. */
export function jobTypeBadge(value: unknown): string {
  return value === 'general' ? '<span class="wt-badge wt-general">General</span>' : workTypeBadge(value);
}

/** A small pill for list rows. Styles are global (InternalLayout), so it works in runtime-built HTML. */
export function workTypeBadge(value: unknown): string {
  const type = normalizeWorkType(value);
  return `<span class="wt-badge wt-${type}">${LABEL[type]}</span>`;
}

const STORAGE_KEY = 'clearview:work-type-filter';

function remembered(): '' | WorkType {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value === 'windows' || value === 'siding' ? value : '';
  } catch {
    return '';
  }
}

/**
 * Wires the "All / Windows / Siding" group from WorkTypeFilter.astro. The choice is kept for the browser
 * session, so moving from Quotes to Invoices to Jobs stays on the same kind of work. Calls onChange only
 * when the person changes it; returns the starting value so the page can include it in its first load.
 */
export function bindWorkTypeFilter(root: ParentNode, onChange: (type: '' | WorkType) => void): '' | WorkType {
  const group = root.querySelector('[data-wt-filter]');
  if (!(group instanceof HTMLElement)) return '';
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[data-wt]')];
  const show = (type: '' | WorkType) => buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.wt === type)));
  const start = remembered();
  show(start);
  buttons.forEach((button) => button.addEventListener('click', () => {
    const next = (button.dataset.wt === 'siding' || button.dataset.wt === 'windows' ? button.dataset.wt : '') as '' | WorkType;
    show(next);
    try { sessionStorage.setItem(STORAGE_KEY, next); } catch { /* the filter still works without storage */ }
    onChange(next);
  }));
  return start;
}
