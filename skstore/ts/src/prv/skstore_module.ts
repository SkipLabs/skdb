// prettier-ignore
import type { int, ptr, Links, Utils, ToWasmManager, Environment, Opt, Metadata } from "#std/sk_types.js";
// prettier-ignore
import type { SKDBShared } from "#skdb/skdb_types.js";
import type { SKJSON } from "#skjson/skjson.js";
import type {
  Accumulator,
  NonEmptyIterator,
  Mapper,
  EntryMapper,
  Mapping,
  Result,
  AValue,
  LHandle,
  TJSON,
  JSONObject,
  MirrorSchema,
} from "../skstore_api.js";

import type { Handles, Context, FromWasm } from "./skstore_types.js";
import { LSelfImpl, SKStoreFactoryImpl } from "./skstore_impl.js";

class HandlesImpl implements Handles {
  private nextID: number = 1;
  private objects: any[] = [];
  private freeIDs: int[] = [];
  private env: Environment;

  constructor(env: Environment) {
    this.env = env;
  }

  register(v: JSON) {
    const freeID = this.freeIDs.pop();
    const id = freeID === undefined ? this.nextID++ : freeID;
    this.objects[id] = v;
    return id;
  }

  get(id: int) {
    return this.objects[id];
  }

  apply = (id: int, parameters: any[]) => {
    let fn = this.objects[id];
    return fn.apply(null, parameters);
  };

  delete(id: int) {
    const current = this.objects[id];
    this.objects[id] = null;
    this.freeIDs.push(id);
    return current;
  }

  name = (metadata: Metadata) => {
    return (
      "b64_" +
      this.env.base64Encode(JSON.stringify(metadata)).replaceAll("=", "")
    );
  };
}

export class ContextImpl implements Context {
  skjson: SKJSON;
  exports: FromWasm;
  handles: Handles;
  ref: Ref;
  private queryResult: () => JSONObject[];

  constructor(
    skjson: SKJSON,
    exports: FromWasm,
    handles: Handles,
    queryResult: () => JSONObject[],
    ref: Ref,
  ) {
    this.skjson = skjson;
    this.exports = exports;
    this.handles = handles;
    this.ref = ref;
    this.queryResult = queryResult;
  }

  noref() {
    return new ContextImpl(
      this.skjson,
      this.exports,
      this.handles,
      this.queryResult,
      new Ref(),
    );
  }

  lazy = <K extends TJSON, V extends TJSON>(
    metadata: Metadata,
    compute: (selfHdl: LHandle<K, V>, key: K) => Opt<V>,
  ) => {
    const name = this.handles.name(metadata);
    const lazyHdl = this.exports.SKIP_SKStore_lazy(
      this.pointer(),
      this.skjson.exportString(name),
      this.handles.register(compute),
    );
    return this.skjson.importString(lazyHdl);
  };

  asyncLazy = <K extends TJSON, V extends TJSON, P extends TJSON>(
    metadata: Metadata,
    get: (key: K) => P,
    call: (key: K, params: P) => Promise<V>,
  ) => {
    const name = this.handles.name(metadata);
    const lazyHdl = this.exports.SKIP_SKStore_asyncLazy(
      this.pointer(),
      this.skjson.exportString(name),
      this.handles.register(get),
      this.handles.register(call),
    );
    return this.skjson.importString(lazyHdl);
  };

  multimap = <
    K1 extends TJSON,
    V1 extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
  >(
    metadata: Metadata,
    mappings: Mapping<K1, V1, K2, V2>[],
  ) => {
    const name = this.handles.name(metadata);
    const skMappings = mappings.map((mapping) => [
      mapping.handle.getId(),
      this.handles.register(mapping.mapper),
    ]);
    const resHdlPtr = this.exports.SKIP_SKStore_multimap(
      this.pointer(),
      this.skjson.exportString(name),
      this.skjson.exportJSON(skMappings),
    );
    return this.skjson.importString(resHdlPtr);
  };

