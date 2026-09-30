/**
 * /ask hand-off: the call-back request dialog and hand-off measurement.
 *
 * The consultant page (`src/pages/ask.astro`) announces the conversation with an
 * `ask:state` event. This module owns everything that happens once a visitor
 * decides to talk to a person: it counts the hand-off, shows what will be sent,
 * and submits through the same `/api/estimate` endpoint as the estimate form,
 * so validation, the lead record, the phone alert and the email all stay in one
 * place (role "Ask assistant" marks where the lead came from).
 */
import {
  buildLeadNotes,
  isHandoffKind,
  type AskMessage,
  type AskProject,
  type HandoffKind,
} from '../lib/ask-handoff';

type AskState = { project: AskProject; conversation: AskMessage[] };

const LEAD_ROLE = 'Ask assistant';
const SUCCESS_EVENT = { event: 'generate_lead', method: 'ask_callback' } as const;

let state: AskState = { project: {}, conversation: [] };
const recorded = new Set<HandoffKind>();

function pushEvent(payload: Record<string, unknown>): void {
  try {
    const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push(payload);
  } catch {
    // Analytics must never be able to break the page.
  }
}

/** Counts a hand-off once per kind per page view, in GA4 and on the server. */
function recordHandoff(kind: HandoffKind): void {
  if (recorded.has(kind)) return;
  recorded.add(kind);
  pushEvent({ event: 'ask_handoff', handoff: kind });
  void fetch('/ask/api/handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind }),
    keepalive: true,
  }).catch(() => {});
}

/** Same two storage keys the estimate form reads; see BaseLayout.astro. */
function visitContext(): { visitorId: string; journey: string } {
  let visitorId = '';
  let visits: unknown = [];
  let firstTouch: unknown = null;
  try {
    visitorId = localStorage.getItem('clearview:vid') || '';
    visits = JSON.parse(sessionStorage.getItem('clearview:visits') || '[]');
    firstTouch = JSON.parse(localStorage.getItem('clearview:first_touch') || 'null');
  } catch {
    // Private mode or blocked storage: the lead simply has no journey.
  }
  return { visitorId, journey: JSON.stringify({ visits, firstTouch }) };
}

function query<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

function bindDialog(dialog: HTMLDialogElement): void {
  if (dialog.dataset.bound === 'true') return;
  dialog.dataset.bound = 'true';

  const form = query<HTMLFormElement>(dialog, '[data-callback-form]');
  const success = query<HTMLElement>(dialog, '[data-callback-success]');
  const status = query<HTMLElement>(dialog, '[data-callback-status]');
  const notes = query<HTMLTextAreaElement>(dialog, '[name="notes"]');
  const submit = query<HTMLButtonElement>(dialog, '[data-callback-submit]');
  const opener = document.querySelector<HTMLElement>('[data-ask-callback-open]');
  const fallback = document.querySelector<HTMLAnchorElement>('[data-ask-handoff-link]');
  if (!form || !success || !status || !notes || !submit || !opener) return;

  const idleLabel = submit.textContent || 'Request a call back';
  // Refresh the prefilled notes from the conversation, but never over the visitor's own edits.
  let notesEdited = false;
  notes.addEventListener('input', () => {
    notesEdited = true;
  });

  const clearErrors = () => {
    status.textContent = '';
    form.querySelectorAll<HTMLElement>('[data-field-error]').forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  };

  const showFieldErrors = (fields: Record<string, unknown>) => {
    let first: HTMLElement | null = null;
    for (const [name, message] of Object.entries(fields)) {
      const error = form.querySelector<HTMLElement>(`[data-field-error="${name}"]`);
      const input = form.querySelector<HTMLElement>(`[name="${name}"]`);
      if (error) {
        error.textContent = String(message);
        error.hidden = false;
      }
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        first ||= input;
      }
    }
    first?.focus();
  };

  opener.addEventListener('click', () => {
    // Very old browsers lack <dialog>; the estimate page does the same job.
    if (typeof dialog.showModal !== 'function') {
      if (fallback) window.location.assign(fallback.href);
      return;
    }
    recordHandoff('callback_open');
    if (!form.hidden && !notesEdited) notes.value = buildLeadNotes(state.project, state.conversation);
    dialog.showModal();
    form.querySelector<HTMLElement>('[name="name"]')?.focus();
  });

  dialog.querySelectorAll<HTMLElement>('[data-callback-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[name]').forEach((field) => {
    field.addEventListener('input', () => {
      const error = form.querySelector<HTMLElement>(`[data-field-error="${field.name}"]`);
      if (error && !error.hidden) {
        error.hidden = true;
        error.textContent = '';
      }
      field.removeAttribute('aria-invalid');
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const data = new FormData(form);
    data.set('role', LEAD_ROLE);
    const { visitorId, journey } = visitContext();
    data.set('visitor_id', visitorId);
    data.set('visit_journey', journey);

    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const response = await fetch('/api/estimate', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: data,
      });
      const result: unknown = await response.json().catch(() => null);
      const body = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
      if (!response.ok || body?.ok !== true) {
        if (body?.fields && typeof body.fields === 'object') showFieldErrors(body.fields as Record<string, unknown>);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not send.');
      }
      form.hidden = true;
      success.hidden = false;
      success.querySelector<HTMLElement>('[data-callback-close]')?.focus();
      pushEvent({ ...SUCCESS_EVENT });
    } catch (error) {
      // A TypeError is the browser reporting a network failure; its text is not for visitors.
      status.textContent =
        error instanceof Error && !(error instanceof TypeError)
          ? error.message
          : 'Could not send. Please call us instead.';
      submit.disabled = false;
      submit.textContent = idleLabel;
    }
  });
}

function init(): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-ask-callback]');
  if (dialog) bindDialog(dialog);
}

// Page-level listeners are added once; `init` re-binds after client-side navigation.
document.addEventListener('ask:state', (event) => {
  const detail = (event as CustomEvent<AskState>).detail;
  if (detail && typeof detail === 'object') state = detail;
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ask-track]') : null;
  const kind = target?.dataset.askTrack;
  if (isHandoffKind(kind)) recordHandoff(kind);
});

init();
document.addEventListener('astro:page-load', init);
