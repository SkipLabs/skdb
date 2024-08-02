// prettier-ignore
import type { int, ptr, float, Links, Utils, ToWasmManager, Environment, Opt, Shared, } from "#std/sk_types.js";

export enum Type {
  Undefined,
  Null,
  Int,
  Float,
  Boolean,
  String,
  Array,
  Object,
}

interface WasmAccess {
  SKIP_SKJSON_typeOf: (json: ptr) => int;
  SKIP_SKJSON_asInt: (json: ptr) => int;
  SKIP_SKJSON_asFloat: (json: ptr) => float;
  SKIP_SKJSON_asBoolean: (json: ptr) => boolean;
  SKIP_SKJSON_asString: (json: ptr) => ptr;
  SKIP_SKJSON_asArray: (json: ptr) => ptr;
  SKIP_SKJSON_asObject: (json: ptr) => ptr;

  SKIP_SKJSON_fieldAt: (json: ptr, idx: int) => ptr;
  SKIP_SKJSON_get: (json: ptr, idx: int) => ptr;
  SKIP_SKJSON_at: (json: ptr, idx: int) => ptr;

  SKIP_SKJSON_objectSize: (json: ptr) => int;
  SKIP_SKJSON_arraySize: (json: ptr) => int;
}

interface ToWasm {
  SKIP_SKJSON_console: (json: ptr) => void;
  SKIP_SKJSON_error: (json: ptr) => void;
}

class WasmHandle {
  utils: Utils;
  pointer: ptr;
  access: WasmAccess;
  fields?: Map<string, int>;

  constructor(utils: Utils, pointer: ptr, access: WasmAccess) {
    this.utils = utils;
    this.pointer = pointer;
    this.access = access;
  }

  objectFields() {
    if (!this.fields) {
      this.fields = new Map();
      const size = this.access.SKIP_SKJSON_objectSize(this.pointer);
      for (let i = 0; i < size; i++) {
        this.fields.set(
          this.utils.importString(
            this.access.SKIP_SKJSON_fieldAt(this.pointer, i),
          ),
          i,
        );
      }
    }
    return this.fields;
  }

  derive(pointer: ptr) {
    return new WasmHandle(this.utils, pointer, this.access);
  }
}

function getValue(hdl: WasmHandle): any {
  const type = hdl.access.SKIP_SKJSON_typeOf(hdl.pointer);
  switch (type) {
    case Type.Null:
      return null;
    case Type.Int:
      return hdl.access.SKIP_SKJSON_asInt(hdl.pointer);
    case Type.Float:
      return hdl.access.SKIP_SKJSON_asFloat(hdl.pointer);
    case Type.Boolean:
      return hdl.access.SKIP_SKJSON_asBoolean(hdl.pointer);
    case Type.String:
      return hdl.utils.importString(
        hdl.access.SKIP_SKJSON_asString(hdl.pointer),
      );
    case Type.Array:
      const aPtr = hdl.access.SKIP_SKJSON_asArray(hdl.pointer);
      return new Proxy(hdl.derive(aPtr), reactiveArray);
    case Type.Object:
      const oPtr = hdl.access.SKIP_SKJSON_asObject(hdl.pointer);
      return new Proxy(hdl.derive(oPtr), reactiveObject);
    case Type.Undefined:
    default:
      return undefined;
  }
}

function getValueAt(hdl: WasmHandle, idx: int, array: boolean = false): any {
  const skval = array
    ? hdl.access.SKIP_SKJSON_at(hdl.pointer, idx)
    : hdl.access.SKIP_SKJSON_get(hdl.pointer, idx);
  const type = hdl.access.SKIP_SKJSON_typeOf(skval);
  switch (type) {
    case Type.Null:
      return null;
    case Type.Int:
      return hdl.access.SKIP_SKJSON_asInt(skval);
    case Type.Float:
      return hdl.access.SKIP_SKJSON_asFloat(skval);
    case Type.Boolean:
      return hdl.access.SKIP_SKJSON_asBoolean(skval) ? true : false;
    case Type.String:
      return hdl.utils.importString(hdl.access.SKIP_SKJSON_asString(skval));
    case Type.Array:
      const aPtr = hdl.access.SKIP_SKJSON_asArray(skval);
      return new Proxy(hdl.derive(aPtr), reactiveArray);
    case Type.Object:
      const oPtr = hdl.access.SKIP_SKJSON_asObject(skval);
      return new Proxy(hdl.derive(oPtr), reactiveObject);
    case Type.Undefined:
    default:
      return undefined;
  }
}

