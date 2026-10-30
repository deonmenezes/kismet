// @daytonaio/sdk for tests: no network. A test sets globalThis.__kismetDaytona = { get(name) {...} } to play Daytona.
export class Daytona {
  constructor(config) {
    this.config = config;
  }
  get(name) {
    const d = globalThis.__kismetDaytona;
    if (!d) return Promise.reject(Object.assign(new Error("not found"), { statusCode: 404 }));
    return d.get(name, this.config);
  }
}
