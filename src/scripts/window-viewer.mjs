import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const colors = { graphite: '#303b3b', porcelain: '#e9e6dc', bronze: '#746050' };
// Called only after the visitor asks for 3D. No WebGL or model work at page load.
export function createWindowViewer(viewport, onStatus, onFailure) {
  let disposed = false, token = 0, frame = 0, visible = true, model, center, size;
  let operations = [], materials = [], lastView, state;
  const cache = new Map();
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(getComputedStyle(viewport).getPropertyValue('--paper-sunk').trim() || '#eceae5');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-label', 'Interactive window: drag to rotate, scroll or pinch to zoom');
  viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, .01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = false;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x83977c, 1.6));
  const key = new THREE.DirectionalLight(0xfff7e8, 2.5); key.position.set(3, 5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe2eeff, 1.5); fill.position.set(-4, 2, -3); scene.add(fill);
  function render() {
    if (disposed || frame || !visible || document.hidden) return;
    frame = requestAnimationFrame(() => { frame = 0; if (!disposed && visible && !document.hidden) renderer.render(scene, camera); });
  }
  controls.addEventListener('change', render);
  const visibility = () => render();
  document.addEventListener('visibilitychange', visibility);
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) render(); });
  observer.observe(viewport);
  function view() {
    if (!center) return;
    const distance = Math.max(size.y, size.x / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.4;
    const direction = state.view === 'interior' ? new THREE.Vector3(-.35, .17, -1) : new THREE.Vector3(.36, .16, 1);
    controls.target.copy(center);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    if (state.view === 'detail') {
      controls.target.add(new THREE.Vector3(size.x * .24, -size.y * .3, 0));
      camera.position.copy(controls.target).add(new THREE.Vector3(.4, .07, 1).normalize().multiplyScalar(distance * .4));
    }
    controls.minDistance = Math.max(size.x, size.y) * .24; controls.maxDistance = distance * 2.8;
    controls.update(); lastView = state.view; render();
  }
  const resize = new ResizeObserver(() => {
    const bounds = viewport.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    renderer.setSize(bounds.width, bounds.height);
    camera.aspect = bounds.width / bounds.height; camera.updateProjectionMatrix(); view(); render();
  });
  resize.observe(viewport);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); onFailure(); });
  function optimize(root) {
    if (root.userData.webOptimized) return;
    const batches = new Map(); root.updateMatrixWorld(true);
    root.traverse(object => {
      if (!object.isMesh || Array.isArray(object.material)) return;
      const key = object.parent.uuid + object.material.uuid + Object.keys(object.geometry.attributes).sort().join(',');
      if (!batches.has(key)) batches.set(key, []); batches.get(key).push(object);
    });
    batches.forEach(meshes => {
      if (meshes.length < 2) return;
      const geometries = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrix));
      const combined = mergeGeometries(geometries, false); geometries.forEach(geometry => geometry.dispose());
      if (!combined) return;
      const parent = meshes[0].parent, material = meshes[0].material;
      meshes.forEach(mesh => { parent.remove(mesh); mesh.geometry.dispose(); });
      parent.add(new THREE.Mesh(combined, material));
    });
    root.userData.webOptimized = true;
  }
  function update(next) {
    state = next;
    materials.forEach(material => material.color.set(colors[state.finish]));
    operations.forEach(operation => {
      operation.node.position.lerpVectors(operation.closedPosition, operation.openPosition, state.opening / 100);
      operation.node.quaternion.slerpQuaternions(operation.closedQuaternion, operation.openQuaternion, state.opening / 100);
    });
    if (lastView !== state.view) view();
    render();
  }
  async function load(next) {
    state = next;
    const current = ++token, kind = state.kind;
    onStatus('Loading the window…', false);
    if (model) scene.remove(model);
    model = null; operations = []; materials = [];
    try {
      let asset = cache.get(kind);
      if (!asset) {
        asset = await new GLTFLoader().loadAsync(`/models/windows/v001/${kind}.glb`);
        if (disposed) { disposeAsset(asset.scene); return; }
        cache.set(kind, asset);
      }
      if (disposed || current !== token) return;
      model = asset.scene; optimize(model);
      model.traverse(object => {
        if (object.userData.web_primary) {
          object.userData.rest ??= { closedPosition: object.position.clone(), closedQuaternion: object.quaternion.clone(), openPosition: new THREE.Vector3().fromArray(object.userData.web_open_position), openQuaternion: new THREE.Quaternion().fromArray(object.userData.web_open_quaternion) };
          operations.push({ node: object, ...object.userData.rest });
        }
        if (!object.isMesh) return;
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => {
          if (/coated frame|exterior cap/i.test(material.name) && !materials.includes(material)) materials.push(material);
          if (/glass/i.test(material.name)) { material.roughness = .055; material.envMapIntensity = .8; material.transmission = .9; material.ior = 1.52; material.thickness = .004; }
        });
      });
      scene.add(model); update(state); model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model); center = box.getCenter(new THREE.Vector3()); size = box.getSize(new THREE.Vector3());
      view(); onStatus('3D preview ready.', true); render();
    } catch (error) { if (!disposed && current === token) throw error; }
  }
  function disposeAsset(root) {
    const geometries = new Set(), assetMaterials = new Set();
    root.traverse(object => { if (object.isMesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => assetMaterials.add(material)); } });
    geometries.forEach(geometry => geometry.dispose()); assetMaterials.forEach(material => material.dispose());
  }
  function dispose() {
    if (disposed) return;
    disposed = true; token++; cancelAnimationFrame(frame);
    controls.dispose(); resize.disconnect(); observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    cache.forEach(asset => disposeAsset(asset.scene)); cache.clear();
    environment.dispose(); renderer.dispose(); renderer.domElement.remove();
  }
  return { load, update, resetView: view, dispose };
}
