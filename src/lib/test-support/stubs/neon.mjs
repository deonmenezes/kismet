// @neondatabase/serverless for tests: the tagged-template client, backed by the PGlite in globalThis.__kismetPg.
// A query runs when awaited (like Neon's lazy query promises), so it can also be passed to sql.transaction([...]).
const values = (vs) => vs.map((v) => (v instanceof Date ? v.toISOString() : v));

function query(strings, ...vs) {
  const text = strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, "");
  const q = { text, values: values(vs) };
  q.then = (ok, fail) => globalThis.__kismetPg.query(q.text, q.values).then((r) => r.rows).then(ok, fail);
  q.catch = (fail) => q.then(undefined, fail);
  q.finally = (f) => Promise.resolve(q).finally(f);
  return q;
}

export function neon() {
  const sql = (strings, ...vs) => query(strings, ...vs);
  // Neon's HTTP transaction: the queries in order, in one transaction (all or nothing), one result array each.
  sql.transaction = (queries) => globalThis.__kismetPg.transaction(async (tx) => {
    const list = typeof queries === "function" ? queries(sql) : queries;
    const out = [];
    for (const q of list) out.push((await tx.query(q.text, q.values)).rows);
    return out;
  });
  return sql;
}
