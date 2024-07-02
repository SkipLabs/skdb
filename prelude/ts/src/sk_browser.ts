import type { float, int, Environment, Wrk, Shared } from "./sk_types.js";
import { MemFS, MemSys } from "./sk_mem_utils.js";

class WrkImpl implements Wrk {
  worker: Worker;

  constructor(worker: Worker) {
    this.worker = worker;
  }

  static fromPath(url: URL, options?: WorkerOptions) {
    return new this(new Worker(url, options));
  }

  postMessage = (message: any) => {
    this.worker.postMessage(message);
  };

  onMessage = (listener: (value: any) => void) => {
    this.worker.onmessage = listener;
  };
}

class Env implements Environment {
  shared: Map<string, Shared>;
  disableWarnings: boolean = false;
  fileSystem: MemFS;
  system: MemSys;
  timestamp: () => float;
  decodeUTF8: (utf8: ArrayBuffer) => string;
  encodeUTF8: (str: string) => Uint8Array;
  storage: () => Storage;
  onException: () => void;
  base64Decode: (base64: string) => Uint8Array;
  base64Encode: (toEncode: string, url?: boolean) => string;
  createSocket: (uri: string) => WebSocket;
  createWorker: (url: URL, options?: WorkerOptions) => Wrk;
  createWorkerWrapper: (worker: Worker) => Wrk;
  crypto: () => Crypto;
  environment: Array<string>;

  throwRuntime = (code: int) => {
    this.onException();
    if (code != 0) {
      throw new Error("Error with code: " + code);
    }
  };
  fs() {
    return this.fileSystem;
  }
  sys() {
    return this.system;
  }
  name() {
    return "browser";
  }

  fetch(url: URL) {
    let fUrl;
    if (url instanceof URL) {
      fUrl = url;
    } else {
      fUrl = new URL((url as any).default, import.meta.url);
    }
    return fetch(fUrl)
      .then((res) => res.arrayBuffer())
      .then((ab) => new Uint8Array(ab));
  }

  constructor(environment?: Array<string>) {
    this.shared = new Map<string, Shared>();
    this.fileSystem = new MemFS();
    this.system = new MemSys();
    this.environment = environment ?? [];
    let global = typeof window == "undefined" ? self : window;
    this.timestamp = () => global.performance.now();
    var decoder = new TextDecoder("utf8");
    this.decodeUTF8 = (utf8: ArrayBuffer) => decoder.decode(utf8);
    var encoder = new TextEncoder(); // always utf-8
    this.encodeUTF8 = (str: string) => encoder.encode(str);
    this.base64Decode = (base64: string) =>
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    this.base64Encode = (toEncode: string, url: boolean = false) => {
      const base64 = btoa(toEncode);
      return url ? base64.replaceAll("+", "-").replaceAll("/", "_") : base64;
    };
    this.storage = () => localStorage;
    this.onException = () => {};
    this.createSocket = (uri: string) => new WebSocket(uri);
    this.createWorker = (url: URL, options?: WorkerOptions) =>
      WrkImpl.fromPath(url, options);
    this.createWorkerWrapper = (worker: Worker) => new WrkImpl(worker);
    this.crypto = () => crypto;
  }
}

export function environment(environment?: Array<string>) {
  return new Env(environment);
}
