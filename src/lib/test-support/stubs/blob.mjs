// @vercel/blob for tests: every stored photo reads back as a few bytes; nothing is uploaded or deleted.
export const get = async () => ({ statusCode: 200, stream: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]).stream() });
export const put = async (pathname) => ({ pathname, url: `https://blob.test/${pathname}` });
// A test may make deletes fail: globalThis.__kismetBlobDel = async (pathnames) => { throw ... }.
export const del = async (pathnames) => globalThis.__kismetBlobDel?.(pathnames);
