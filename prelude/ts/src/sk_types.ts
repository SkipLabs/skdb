export type float = number;
export type int = number;
export type ptr = number;
export type ErrorObject = {
  message: string;
  stack?: string[];
  cause?: ErrorObject;
};

export type Opt<T> = T | null;

export enum Stream {
  OUT,
  ERR,
  DEBUG,
}

export class State {
  exceptionId = 0;
  exceptions = new Map<int, Exception>();
}

export class Exception {
  id: int;
  err: Error;

  constructor(err: Error, state: State) {
    this.id = ++state.exceptionId;
    this.err = err;
    state.exceptions.set(this.id, this);
  }
}

class SkRuntimeExit extends Error {
  code: int;

  constructor(code: int, message?: string) {
    super(message ?? "Runtime exit with code: " + code);
    this.code = code;
  }
}

class SkError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

export interface Shared {
  getName: () => string;
}

const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 100;
const O_EXCL = 200;
const O_TRUNC = 1000;
const O_APPEND = 4000;

export class Options {
  read: boolean;
  write: boolean;
  append: boolean;
  truncate: boolean;
  create: boolean;
  create_new: boolean;

  constructor(
    read: boolean = true,
    write: boolean = false,
    append: boolean = false,
    truncate: boolean = false,
    create: boolean = true,
    create_new: boolean = false,
  ) {
    this.read = read;
    this.write = write;
    this.append = append;
    this.truncate = truncate;
    this.create = create;
    this.create_new = create_new;
  }

  static w() {
    return new Options(false, true);
  }

  toFlags() {
    let res = 0;
    if (this.read && this.write) {
      res = O_RDWR;
    } else if (this.read) {
      res = O_RDONLY;
    } else if (this.write) {
      res = O_WRONLY;
    } else {
      return -1;
    }

    if (this.append) {
      res |= O_APPEND;
    }
    if (this.truncate) {
      res |= O_TRUNC;
    }
    if (this.create) {
      res |= O_CREAT;
    }
    if (this.create_new) {
      res |= O_EXCL;
    }
    return res;
  }

  static fromFlags(flags: int) {
    let is = (flags: int, value: int) => {
      return (flags & value) == value;
    };
    return new Options(
      !is(flags, O_WRONLY),
      is(flags, O_WRONLY) || is(flags, O_RDWR),
      is(flags, O_APPEND),
      is(flags, O_TRUNC),
      is(flags, O_CREAT),
      is(flags, O_EXCL),
    );
  }
}

export interface FileSystem {
  openFile(filename: string, flags: Options, mode: int): number;
  closeFile(fd: int): void;
  watchFile(filename: string, f: (change: string) => void): void;
  writeToFile(fd: int, content: string): void;
  appendToFile(filename: string, content: string): void;
  write(fd: int, content: string): int;
  read(fd: int, len: int): string | null;
  exists(filename: string): boolean;
}

export interface System {
  setenv(name: string, value: string): void;
  getenv(name: string): string | null;
  unsetenv(name: string): void;
}

export interface Wrk {
  postMessage: (message: any) => void;
  onMessage: (listener: (value: any) => void) => void;
}

export interface Environment {
  shared: Map<string, Shared>;
  name: () => string;
  disableWarnings: boolean;
  environment: Array<string>;
  createSocket: (uir: string) => WebSocket;
  createWorker: (url: URL, options?: WorkerOptions) => Wrk;
  createWorkerWrapper: (worker: Worker) => Wrk;
  timestamp: () => float;
  decodeUTF8: (utf8: ArrayBuffer) => string;
  encodeUTF8: (str: string) => Uint8Array;
  onException: () => void;
  base64Decode: (base64: string) => Uint8Array;
  fs: () => FileSystem;
  sys: () => System;
  crypto: () => Crypto;
  fetch: (url: URL) => Promise<Uint8Array>;
}

export interface Memory {
  buffer: ArrayBuffer;
}

