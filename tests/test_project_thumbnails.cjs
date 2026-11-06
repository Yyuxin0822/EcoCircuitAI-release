// Offline DOM simulation: node tests/test_project_thumbnails.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; }
  appendChild(child) { this.children.push(child); }
  addEventListener() {}
}
async function scenario(refreshFails = false) {
  const container = new Element('div');
  const images = [];
  let fetches = 0;
  let ready;
  const exact = 'https://example.test/image?X-Amz-Signature=abc';
  const context = {
    projects: [{id: 'p', title: 'Test', system: '{}',
      thumbnails: JSON.stringify({matrix_io: exact, matrix_metabolism: exact})}],
    document: {
      getElementById: () => container,
      addEventListener: (event, fn) => { ready = fn; },
      createElement: tag => { const e = new Element(tag); if (tag === 'img') images.push(e); return e; }
    },
    console, encodeURIComponent, AbortController,
    setTimeout: (fn, delay) => { if (delay === 0) fn(); return 1; },
    clearTimeout: () => {},
    fetch: async () => { fetches++; return {ok: !refreshFails,
      json: async () => ({status: 'success', matrix_io: exact + '&fresh=1', matrix_metabolism: exact + '&fresh=2'})}; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../flaskr/account/static/account/js/projects.js'), 'utf8'), context);
  ready();
  assert.equal(container.children.length, 1, 'render before any network request');
  assert.equal(fetches, 0);
  assert.equal(images[0].src, exact);
  const a = images[0].onerror();
  const b = images[1].onerror();
  await Promise.all([a, b]);
  assert.equal(fetches, 1, 'share refresh between both images');
  if (refreshFails) {
    assert.ok(images.every(i => i.src.startsWith('data:image/svg+xml,')));
  } else {
    assert.equal(images[0].src, exact + '&fresh=1', 'use returned signed URL verbatim');
    assert.equal(images[1].src, exact + '&fresh=2');
    images[0].onerror();
    assert.ok(images[0].src.startsWith('data:image/svg+xml,'));
    assert.equal(images[0].onerror, null);
    assert.equal(fetches, 1);
  }
}
(async () => { await scenario(); await scenario(true); console.log('Thumbnail rendering/recovery checks passed'); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
