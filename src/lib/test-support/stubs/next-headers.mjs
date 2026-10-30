// next/headers for tests: no headers, and no cookies unless a test sets globalThis.__testCookies ({ name: value }).
export const cookies = async () => ({
  get: (name) => (globalThis.__testCookies?.[name] === undefined ? undefined : { name, value: globalThis.__testCookies[name] }),
  set: () => {},
  delete: () => {},
});
export const headers = async () => new Headers();