interface Exported {
  SKIP_throw_EndOfFile: () => void;
  SKIP_String_byteSize: (strPtr: ptr) => int;
  SKIP_Obstack_alloc: (size: int) => ptr;
  SKIP_new_Obstack: () => ptr;
  SKIP_destroy_Obstack: (pos: ptr) => void;
  sk_string_create: (addr: ptr, size: int) => ptr;
  SKIP_createByteArray: (size: int) => ptr;
  SKIP_createFloatArray: (size: int) => ptr;
  SKIP_createUInt32Array: (size: int) => ptr;
  SKIP_getArraySize: (skArray: ptr) => int;
  SKIP_call0: (fnc: ptr) => ptr;
  SKIP_skfs_init: (size: int) => void;
  SKIP_initializeSkip: () => void;
  SKIP_skfs_end_of_init: () => void;
  SKIP_callWithException: (fnc: ptr, exc: int) => ptr;
  SKIP_getExceptionId: (exn: ptr) => ptr;
  SKIP_getExceptionMessage: (skExc: ptr) => ptr;
  SKIP_get_persistent_size: () => int;
  SKIP_get_version: () => number;
  skip_main: () => void;
  memory: Memory;
  __heap_base: any;
}

export interface WasmSupplier {
  completeWasm: (wasm: object, utils: Utils) => void;
}

