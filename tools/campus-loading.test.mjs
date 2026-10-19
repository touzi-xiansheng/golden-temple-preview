import test from 'node:test';
import assert from 'node:assert/strict';
import { finishBuild, runBuild } from '../src/campus/loading.js';

test('chunked construction lets queued browser tasks run before construction completes', async () => {
  let handled = false, finished = false, paints = 0;
  function* build() {
    for (let batch = 0; batch < 4; batch++) {
      const deadline = performance.now() + 15;
      while (performance.now() < deadline) { /* emulate a synchronous geometry batch */ }
      yield '生成中';
    }
    finished = true; return 42;
  }
  const input = new Promise(resolve => setTimeout(() => { handled = true; assert.equal(finished,false); resolve(); },0));
  const result = await runBuild(build(), {
    yieldControl: () => new Promise(resolve => setTimeout(() => { paints++; resolve(); },0)),
    onProgress: message => assert.equal(message,'生成中'),
  });
  await input;
  assert.equal(result,42); assert.equal(handled,true); assert.ok(paints>0);
  assert.equal(finishBuild((function*(){yield;return 42;})()),42);
});

test('interrupted loading unwinds the pending capture and propagates the failure', async () => {
  let disposed = false, committed = false;
  function* capture() {
    try {
      const deadline = performance.now() + 15;
      while(performance.now()<deadline) {}
      yield '捕获中'; committed = true;
    } finally { disposed = true; }
  }
  await assert.rejects(runBuild(capture(),{yieldControl:async()=>{throw Error('context lost');}}),/context lost/);
  assert.equal(disposed,true); assert.equal(committed,false);
});