export const reactiveObject = {
  get(hdl: WasmHandle, prop: string, self: any): any {
    if (prop === "__isObjectProxy") return true;
    if (prop === "__pointer") return hdl.pointer;
    if (prop === "clone") return () => clone(self);
    const fields = hdl.objectFields();
    if (prop === "toJSON")
      return () => {
        const res: any = {};
        for (const key of fields) {
          res[key[0]] = getValueAt(hdl, key[1], false);
        }
        return res;
      };
    if (prop === "keys") return fields.keys();
    const idx = fields.get(prop);
    if (idx === undefined) return undefined;
    return getValueAt(hdl, idx, false);
  },
  has(hdl: WasmHandle, prop: string): boolean {
    if (prop === "__isObjectProxy") return true;
    if (prop === "__pointer") return true;
    if (prop === "clone") return true;
    if (prop === "keys") return true;
    if (prop === "toJSON") return true;
    const fields = hdl.objectFields();
    return fields.has(prop);
  },
  ownKeys(hdl: WasmHandle) {
    return Array.from(hdl.objectFields().keys());
  },
  getOwnPropertyDescriptor(hdl: WasmHandle, prop: string) {
    const fields = hdl.objectFields();
    const idx = fields.get(prop);
    if (idx === undefined) return undefined;
    const value = getValueAt(hdl, idx, false);
    return {
      configurable: true,
      enumerable: true,
      writable: false,
      value,
    };
  },
};

export const reactiveArray = {
  get(hdl: WasmHandle, prop: string, self: any): any {
    if (typeof prop === "symbol") {
      return () => self.toJSON().values();
    } else {
      if (prop === "__isArrayProxy") return true;
      if (prop === "__pointer") return hdl.pointer;
      if (prop === "length")
        return hdl.access.SKIP_SKJSON_arraySize(hdl.pointer);
      if (prop === "clone") return () => clone(self);
      if (prop === "toJSON")
        return () => {
          const res: any[] = [];
          const length: number = self.length;
          for (let i = 0; i < length; i++) {
            res.push(getValueAt(hdl, i, true));
          }
          return res;
        };
      if (prop === "forEach")
        return <T>(
          callbackfn: (value: T, index: number, array: T[]) => void,
          thisArg?: any,
        ) => {
          self.toJSON().forEach(callbackfn, thisArg);
        };
      const v = parseInt(prop);
      if (!isNaN(v)) return getValueAt(hdl, v, true);
      return undefined;
    }
  },
  has(hdl: WasmHandle, prop: string): boolean {
    if (prop === "__isArrayProxy") return true;
    if (prop === "__pointer") return true;
    if (prop === "length") return true;
    if (prop === "clone") return true;
    if (prop === "toJSON") return true;
    return false;
  },
  ownKeys(hdl: WasmHandle) {
    const l = hdl.access.SKIP_SKJSON_arraySize(hdl.pointer);
    const res = Array.from(Array(l).keys()).map((v) => "" + v);
    return res;
  },
  getOwnPropertyDescriptor(hdl: WasmHandle, prop: string) {
    const v = parseInt(prop);
    if (isNaN(v)) return undefined;
    const value = getValueAt(hdl, v, true);
    return {
      configurable: true,
      enumerable: true,
      writable: false,
      value,
    };
  },
};

function clone<T>(value: T): T {
  const aValue = value as any;
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map(clone) as T;
    } else if (aValue.__isArrayProxy) {
      const res: any[] = [];
      const length: number = aValue.length;
      for (let i = 0; i < length; i++) {
        res.push(clone(aValue[i]));
      }
      return res as T;
    } else if (aValue.__isObjectProxy) {
      const res: any = {};
      for (const key of aValue.keys) {
        res[key] = clone(aValue[key]);
      }
      return res as T;
    } else {
      const res: any = {};
      const keys = Object.keys(aValue);
      for (const key of keys) {
        res[key] = clone(aValue[key]);
      }
      return res as T;
    }
  } else {
    return value;
  }
}

interface FromWasm extends WasmAccess {
  SKIP_SKJSON_startCJObject: () => ptr;
  SKIP_SKJSON_addToCJObject: (obj: ptr, name: ptr, value: ptr) => void;
  SKIP_SKJSON_endCJObject: (obj: ptr) => ptr;
  SKIP_SKJSON_startCJArray: () => ptr;
  SKIP_SKJSON_addToCJArray: (arr: ptr, value: ptr) => void;
  SKIP_SKJSON_endCJArray: (arr: ptr) => ptr;
  SKIP_SKJSON_createCJNull: () => ptr;
  SKIP_SKJSON_createCJInt: (v: int) => ptr;
  SKIP_SKJSON_createCJFloat: (v: float) => ptr;
  SKIP_SKJSON_createCJString: (str: ptr) => ptr;
  SKIP_SKJSON_createCJBool: (v: boolean) => ptr;
}

class Mapping {
  private nextID: number = 0;
  private objects: any[] = [];
  private freeIDs: int[] = [];