function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export class Utils {
  private exports: Exported;
  private env: Environment;
  private state: State;
  private states: Map<string, any>;

  args: Array<string>;
  private current_stdin: number;
  private stdin: Uint8Array;
  private stdout: Array<string>;
  private stderr: Array<string>;
  private stddebug: Array<string>;
  private mainFn?: string;
  private exception?: Error;
  private stacks: Map<ptr, string>;

  exit = (code: int) => {
    let message =
      code != 0 && this.stderr.length > 0 ? this.stderr.join("") : undefined;
    throw new SkRuntimeExit(code, message);
  };

  constructor(exports: WebAssembly.Exports, env: Environment, mainFn?: string) {
    this.stacks = new Map();
    this.states = new Map();
    this.args = new Array();
    this.current_stdin = 0;
    this.stdin = utf8Encode("");
    this.stdout = new Array();
    this.stderr = new Array();
    this.stddebug = new Array();
    this.exports = exports as any as Exported;
    this.env = env;
    this.state = new State();
    this.mainFn = mainFn;
  }
  log = (str: string, kind?: Stream, newLine: boolean = false) => {
    kind = kind ? kind : Stream.OUT;
    str += newLine ? "\n" : "";
    if (kind == Stream.DEBUG) {
      this.stddebug.push(str);
    } else if (kind == Stream.ERR) {
      this.stderr.push(str);
    } else {
      this.stdout.push(str);
    }
  };
  sklog = (strPtr: ptr, kind?: Stream, newLine: boolean = false) => {
    let str = this.importString(strPtr);
    this.log(str, kind, newLine);
  };

  clearMainEnvironment = (
    new_args: Array<string> = [],
    new_stdin: string = "",
  ) => {
    this.args = [this.mainFn ?? "main"].concat(new_args);
    this.exception = undefined;
    this.stacks = new Map();
    this.current_stdin = 0;
    this.stdin = utf8Encode(new_stdin);
    this.stdout = new Array();
    this.stderr = new Array();
    this.stddebug = new Array();
  };

  runCheckError = <T>(fn: () => T) => {
    this.clearMainEnvironment();
    let res = fn();
    if (this.stddebug.length > 0) {
      console.log(this.stddebug.join(""));
    }
    if (this.stderr.length > 0) {
      let error = new Error(this.stderr.join(""));
      (error as any).cause = this.exception;
      throw error;
    }
    return res;
  };

  main = (new_args: Array<string>, new_stdin: string) => {
    let exitCode = 0;
    this.clearMainEnvironment(new_args, new_stdin);
    try {
      if (!this.mainFn) {
        this.exports.skip_main();
      } else {
        //@ts-ignore
        this.exports[this.mainFn]();
      }
    } catch (exn) {
      if (exn instanceof SkRuntimeExit) {
        exitCode = exn.code;
      } else {
        if (this.exception && this.exception != exn)
          (exn as any).cause = this.exception;
        throw exn;
      }
    }
    if (this.stddebug.length > 0) {
      console.log(this.stddebug.join(""));
    }
    if (exitCode != 0 || this.stderr.length > 0) {
      let message = this.stderr.length > 0 ? this.stderr.join("") : undefined;
      let tmp = "";
      let lines: string[] = [];
      message?.split("\n").forEach((line) => {
        const matches = [...line.matchAll(/external:([0-9]+)/g)].sort(
          (v1: string[], v2: string[]) => {
            const i1 = parseInt(v1[1]);
            const i2 = parseInt(v2[1]);
            if (i2 < i1) {
              return 1;
            }
            if (i2 > i1) {
              return -1;
            }
            return 0;
          },
        );
        if (matches.length > 0) {
          matches.forEach((match) => {
            line = line.replace(match[0], "");
          });
          tmp = line;
        } else {
          lines.push(tmp + line);
          tmp = "";
        }
      });
      if (tmp != "") {
        lines.push(tmp);
      }
      message = lines.join("\n");
      let error = new SkRuntimeExit(exitCode, message?.trim());
      (error as any).cause = this.exception;
      throw error;
    }
    return this.stdout.join("");
  };

  importOptString = (strPtr: ptr) => {
    if (strPtr > 0) {
      return this.importString(strPtr);
    }
    return null;
  };
  importString = (strPtr: ptr) => {
    let size = this.exports.SKIP_String_byteSize(strPtr);
    let utf8 = new Uint8Array(this.exports.memory.buffer, strPtr, size);
    return this.env.decodeUTF8(utf8);
  };
  exportString: (s: string) => ptr = (s: string) => {
    var data = new Uint8Array(this.exports.memory.buffer);
    // @ts-ignore
    var i = 0,
      addr = this.exports.SKIP_Obstack_alloc(s.length * 4);
    for (var ci = 0; ci != s.length; ci++) {
      var c = s.charCodeAt(ci);
      if (c < 128) {
        data[addr + i++] = c;
        continue;
      }
      if (c < 2048) {
        data[addr + i++] = (c >> 6) | 192;
      } else {
        if (c > 0xd7ff && c < 0xdc00) {
          if (++ci >= s.length)
            throw new Error("UTF-8 encode: incomplete surrogate pair");
          var c2 = s.charCodeAt(ci);
          if (c2 < 0xdc00 || c2 > 0xdfff)
            throw new Error(
              "UTF-8 encode: second surrogate character 0x" +
                c2.toString(16) +
                " at index " +
                ci +
                " out of range",
            );
          c = 0x10000 + ((c & 0x03ff) << 10) + (c2 & 0x03ff);
          data[addr + i++] = (c >> 18) | 240;
          data[addr + i++] = ((c >> 12) & 63) | 128;
        } else data[addr + i++] = (c >> 12) | 224;
        data[addr + i++] = ((c >> 6) & 63) | 128;
      }
      data[addr + i++] = (c & 63) | 128;
    }
    return this.exports.sk_string_create(addr, i);
  };
  importBytes = (skArray: ptr, sizeof: int = 1) => {
    let size = this.exports.SKIP_getArraySize(skArray) * sizeof;
    let skData = new Uint8Array(this.exports.memory.buffer, skArray, size);
    let copy = new Uint8Array(size);
    copy.set(skData);
    return copy;
  };
  importBytes2 = (skBytes: ptr, size: int = 1) => {
    let skData = new Uint8Array(this.exports.memory.buffer, skBytes, size);
    let copy = new Uint8Array(size);
    copy.set(skData);
    return copy;
  };
  exportBytes = (view: Uint8Array) => {
    let skArray = this.exports.SKIP_createByteArray(view.byteLength);
    let data = new Uint8Array(
      this.exports.memory.buffer,
      skArray,
      view.byteLength,
    );
    data.set(view);
    return skArray;
  };
  exportBytes2 = (view: Uint8Array, skBytes: ptr) => {
    let data = new Uint8Array(
      this.exports.memory.buffer,
      skBytes,
      view.byteLength,
    );
    data.set(view);
  };
  importUInt32s = (skArray: ptr) => {
    let size = this.exports.SKIP_getArraySize(skArray);
    let skData = new Uint32Array(this.exports.memory.buffer, skArray, size);
    let copy = new Uint32Array(size);
    copy.set(skData);
    return copy;
  };
  exportUInt32s(array: Uint32Array) {
    let skArray = this.exports.SKIP_createUInt32Array(array.length);
    let skData = new Uint32Array(
      this.exports.memory.buffer,
      skArray,
      array.length,
    );
    skData.set(array);
    return skArray;
  }
  importFloats = (skArray: ptr) => {
    let size = this.exports.SKIP_getArraySize(skArray);
    let skData = new Float64Array(this.exports.memory.buffer, skArray, size);
    let copy = new Float64Array(size);
    copy.set(skData);
    return copy;
  };
  exportFloats(array: Float64Array) {
    let skArray = this.exports.SKIP_createFloatArray(array.length);
    let skData = new Float64Array(
      this.exports.memory.buffer,
      skArray,
      array.length,
    );
    skData.set(array);
    return skArray;
  }
  call = (fnId: ptr) => {
    return this.exports.SKIP_call0(fnId);
  };
  callWithException = (fnId: ptr, exception: Exception | null) => {
    return this.exports.SKIP_callWithException(
      fnId,
      exception ? exception.id : 0,
    );
  };
  getBytesFromBuffer = (dataPtr: ptr, length: int) => {
    return new Uint8ClampedArray(this.exports.memory.buffer, dataPtr, length);
  };
  init = () => {
    let heapBase = this.exports.__heap_base.valueOf();
    let size = this.exports.memory.buffer.byteLength - heapBase;
    this.exports.SKIP_skfs_init(size);
    this.exports.SKIP_initializeSkip();
    this.exports.SKIP_skfs_end_of_init();
  };
  etry = (f: ptr, exn_handler: ptr) => {
    let err: Error | null = null;
    try {
      return this.call(f);
    } catch (exn: any) {
      if (this.exception && this.exception != exn) exn.cause = this.exception;
      err = exn as Error;
      this.exception = err;
      let exception: Exception | null = null;
      if (!(err instanceof SkError)) {
        exception = new Exception(err, this.state);
      }
      return this.callWithException(exn_handler, exception);
    } finally {
      if (this.exception == err) {
        this.exception = undefined;
      }
    }
  };
  ethrow = (skExc: ptr, rethrow: boolean) => {
    if (this.env && this.env.onException) this.env.onException();
    if (rethrow && this.exception) {
      throw this.exception;
    } else {
      let skMessage =
        skExc != null && skExc != 0
          ? this.exports.SKIP_getExceptionMessage(skExc)
          : null;
      let message =
        skMessage != null && skMessage != 0
          ? this.importString(skMessage)
          : "SKFS Internal error";
      let lines = message.split("\n");
      if (lines[0].startsWith("external:")) {
        let external = lines.shift()!;
        message = lines.join("\n");
        let id = parseInt(external.substring(9));
        if (this.state.exceptions.has(id)) {
          throw this.state.exceptions.get(id)!.err;
        } else if (message.trim() == "") {
          message = "SKFS Internal error";
        }
      }
      const err = new SkError(message);
      if (err.stack) this.stacks.set(skExc, err.stack);
      throw err;
    }
  };
  replace_exn(oldex: ptr, newex: ptr) {
    const stack = this.stacks.get(oldex);
    if (stack) {
      this.stacks.delete(oldex);
      this.stacks.set(newex, stack);
    }
  }
  deleteException = (exc: int) => {
    this.state.exceptions.delete(exc);
  };

  getExceptionMessage = (exc: int) => {
    if (this.state.exceptions.has(exc)) {
      return this.state.exceptions.get(exc)!.err.message;
    } else {
      return "Unknown";
    }
  };

  getExceptionStack = (exc: int) => {
    if (this.state.exceptions.has(exc)) {
      return this.state.exceptions.get(exc)!.err.stack ?? "";
    } else {
      return "";
    }
  };

  getErrorObject: (skExc: ptr) => ErrorObject = (skExc: ptr) => {
    let skMessage =
      skExc != null && skExc != 0
        ? this.exports.SKIP_getExceptionMessage(skExc)
        : null;
    let message =
      skMessage != null && skMessage != 0
        ? this.importString(skMessage)
        : "SKFS Internal error";
    let errStack = this.stacks.get(skExc);
    let lines = message.split("\n");
    if (lines[0].startsWith("external:")) {
      let external = lines.shift()!;
      message = lines.join("\n");
      let id = parseInt(external.substring(9));
      if (this.state.exceptions.has(id)) {
        const exception = this.state.exceptions.get(id);
        if (exception) {
          message = exception.err.message;
          errStack = exception.err.stack;
        } else {
          message = "Unknown error";
        }
      } else if (message.trim() == "") {
        message = "SKFS Internal error";
      }
    }
    const toObject: (error: Error) => ErrorObject = (error?: Error) => {
      const errcause = (error as any).cause;
      const errstack = (error as any).stack?.split("\n") as string[];
      if (errstack) {
        return errcause
          ? { message, cause: errcause, stack: errstack }
          : { message, stack: errstack };
      } else {
        return errcause ? { message, cause: errcause } : { message };
      }
    };
    if (errStack) {
      const stack: string[] = errStack.split("\n") as string[];
      return this.exception
        ? { message, cause: toObject(this.exception), stack }
        : { message, stack };
    } else {
      return this.exception
        ? { message, cause: toObject(this.exception) }
        : { message };
    }
  };

  getPersistentSize = () => this.exports.SKIP_get_persistent_size();
  getVersion = () => this.exports.SKIP_get_version();
  getMemoryBuffer = () => this.exports.memory.buffer;

  readStdInLine = () => {
    let lineBuffer = new Array<int>();
    const endOfLine = 10;
    if (this.current_stdin >= this.stdin.length) {
      this.exports.SKIP_throw_EndOfFile();
    }
    while (this.stdin[this.current_stdin] !== endOfLine) {
      if (this.current_stdin >= this.stdin.length) {
        if (lineBuffer.length == 0) {
          this.exports.SKIP_throw_EndOfFile();
        } else {
          return lineBuffer;
        }
      }
      lineBuffer.push(this.stdin[this.current_stdin]);
      this.current_stdin++;
    }
    this.current_stdin++;
    return lineBuffer;
  };

  readStdInToEnd = () => {
    let lineBuffer = new Array<int>();
    while (this.current_stdin < this.stdin.length) {
      lineBuffer.push(this.stdin[this.current_stdin]);
      this.current_stdin++;
    }
    return lineBuffer;
  };

  runWithGc = <T>(fn: () => T) => {
    let obsPos = this.exports.SKIP_new_Obstack();
    try {
      let res = fn();
      this.exports.SKIP_destroy_Obstack(obsPos);
      return res;
    } catch (ex) {
      this.exports.SKIP_destroy_Obstack(obsPos);
      throw ex;
    }
  };

  getState<T>(name: string, create: () => T): T {
    let state = this.states.get(name);
    if (state == undefined) {
      state = create();
      this.states.set(name, state);
    }
    return state;
  }
}

