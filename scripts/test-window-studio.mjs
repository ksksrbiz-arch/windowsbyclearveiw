// Runtime asset contract: the viewer needs preserved sash parents and sampled open targets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
for (const [kind, primaryCount] of [['picture', 0], ['casement', 1], ['double-hung', 1], ['slider', 1]]) {
  const bytes = readFileSync(new URL(`public/models/windows/v001/${kind}.glb`, root));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${kind}: valid GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${kind}: glTF 2`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${kind}: complete binary`);
  assert.ok(bytes.length < 3_000_000, `${kind}: model payload stays below 3 MB`);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${kind}: JSON chunk`);
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.equal(document.buffers[0].uri, undefined, `${kind}: binary data is self-contained`);
  assert.ok(!document.images?.length, `${kind}: no unresolved procedural textures`);
  const controls = document.nodes.filter(node => node.extras?.web_primary);
  assert.equal(controls.length, primaryCount, `${kind}: one supported moving sash`);
  for (const node of document.nodes) {
    for (const key of ['translation', 'rotation', 'scale', 'matrix']) {
      if (node[key]) assert.ok(node[key].every(Number.isFinite), `${kind}: finite ${key}`);
    }
  }
  for (const node of controls) {
    assert.ok(node.children?.length, `${kind}: sash parts remain under their control`);
    const {web_open_position: p, web_open_quaternion: q} = node.extras;
    assert.equal(p.length, 3); assert.ok(p.every(Number.isFinite));
    assert.equal(q.length, 4); assert.ok(q.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-6, `${kind}: normalized opening quaternion`);
    assert.notDeepEqual([...p, ...q], [...(node.translation || [0,0,0]), ...(node.rotation || [0,0,0,1])], `${kind}: opening target differs from rest`);
  }
}
const page = readFileSync(new URL('dist/window-features.html', root), 'utf8');
assert.ok(page.includes('id="window-studio"'), 'viewer is in the existing features page');
assert.ok(page.includes('Explore in 3D'), 'explicit loading control is available');
assert.ok(page.includes('not exact Cascade or Milgard products'), 'product accuracy is qualified');
assert.ok(page.includes('/estimate?scope='), 'selection goes to the existing estimate flow');
assert.ok(!page.includes('fonts.googleapis.com'), 'no external font stylesheet is added');
assert.ok(!page.includes('three.module'), 'Three.js is not preloaded by the page');
console.log('window studio: four self-contained assets, moving controls, and integrated built page pass');
