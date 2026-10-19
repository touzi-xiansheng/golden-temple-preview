// Synchronous callers and the browser consume the same deterministic build steps.
export function finishBuild(steps) {
  let step;
  do { step = steps.next(); } while (!step.done);
  return step.value;
}

export async function runBuild(steps, { yieldControl, onProgress = () => {} }) {
  let deadline = performance.now() + 12, message;
  try {
    for (;;) {
      const step = steps.next();
      if (step.done) return step.value;
      if (step.value) message = step.value;
      if (performance.now() >= deadline) {
        onProgress(message);
        await yieldControl();
        deadline = performance.now() + 12;
      }
    }
  } finally {
    // Also unwind GPU capture state when yielding fails (for example, context loss).
    steps.return?.();
  }
}