export interface Links {
  complete: (utils: Utils, exports: object) => void;
}

export interface ToWasmManager {
  prepare: (wasm: object) => Links | null;
}

export type ModuleInit = (e: Environment) => Promise<ToWasmManager>;
export type EnvInit = (e: Environment) => void;

enum I18N {
  RAW,
  LOCALE,
  FORMAT,
}

export interface Text {
  toJSON: () => object;
}

export class Raw implements Text {
  text: string;

  constructor(text: string, category?: string) {
    this.text = text;
  }

  toJSON: () => object = () => {
    return {
      type: "text",
      fields: {
        type: I18N.RAW,
        value: this.text,
      },
    };
  };
}

export class Locale implements Text {
  text: string;
  category: Opt<string>;

  constructor(text: string, category?: string) {
    this.text = text;
    this.category = category ? category : null;
  }

  toJSON: () => object = () => {
    return {
      type: "text",
      fields: {
        type: I18N.LOCALE,
        value: this.text,
        category: this.category,
      },
    };
  };
}

export const l = (text: string, category?: string) => {
  return new Locale(text, category);
};

export const f = (format: Text | string, parameters: Array<Text | string>) => {
  return new Format(format, parameters);
};

export const check: (value: Text | string) => Text = (value: Text | string) => {
  if (value instanceof Text) {
    return value as Text;
  } else {
    return new Raw(value as string);
  }
};