  multimapReduce = <
    K1 extends TJSON,
    V1 extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
    V3 extends TJSON,
  >(
    metadata: Metadata,
    mappings: Mapping<K1, V1, K2, V2>[],
    accumulator: Accumulator<V2, V3>,
  ) => {
    const name = this.handles.name(metadata);
    const skMappings = mappings.map((mapping) => [
      mapping.handle.getId(),
      this.handles.register(mapping.mapper),
    ]);
    const resHdlPtr = this.exports.SKIP_SKStore_multimapReduce(
      this.pointer(),
      this.skjson.exportString(name),
      this.skjson.exportJSON(skMappings),
      this.handles.register(accumulator),
      this.skjson.exportJSON(accumulator.default),
    );
    return this.skjson.importString(resHdlPtr);
  };

  get = <K, V>(eagerHdl: string, key: K) => {
    return this.skjson.importJSON(
      this.exports.SKIP_SKStore_get(
        this.pointer(),
        this.skjson.exportString(eagerHdl),
        this.skjson.exportJSON(key),
      ),
    ) as V;
  };

  getFromTable = <K, R>(table: string, key: K, index?: string) => {
    return this.skjson.importJSON(
      this.exports.SKIP_SKStore_getFromTable(
        this.pointer(),
        this.skjson.exportString(table),
        this.skjson.exportJSON(key),
        this.skjson.exportJSON(index ?? null),
      ),
    ) as R[];
  };

  maybeGet = <K, V>(eagerHdl: string, key: K) => {
    const res = this.exports.SKIP_SKStore_maybeGet(
      this.pointer(),
      this.skjson.exportString(eagerHdl),
      this.skjson.exportJSON(key),
    );
    return this.skjson.importJSON(res) as Opt<V>;
  };

  getLazy = <K, V>(lazyHdl: string, key: K) => {
    return this.skjson.importJSON(
      this.exports.SKIP_SKStore_getLazy(
        this.pointer(),
        this.skjson.exportString(lazyHdl),
        this.skjson.exportJSON(key),
      ),
    ) as V;
  };

  getSelf = <K, V>(lazyHdl: ptr, key: K) => {
    return this.skjson.importJSON(
      this.exports.SKIP_SKStore_getSelf(
        this.pointer(),
        lazyHdl,
        this.skjson.exportJSON(key),
      ),
    ) as V;
  };

  size = (eagerHdl: string) => {
    return this.exports.SKIP_SKStore_size(
      this.pointer(),
      this.skjson.exportString(eagerHdl),
    );
  };

  mapReduce = <
    K extends TJSON,
    V extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
    V3 extends TJSON,
  >(
    eagerHdl: string,
    metadata: Metadata,
    mapper: Mapper<K, V, K2, V2>,
    accumulator: Accumulator<V2, V3>,
  ) => {
    const name = this.handles.name(metadata);
    const resHdlPtr = this.exports.SKIP_SKStore_mapReduce(
      this.pointer(),
      this.skjson.exportString(eagerHdl),
      this.skjson.exportString(name),
      this.handles.register(mapper),
      this.handles.register(accumulator),
      this.skjson.exportJSON(accumulator.default),
    );
    return this.skjson.importString(resHdlPtr);
  };

  map = <K extends TJSON, V extends TJSON, K2 extends TJSON, V2 extends TJSON>(
    eagerHdl: string,
    metadata: Metadata,
    mapper: Mapper<K, V, K2, V2>,
  ) => {
    const name = this.handles.name(metadata);
    const computeFnId = this.handles.register(mapper);
    const pointer = this.pointer();
    const resHdlPtr = this.exports.SKIP_SKStore_map(
      pointer,
      this.skjson.exportString(eagerHdl),
      this.skjson.exportString(name),
      computeFnId,
    );
    return this.skjson.importString(resHdlPtr);
  };

  mapFromSkdb = <R extends TJSON, K2 extends TJSON, V2 extends TJSON>(
    table: string,
    metadata: Metadata,
    mapper: EntryMapper<R, K2, V2>,
  ) => {
    const name = this.handles.name(metadata);
    const computeFnId = this.handles.register(mapper);
    const eagerHdl = this.exports.SKIP_SKStore_fromSkdb(
      this.pointer(),
      this.skjson.exportString(table),
      this.skjson.exportString(name),
      computeFnId,
    );
    return this.skjson.importString(eagerHdl);
  };