  register(v: any) {
    const freeID = this.freeIDs.pop();
    const id = freeID === undefined ? this.nextID++ : freeID;
    this.objects[id] = v;
    return id;
  }

  get(id: int) {
    return this.objects[id];
  }

  delete(id: int) {
    const current = this.objects[id];
    this.objects[id] = null;
    this.freeIDs.push(id);
    return current;
  }
}

export interface SKJSON extends Shared {
  importJSON: (value: ptr, copy?: boolean) => any;
  exportJSON: <T>(v: T) => ptr;
  importOptJSON: (value: Opt<ptr>, copy?: boolean) => any;
  importString: (v: ptr) => string;
  exportString: (v: string) => ptr;
  runWithGC: <T>(fn: () => T) => T;
}

class SKJSONShared implements SKJSON {
  getName = () => "SKJSON";

  importJSON: (value: ptr, copy?: boolean) => any;
  exportJSON: <T>(v: T) => ptr;
  importString: (v: ptr) => string;
  exportString: (v: string) => ptr;
  runWithGC: <T>(fn: () => T) => T;

  constructor(
    importJSON: (value: ptr, copy?: boolean) => any,
    exportJSON: <T>(v: T) => ptr,
    importString: (v: ptr) => string,
    exportString: (v: string) => ptr,
    runWithGC: <T>(fn: () => T) => T,
  ) {
    this.importJSON = importJSON;
    this.exportJSON = exportJSON;
    this.importString = importString;
    this.exportString = exportString;
    this.runWithGC = runWithGC;
  }

  importOptJSON(value: Opt<ptr>, copy?: boolean) {
    if (value == null) {
      return null;
    }
    return this.importJSON(value, copy);
  }
}

class LinksImpl implements Links {
  env: Environment;
  mapping: Mapping;

  SKJSON_console!: (json: ptr) => void;
  SKJSON_error!: (json: ptr) => void;

  constructor(env: Environment) {
    this.env = env;
    this.mapping = new Mapping();
  }

  complete = (utils: Utils, exports: object) => {
    const fromWasm = exports as FromWasm;
    const importJSON = (valuePtr: ptr, copy?: boolean) => {
      const value = getValue(new WasmHandle(utils, valuePtr, fromWasm));
      return copy ? (value !== null ? clone(value) : value) : value;
    };

    const exportJSON = (value: any) => {
      let type = typeof value;
      if (value === null || value === undefined) {
        return fromWasm.SKIP_SKJSON_createCJNull();
      } else if (type == "number") {
        if (value === Math.trunc(value)) {
          return fromWasm.SKIP_SKJSON_createCJInt(value);
        } else {
          return fromWasm.SKIP_SKJSON_createCJFloat(value);
        }
      } else if (type == "boolean") {
        return fromWasm.SKIP_SKJSON_createCJBool(value);
      } else if (type == "string") {
        return fromWasm.SKIP_SKJSON_createCJString(utils.exportString(value));
      } else if (Array.isArray(value)) {
        let arr = fromWasm.SKIP_SKJSON_startCJArray();
        value.forEach((v) =>
          fromWasm.SKIP_SKJSON_addToCJArray(arr, exportJSON(v)),
        );
        return fromWasm.SKIP_SKJSON_endCJArray(arr);
      } else if (type == "object") {
        if (value.__isObjectProxy || value.__isArrayProxy) {
          return value.__pointer as number;
        } else {
          let obj = fromWasm.SKIP_SKJSON_startCJObject();
          for (let key of Object.keys(value)) {
            fromWasm.SKIP_SKJSON_addToCJObject(
              obj,
              utils.exportString(key),
              exportJSON(value[key]),
            );
          }
          return fromWasm.SKIP_SKJSON_endCJObject(obj);
        }
      } else {
        console.error(value);
        console.error(new Error());
        throw new Error("'" + type + "' cannot be exported to wasm.");
      }
    };
    this.SKJSON_console = (json: ptr) => {
      console.log(clone(importJSON(json)));
    };
    this.SKJSON_error = (json: ptr) => {
      console.error(clone(importJSON(json)));
    };

    this.env.shared.set(
      "SKJSON",
      new SKJSONShared(
        importJSON,
        exportJSON,
        utils.importString,
        utils.exportString,
        utils.runWithGc,
      ),
    );
  };
}

class Manager implements ToWasmManager {
  env: Environment;
  constructor(env: Environment) {
    this.env = env;
  }

  prepare = (wasm: object) => {
    const toWasm = wasm as ToWasm;
    const link = new LinksImpl(this.env);
    toWasm.SKIP_SKJSON_console = (value: ptr) => link.SKJSON_console(value);
    toWasm.SKIP_SKJSON_error = (value: ptr) => link.SKJSON_error(value);
    return link;
  };
}

/** @sk init */
export function init(env: Environment) {
  return Promise.resolve(new Manager(env));
}