export class Format implements Text {
  format: Text | string;
  parameters: Array<Text | string>;

  constructor(format: Text | string, parameters: Array<Text | string>) {
    this.format = format;
    this.parameters = parameters;
  }

  toJSON: () => object = () => {
    return {
      type: "text",
      fields: {
        type: I18N.FORMAT,
        pattern: check(this.format),
        parameters: this.parameters.map(check),
      },
    };
  };
}

export function resolve(path: string) {
  let elements = import.meta.url.split("/");
  elements.pop();
  let pelems = path.split("/");
  pelems.forEach((e) => {
    if (e == "..") {
      if (elements.length == 1) {
        throw new Error("Invalid path: " + path);
      } else {
        elements.pop();
      }
    } else if (e != ".") {
      elements.push(e);
    }
  });
  return elements.join("/");
}

export function trimEndChar(str: string, ch: string) {
  var end = str.length;
  while (end > 0 && str[end - 1] === ch) --end;
  return end < str.length ? str.substring(0, end) : str;
}

export function humanSize(bytes: int) {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  let u = -1;
  const r = 10 ** 1;
  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return bytes.toFixed(1) + " " + units[u];
}

export function loadWasm(
  buffer: ArrayBuffer,
  managers: Array<ToWasmManager>,
  environment: Environment,
  main?: string,
) {
  let wasm = {};
  let links = managers.map((manager) => manager.prepare(wasm));
  return WebAssembly.instantiate(buffer, { env: wasm }).then((result) => {
    let instance = result.instance;
    let exports = instance.exports as any;
    let utils = new Utils(instance.exports, environment, main);
    utils.init();
    links.forEach((link) => {
      if (link) {
        link.complete(utils, exports);
      }
    });
    return { environment: environment, main: utils.main };
  });
}