  mapToSkdb = <R, K, V>(
    eagerHdl: string,
    table: string,
    convert: (key: K, it: NonEmptyIterator<V>) => R,
  ) => {
    const convertId = this.handles.register(convert);
    this.exports.SKIP_SKStore_toSkdb(
      this.pointer(),
      this.skjson.exportString(eagerHdl),
      this.skjson.exportString(table),
      convertId,
    );
  };

  jsonExtract(value: JSONObject, pattern: string): TJSON[] {
    return this.skjson.importJSON(
      this.exports.SKIP_SKStore_jsonExtract(
        this.skjson.exportJSON(value),
        this.skjson.exportString(pattern),
      ),
    );
  }

  private execQuery = (fn: () => number) => {
    if (this.ref.get() != null) {
      throw new Error(
        "insert cannot be called inside a SKStore function call.",
      );
    }
    const result = this.skjson.runWithGC(fn);
    if (result < 0) {
      throw this.handles.delete(-result);
    }
  };

  insert = <R extends TJSON[][]>(
    name: string,
    entries: R,
    update: boolean = false,
  ) => {
    this.execQuery(() => {
      return this.exports.SKIP_SKStore_insert(
        this.skjson.exportString(name),
        this.skjson.exportJSON(entries),
        update,
      );
    });
  };

  update = <R extends TJSON[]>(
    name: string,
    columns: string[],
    entry: R,
    updates: JSONObject,
  ) => {
    this.execQuery(() => {
      return this.exports.SKIP_SKStore_update(
        this.skjson.exportString(name),
        this.skjson.exportString(columns.join(",")),
        this.skjson.exportJSON(entry),
        this.skjson.exportJSON(updates),
      );
    });
  };

  createTables = (schemas: MirrorSchema[]) => {
    this.execQuery(() => {
      return this.exports.SKIP_SKStore_createTables(
        this.skjson.exportJSON(schemas),
      );
    });
  };

  updateWhere = (name: string, where: JSONObject, updates: JSONObject) => {
    this.execQuery(() => {
      return this.exports.SKIP_SKStore_updateWhere(
        this.skjson.exportString(name),
        this.skjson.exportJSON(where),
        this.skjson.exportJSON(updates),
      );
    });
  };

  select = (name: string, select: JSONObject, columns?: string[]) => {
    this.execQuery(() => {
      return this.exports.SKIP_SKStore_select(
        this.skjson.exportString(name),
        this.skjson.exportJSON(select),
        this.skjson.exportJSON(columns ?? []),
      );
    });
    return this.queryResult();
  };

  delete = <R extends TJSON[]>(name: string, columns: string[], entry: R) => {
    this.execQuery(() => {
      return this.exports.SKIP_SKStore_delete(
        this.skjson.exportString(name),
        this.skjson.exportString(columns.join(",")),
        this.skjson.exportJSON(entry),
      );
    });
  };

  deleteWhere = (name: string, where: JSONObject) => {
    this.execQuery(() => {
      return this.exports.SKIP_SKStore_deleteWhere(
        this.skjson.exportString(name),
        this.skjson.exportJSON(where),
      );
    });
  };

  private pointer = () => {
    return this.ref.get()!;
  };
}

class NonEmptyIteratorImpl<T> implements NonEmptyIterator<T> {
  private skjson: SKJSON;
  private exports: FromWasm;
  private pointer: ptr;

  constructor(skjson: SKJSON, exports: FromWasm, pointer: ptr) {
    this.skjson = skjson;
    this.exports = exports;
    this.pointer = pointer;
  }

  next: () => Opt<T> = () => {
    return this.skjson.importOptJSON(
      this.exports.SKIP_SKStore_iteratorNext(this.pointer),
    );
  };

  first: () => T = () => {
    return this.skjson.importJSON(
      this.exports.SKIP_SKStore_iteratorFirst(this.pointer),
    ) as T;
  };

