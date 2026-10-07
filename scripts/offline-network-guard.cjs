// Loaded only by mock CI / explicit local validation, never application startup.
const allowed = value => {
  const url = value instanceof URL ? value : new URL(String(value));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Mock CI blocks external HTTP");
};
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => { allowed(args[0]?.url || args[0]); return realFetch(...args); };
for (const protocol of ["http", "https"]) {
  const module = require(`node:${protocol}`);
  for (const method of ["get", "request"]) {
    const original = module[method];
    module[method] = function (input, ...args) {
      if (typeof input === "string" || input instanceof URL) allowed(input);
      else {
        const host = input?.hostname || input?.host || "localhost";
        if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) throw new Error("Mock CI blocks external HTTP");
      }
      return original.call(this, input, ...args);
    };
  }
}
