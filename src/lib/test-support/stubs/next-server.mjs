// next/server for tests: work scheduled with after() is collected, never run (it calls models and blob storage).
export const afterQueue = [];
export const after = (fn) => void afterQueue.push(fn);