  uniqueValue: () => Opt<T> = () => {
    const jsObj = this.skjson.importOptJSON(
      this.exports.SKIP_SKStore_iteratorUniqueValue(this.pointer),
    );
    return jsObj != null ? (jsObj as T) : null;
  };

  toArray: () => T[] = () => {
    const array: T[] = [];
    let value = this.next();
    while (value != null) {
      array.push(value);
      value = this.next();
    }
    return array;
  };
}

class WriterImpl<K, T> {
  private skjson: SKJSON;
  private exports: FromWasm;
  private pointer: ptr;

  constructor(skjson: SKJSON, exports: FromWasm, pointer: ptr) {
    this.skjson = skjson;
    this.exports = exports;
    this.pointer = pointer;
  }

  set = (key: K, value: T) => {
    this.exports.SKIP_SKStore_writerSet(
      this.pointer,
      this.skjson.exportJSON(key),
      this.skjson.exportJSON(value),
    );
  };
}

interface ToWasm {
  SKIP_SKStore_detachHandle(fn: int): void;
  // Context
  SKIP_SKStore_applyMapFun(
    fn: int,
    context: ptr,
    writer: ptr,
    key: ptr,
    it: ptr,
  ): void;
  SKIP_SKStore_applyMapTableFun(
    fn: int,
    context: ptr,
    writer: ptr,
    row: ptr,
    occ: int,
  ): void;
  SKIP_SKStore_applyConvertToRowFun(fn: int, key: ptr, it: ptr): ptr;
  SKIP_SKStore_init(context: ptr): void;
  SKIP_SKStore_applyLazyFun(fn: int, context: ptr, self: ptr, key: ptr): ptr;
  SKIP_SKStore_applyParamsFun(fn: int, context: ptr, key: ptr): ptr;
  SKIP_SKStore_applyLazyAsyncFun(
    fn: int,
    callId: ptr,
    name: ptr,
    key: ptr,
    param: ptr,
  ): void;

  // Accumulator
  SKIP_SKStore_applyAccumulate(fn: int, acc: ptr, value: ptr): ptr;
  SKIP_SKStore_applyDismiss(fn: int, acc: ptr, value: ptr): Opt<ptr>;
  // Utils
  SKIP_SKStore_getErrorHdl(exn: ptr): number;
}

class Ref {
  pointers: ptr[] = [];

  push(pointer: ptr) {
    this.pointers.push(pointer);
  }

  get() {
    if (this.pointers.length == 0) return null;
    return this.pointers[this.pointers.length - 1];
  }

  pop() {
    this.pointers.pop();
  }
}

class LinksImpl implements Links {
  env: Environment;
  handles: Handles;
  skjson?: SKJSON;

  detachHandle!: (fn: int) => void;
  applyMapFun!: (fn: int, context: ptr, writer: ptr, key: ptr, it: ptr) => void;
  applyMapTableFun!: (
    fn: int,
    context: ptr,
    writer: ptr,
    row: ptr,
    occ: int,
  ) => void;

  applyLazyFun!: (fn: int, context: ptr, self: ptr, key: ptr) => ptr;
  applyParamsFun!: (fn: int, context: ptr, key: ptr) => ptr;
  applyLazyAsyncFun!: (
    fn: int,
    callId: ptr,
    name: ptr,
    key: ptr,
    param: ptr,
  ) => void;
  init!: (context: ptr) => void;
  applyAccumulate!: (fn: int, acc: ptr, value: ptr) => ptr;
  applyDismiss!: (fn: int, acc: ptr, value: ptr) => Opt<ptr>;
  getErrorHdl!: (exn: ptr) => number;
  applyConvertToRowFun!: (fn: int, key: ptr, it: ptr) => ptr;

  private initFn!: () => void;

  constructor(env: Environment) {
    this.env = env;
    this.handles = new HandlesImpl(env);
  }