async function start(
  modules: ModuleInit[],
  buffer: Uint8Array,
  environment: Environment,
  main?: string,
) {
  let promises = modules.map((fn) => fn(environment));
  let cs = await Promise.all(promises);
  let ms = cs.filter((c) => c != null);
  return await loadWasm(buffer, ms, environment, main);
}

export function isNode() {
  return typeof process !== "undefined" && process.release.name == "node";
}

export async function loadEnv(extensions: EnvInit[], envVals?: Array<string>) {
  // hack: this way of importing is deliberate so that web bundlers
  // don't follow the node dynamic import
  const nodeImport = "./sk_node.mjs";
  const environment = await (isNode()
    ? import(/* @vite-ignore */ nodeImport)
    : //@ts-ignore
      import("./sk_browser.mjs"));
  let env = environment.environment(envVals) as Environment;
  if (extensions) {
    extensions.map((fn) => fn(env));
  }
  return env;
}

export async function run(
  wasm: URL,
  modules: ModuleInit[],
  extensions: EnvInit[],
  main?: string,
  getWasmSource?: () => Promise<Uint8Array>,
) {
  let env = await loadEnv(extensions);
  let buffer: Uint8Array;
  if (getWasmSource) {
    buffer = await getWasmSource();
  } else {
    buffer = await env.fetch(wasm);
  }
  return await start(modules, buffer, env, main);
}

export async function runUrl(
  getUrl: () => Promise<URL>,
  modules: ModuleInit[],
  extensions: EnvInit[],
  main?: string,
  getWasmSource?: () => Promise<Uint8Array>,
) {
  let env = await loadEnv(extensions);
  let buffer: Uint8Array;
  if (getWasmSource) {
    buffer = await getWasmSource();
  } else {
    const url = await getUrl();
    buffer = await env.fetch(url);
  }
  return await start(modules, buffer, env, main);
}
