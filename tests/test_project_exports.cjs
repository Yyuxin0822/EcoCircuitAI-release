const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../flaskr/ecocircuit/static/metabolism/toolbar.js'), 'utf8');

function setup() {
  const elements = {};
  for (const id of ['share-icon', 'save-image', 'save-svg', 'export-status']) {
    elements[id] = {textContent: '', style: {}, attrs: {}, addEventListener() {},
      setAttribute(k,v) {this.attrs[k]=v;}};
  }
  const timers = [];
  const downloads = [];
  const context = {
    console, Blob, AbortController,
    URL: {createObjectURL: () => 'blob:test', revokeObjectURL() {}},
    document: {getElementById: id => elements[id], addEventListener() {},
      body: {appendChild(el) { el.attached = true; }},
      createElement() { return {click() {assert.ok(this.attached); downloads.push(this.download);}, remove() {}}; }},
    setTimeout(fn, ms) {if (ms === 60000) {timers.push(fn); return 0;} return setTimeout(fn,ms);},
    clearTimeout, window: {}
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {context, elements, downloads, timers};
}
test('success requests both files, blocks duplicate clicks, restores controls', async () => {
  const {context:c,elements:e} = setup();
  const calls=[];
  c.downloadSvg=async (id,format)=> {calls.push([id,format]);};
  const first=c.runProjectExport('png');
  assert.match(e['export-status'].textContent,/Preparing download/);
  assert.equal(e['save-svg'].attrs['aria-disabled'],'true');
  await c.runProjectExport('svg');
  await first;
  assert.deepEqual(calls,[['matrix-io','png'],['matrix-metabolism','png']]);
  assert.equal(e['save-svg'].attrs['aria-disabled'],'false');
  assert.match(e['export-status'].textContent,/Two downloads requested/);
});
test('partial failure is visible and does not report complete success', async () => {
  const {context:c,elements:e}=setup();
  let calls=0;
  c.downloadSvg=async()=>{if (++calls===2) throw new Error('Conversion failed');};
  await c.runProjectExport('png');
  assert.match(e['export-status'].textContent,/First download requested.*Conversion failed/);
  assert.equal(e['save-image'].attrs['aria-disabled'],'false');
});
test('missing diagram rejects instead of silently succeeding',async()=>{
  const {context:c}=setup();
  await assert.rejects(c.downloadSvg('missing','svg'),/Diagram is not ready/);
});
test('preparation timeout rejects',async()=>{
  const {context:c}=setup();
  await assert.rejects(c.withExportTimeout(new Promise(()=>{}),5,'Timed out'),/Timed out/);
});
test('download attaches anchor and delays URL cleanup',()=>{
  const {context:c,downloads,timers}=setup();
  c.triggerExportDownload(new Blob(['svg']),'diagram.svg');
  assert.deepEqual(downloads,['diagram.svg']);
  assert.equal(timers.length,1);
});
