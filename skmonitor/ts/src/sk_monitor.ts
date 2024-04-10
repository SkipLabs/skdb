import type * as Internal from "#std/sk_internal_types.js";
// sknpm: Cannot be multiline for package sources
// prettier-ignore
import type { int, ptr, float, Environment, Links, ToWasmManager, Utils, Opt } from "#std/sk_types.js";

interface ToWasm {
  SKIP_SKMonitor_write: (content: ptr<Internal.String>) => void;
  SKIP_SKMonitor_traceIdOpt: () => Opt<ptr<Internal.String>>;
  SKIP_SKMonitor_monitoringOpt: () => Opt<ptr<Internal.String>>;
  SKIP_JS_now: () => float;
}

class LinksImpl implements Links {
  write!: (content: ptr<Internal.String>) => int;
  traceIdOpt!: () => Opt<ptr<Internal.String>>;
  monitoringOpt!: () => Opt<ptr<Internal.String>>;

  constructor() {}

  complete = (utils: Utils, exports: object) => {
    this.write = (content: ptr<Internal.String>) => {
      console.log(utils.importString(content));
      return 1;
    };
    this.traceIdOpt = () => {
      return null;
    };
    this.monitoringOpt = () => {
      return null;
    };
  };
}

class Manager implements ToWasmManager {
  constructor() {}

  prepare = (wasm: object) => {
    let toWasm = wasm as ToWasm;
    let links = new LinksImpl();
    toWasm.SKIP_SKMonitor_write = (content: ptr<Internal.String>) =>
      links.write(content);
    toWasm.SKIP_SKMonitor_traceIdOpt = () => links.traceIdOpt();
    toWasm.SKIP_SKMonitor_monitoringOpt = () => links.monitoringOpt();
    toWasm.SKIP_JS_now = () => Date.now() / 1000;
    return links;
  };
}

/** @sk init */
export function init(env?: Environment) {
  return Promise.resolve(new Manager());
}