  complete = (utils: Utils, exports: object) => {
    const fromWasm = exports as FromWasm;
    const skjson = () => {
      if (this.skjson == undefined) {
        this.skjson = this.env.shared.get("SKJSON")! as SKJSON;
      }
      return this.skjson;
    };
    const ref = new Ref();
    this.applyMapFun = (fn: int, ctx: ptr, writer: ptr, key: ptr, it: ptr) => {
      ref.push(ctx);
      const jsu = skjson();
      const w = new WriterImpl(jsu, fromWasm, writer);
      const result = this.handles.apply(fn, [
        jsu.importJSON(key),
        new NonEmptyIteratorImpl(jsu, fromWasm, it),
      ]);
      for (const v of result) {
        const t = v as any;
        w.set(t[0], t[1]);
      }
      ref.pop();
    };
    this.applyMapTableFun = (
      fn: int,
      ctx: ptr,
      writer: ptr,
      row: ptr,
      occ: int,
    ) => {
      ref.push(ctx);
      const jsu = skjson();
      const w = new WriterImpl(jsu, fromWasm, writer);
      const result = this.handles.apply(fn, [jsu.importJSON(row), occ]);
      for (const v of result) {
        const t = v as any;
        w.set(t[0], t[1]);
      }
      ref.pop();
    };

    this.applyConvertToRowFun = (fn: int, key: ptr, it: ptr) => {
      const jsu = skjson();
      const res = this.handles.apply(fn, [
        jsu.importJSON(key),
        new NonEmptyIteratorImpl(jsu, fromWasm, it),
      ]);
      return jsu.exportJSON(res);
    };

    this.applyLazyAsyncFun = (
      fn: int,
      skcall: ptr,
      skname: ptr,
      skkey: ptr,
      skparams: ptr,
    ) => {
      const jsu = skjson();
      const callId = jsu.importString(skcall);
      const name = jsu.importString(skname);
      const key = jsu.importJSON(skkey, true);
      const params = jsu.importJSON(skparams, true);
      const promise = this.handles.apply<Promise<AValue<TJSON, TJSON>>>(fn, [
        key,
        params,
      ]);
      const register = (value: Result<TJSON, TJSON>) => {
        setTimeout(() => {
          const result = jsu.runWithGC(() => {
            return Math.trunc(
              fromWasm.SKIP_SKStore_asyncResult(
                jsu.exportString(callId),
                jsu.exportString(name),
                jsu.exportJSON(key),
                jsu.exportJSON(params),
                jsu.exportJSON(value),
              ),
            );
          });
          if (result < 0) {
            throw this.handles.delete(-result);
          }
        }, 0);
      };
      promise
        .then((value) => {
          if (value.payload !== null && value.payload !== undefined) {
            register(
              value.metadata !== null && value.metadata !== undefined
                ? {
                    status: "success",
                    payload: value.payload,
                    metadata: value.metadata,
                  }
                : {
                    status: "success",
                    payload: value.payload,
                  },
            );
          } else {
            register(
              value.metadata !== null && value.metadata !== undefined
                ? {
                    status: "unchanged",
                    metadata: value.metadata,
                  }
                : {
                    status: "unchanged",
                  },
            );
          }
        })
        .catch((reason: any) => {
          const msg =
            reason instanceof Error
              ? reason.message
              : typeof reason == "string"
                ? reason
                : JSON.stringify(reason);
          register({ status: "failure", error: msg });
        });
    };
    const queryResult = () => {
      return (this.env.shared.get("SKDB") as SKDBShared).queryResult();
    };
    this.applyLazyFun = (fn: int, ctx: ptr, hdl: ptr, key: ptr) => {
      ref.push(ctx);
      const jsu = skjson();
      const context = new ContextImpl(
        jsu,
        fromWasm,
        this.handles,
        queryResult,
        ref,
      );
      const res = jsu.exportJSON(
        this.handles.apply(fn, [
          new LSelfImpl(context, hdl),
          jsu.importJSON(key),
        ]),
      );
      ref.pop();
      return res;
    };

    this.applyParamsFun = (fn: int, ctx: ptr, key: ptr) => {
      ref.push(ctx);
      const jsu = skjson();
      const res = jsu.exportJSON(this.handles.apply(fn, [jsu.importJSON(key)]));
      ref.pop();
      return res;
    };
    this.init = (context: ptr) => {
      ref.push(context);
      if (!this.initFn)
        throw new Error("SKStore init function must be defined");
      this.initFn();
      ref.pop();
    };
    this.applyAccumulate = (fn: int, acc: ptr, value: ptr) => {
      const jsu = skjson();
      const accumulator = this.handles.get(fn) as Accumulator<any, any>;
      const result = accumulator.accumulate(
        jsu.importJSON(acc),
        jsu.importJSON(value),
      );
      return jsu.exportJSON(result);
    };
    this.applyDismiss = (fn: int, acc: ptr, value: ptr) => {
      const jsu = skjson();
      const accumulator = this.handles.get(fn) as Accumulator<any, any>;
      const result = accumulator.dismiss(
        jsu.importJSON(acc),
        jsu.importJSON(value),
      );
      return result != null ? jsu.exportJSON(result) : null;
    };
    this.detachHandle = (idx: int) => {
      this.handles.delete(idx);
    };
    this.getErrorHdl = (exn: ptr) => {
      return this.handles.register(utils.getErrorObject(exn));
    };
    let create = (init: () => void) => {
      // Register the init function to have  a named init function
      this.initFn = init;
      // Get a run uuid to build to allow function mapping reload in case of persistence
      const uuid = this.env.crypto().randomUUID();
      const jsu = skjson();
      const result = utils.runWithGc(() =>
        Math.trunc(fromWasm.SKIP_SKStore_createFor(jsu.exportString(uuid))),
      );
      if (result < 0) {
        throw this.handles.delete(-result);
      }
    };
    this.env.shared.set(
      "SKStore",
      new SKStoreFactoryImpl(
        () =>
          new ContextImpl(skjson(), fromWasm, this.handles, queryResult, ref),
        create,
        (dbName, asWorker) =>
          (this.env.shared.get("SKDB") as SKDBShared).createSync(
            dbName,
            asWorker,
          ),
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
    let toWasm = wasm as ToWasm;
    let links = new LinksImpl(this.env);
    toWasm.SKIP_SKStore_detachHandle = (fn: int) => links.detachHandle(fn);
    toWasm.SKIP_SKStore_applyMapFun = (
      fn: int,
      context: ptr,
      writer: ptr,
      key: ptr,
      it: ptr,
    ) => links.applyMapFun(fn, context, writer, key, it);
    toWasm.SKIP_SKStore_applyMapTableFun = (
      fn: int,
      context: ptr,
      writer: ptr,
      row: ptr,
      occ: int,
    ) => links.applyMapTableFun(fn, context, writer, row, occ);
    toWasm.SKIP_SKStore_applyConvertToRowFun = (fn: int, key: ptr, it: ptr) =>
      links.applyConvertToRowFun(fn, key, it);
    toWasm.SKIP_SKStore_init = (context: ptr) => links.init(context);
    toWasm.SKIP_SKStore_applyLazyFun = (fn, context, self, key) =>
      links.applyLazyFun(fn, context, self, key);

    toWasm.SKIP_SKStore_applyParamsFun = (fn, context, key) =>
      links.applyParamsFun(fn, context, key);
    toWasm.SKIP_SKStore_applyLazyAsyncFun = (
      fn: int,
      call: ptr,
      name: ptr,
      key: ptr,
      param: ptr,
    ) => links.applyLazyAsyncFun(fn, call, name, key, param);
    toWasm.SKIP_SKStore_applyAccumulate = (fn: int, acc: ptr, value: ptr) =>
      links.applyAccumulate(fn, acc, value);
    toWasm.SKIP_SKStore_applyDismiss = (fn: int, acc: ptr, value: ptr) =>
      links.applyDismiss(fn, acc, value);
    toWasm.SKIP_SKStore_getErrorHdl = (exn: ptr) => links.getErrorHdl(exn);
    return links;
  };
}

/** @sk init */
export function init(env: Environment) {
  return Promise.resolve(new Manager(env));
}
