const styles = {
  picture: { name: 'Picture', description: 'A fixed window with an uninterrupted view.', operation: 'Picture windows are fixed and do not open.' },
  casement: { name: 'Casement', description: 'A side-hinged sash that swings outward.', operation: 'Move the slider to open the casement sash.' },
  'double-hung': { name: 'Single-hung', description: 'The lower sash slides up; the upper sash stays fixed.', operation: 'Move the slider to raise the lower sash.' },
  slider: { name: 'Slider', description: 'A sash that glides horizontally along the frame.', operation: 'Move the slider to slide the left sash.' },
};
const finishes = { graphite: 'Graphite', porcelain: 'Porcelain', bronze: 'Bronze' };
export function bindWindowStudio() {
  let cleanup = () => {};
  function bind() {
    const root = document.querySelector('[data-window-studio]');
    if (!root || root.dataset.bound) return;
    root.dataset.bound = 'true';
    const get = name => root.querySelector(`[data-${name}]`);
    const state = { kind: 'casement', finish: 'graphite', view: 'exterior', opening: 0 };
    let viewer = null, loading = false, disposed = false, generation = 0;
    const events = new AbortController();
    function update() {
      const style = styles[state.kind];
      root.querySelectorAll('[data-kind],[data-finish],[data-view]').forEach(button => {
        const key = button.dataset.kind ? 'kind' : button.dataset.finish ? 'finish' : 'view';
        button.setAttribute('aria-pressed', String(button.dataset[key] === state[key]));
      });
      get('description').textContent = style.description;
      get('selection').textContent = `${style.name} · ${finishes[state.finish]} appearance`;
      get('poster').src = `/models/windows/v001/${state.kind}.webp`;
      get('poster').alt = `Illustrative ${style.name.toLowerCase()} window, closed in a studio setting`;
      get('opening').value = String(state.opening);
      get('opening').disabled = !viewer || loading || state.kind === 'picture';
      get('open-value').textContent = state.kind === 'picture' ? 'Fixed' : state.opening ? `${state.opening}% open` : 'Closed';
      get('operation-note').textContent = state.kind === 'picture' || viewer ? style.operation : 'Start the 3D preview to open the sash.';
      const scope = `Window style preview: ${style.name}, ${finishes[state.finish]} appearance. Illustrative only; please confirm available products, finishes and dimensions.`;
      get('estimate').href = `/estimate?scope=${encodeURIComponent(scope)}`;
    }
    function status(message, ready) {
      if (disposed) return;
      loading = !ready;
      get('load-status').textContent = message;
      get('poster').hidden = ready;
      get('tools').hidden = !ready;
      get('gesture').hidden = !ready;
      get('start').hidden = ready;
      get('start').disabled = !ready;
      root.querySelector('.wv-start').classList.toggle('is-ready', ready);
      update();
    }
    function failed() {
      if (disposed) return;
      viewer?.dispose(); viewer = null;
      status('3D is unavailable. You can still compare styles and discuss your selection.', false);
      loading = false;
      get('start').disabled = false;
      get('start').textContent = 'Try 3D again';
    }
    get('start').addEventListener('click', async () => {
      if (loading) return;
      const token = ++generation;
      status('Loading the 3D preview…', false);
      try {
        const { createWindowViewer } = await import('./window-viewer.mjs');
        if (disposed || token !== generation) return;
        viewer = createWindowViewer(get('viewport'), status, failed);
        await viewer.load(state);
      } catch (error) { console.warn('Window preview unavailable:', error); failed(); }
    }, { signal: events.signal });
    root.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.kind) {
        state.kind = button.dataset.kind; state.opening = 0; state.view = 'exterior'; update();
        if (viewer) { try { await viewer.load(state); } catch (error) { console.warn('Window preview unavailable:', error); failed(); } }
      } else if (button.dataset.finish) { state.finish = button.dataset.finish; viewer?.update(state); update(); }
      else if (button.dataset.view) { state.view = button.dataset.view; viewer?.update(state); update(); }
      else if (button.hasAttribute('data-reset')) { state.view = 'exterior'; state.opening = 0; viewer?.update(state); viewer?.resetView(); update(); }
    }, { signal: events.signal });
    get('opening').addEventListener('input', event => {
      state.opening = Number(event.target.value); viewer?.update(state); update();
    }, { signal: events.signal });
    cleanup = () => { disposed = true; generation++; events.abort(); viewer?.dispose(); };
    update();
  }
  document.addEventListener('astro:before-swap', () => cleanup());
  document.addEventListener('astro:page-load', bind);
  bind();
}
