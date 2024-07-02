// prettier-ignore
import type { int, ptr, Links, Utils, ToWasmManager, Environment, Opt } from "#std/sk_types.js";
import type { TJSON } from "skstore_skjson.js";
import type {
  Accumulator,
  NonEmptyIterator,
  Handles,
  Context,
  SKJSON,
  FromWasm,
  LHandle,
  Metadata,
  Mapper,
  EntryMapper,
  Mapping,
  EHandle,
  Lazy,
} from "./skstore_api.js";
import { LSelfImpl, SKStoreFactoryImpl, SKStoreImpl } from "./skstore_impl.js";

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

  constructor(skjson: SKJSON, exports: FromWasm, handles: Handles, ref: Ref) {
    this.skjson = skjson;
    this.exports = exports;
    this.handles = handles;
    this.ref = ref;
  }

  noref() {
    return new ContextImpl(this.skjson, this.exports, this.handles, new Ref());
  }

  lazy = <K extends TJSON, V extends TJSON>(
    metadata: Metadata,
    lazy: Lazy<K, V>,
  ) => {
    const name = this.handles.name(metadata);
    const lazyHdl = this.exports.SKIP_SKStore_lazy(
      this.pointer(),
      this.skjson.exportString(name),
      this.handles.register(lazy),
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
      mapping[0].getId(),
      this.handles.register(mapping[1]),
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
      mapping[0].getId(),
      this.handles.register(mapping[1]),
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

  getValue = <K, V>(name: string, key: K) => {
    return this.skjson.runWithGC(() => {
      const skvalue = this.exports.SKIP_SKStore_getValue(
        this.skjson.exportString(name),
        this.skjson.exportJSON(key),
      );
      return this.skjson.importJSON(skvalue, true);
    }) as Opt<V>;
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

  input<K, V>(name: string, value: [K, V][]) {
    const inputHdl = this.exports.SKIP_SKStore_input(
      this.pointer(),
      this.skjson.exportString(name),
      this.skjson.exportJSON(value),
    );
    return this.skjson.importString(inputHdl);
  }

  set = <K, V>(inputHdl: string, key: K, value: V) => {
    this.exports.SKIP_SKStore_set(
      this.pointer(),
      this.skjson.exportString(inputHdl),
      this.skjson.exportJSON(key),
      this.skjson.exportJSON(value),
    );
  };

  remove = <K, V>(inputHdl: string, key: K) => {
    this.exports.SKIP_SKStore_remove(
      this.pointer(),
      this.skjson.exportString(inputHdl),
      this.skjson.exportJSON(key),
    );
  };

  setFromOutside = <K, V>(input: string, key: K, value: V) => {
    this.skjson.runWithGC(() => {
      this.exports.SKIP_SKStore_setInput(
        this.skjson.exportString(input),
        this.skjson.exportJSON(key),
        this.skjson.exportJSON(value),
      );
    });
  };

  removeFromOutside = <K, V>(input: string, key: K) => {
    this.skjson.runWithGC(() => {
      this.exports.SKIP_SKStore_removeInput(
        this.skjson.exportString(input),
        this.skjson.exportJSON(key),
      );
    });
  };

  update = () => {
    const updated = this.skjson.runWithGC(() => {
      return Math.trunc(this.exports.SKIP_SKStore_update());
    });
    if (updated === 0) {
      throw new Error("Context must exist");
    }
    if (updated < 0) {
      throw this.handles.delete(-updated);
    }
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
  private updateGetter: (getter: (idx: int) => T) => void;

  constructor(
    skjson: SKJSON,
    exports: FromWasm,
    pointer: ptr,
    updateGetter: (getter: (idx: int) => T) => void,
  ) {
    this.skjson = skjson;
    this.exports = exports;
    this.pointer = pointer;
    this.updateGetter = updateGetter;
  }

  setValues = (key: K, values: T[]) => {
    this.updateGetter((idx) => values[idx]);
    this.exports.SKIP_SKStore_writerSetValues(
      this.pointer,
      this.skjson.exportJSON(key),
      values.length,
    );
  };

  set = (key: K, value: T) => {
    this.exports.SKIP_SKStore_writerSet(
      this.pointer,
      this.skjson.exportJSON(key),
      this.skjson.exportJSON(value),
    );
  };

  remove = (key: K) => {
    this.exports.SKIP_SKStore_writerRemove(
      this.pointer,
      this.skjson.exportJSON(key),
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
  SKIP_SKStore_init(builder: ptr): void;
  SKIP_SKStore_applyLazyFun(fn: int, context: ptr, self: ptr, key: ptr): ptr;
  // Accumulator
  SKIP_SKStore_applyAccumulate(fn: int, acc: ptr, value: ptr): ptr;
  SKIP_SKStore_applyDismiss(fn: int, acc: ptr, value: ptr): Opt<ptr>;
  // Utils
  SKIP_SKStore_getArrayValue(idx: int): ptr;
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
  init!: (builder: ptr) => void;
  applyAccumulate!: (fn: int, acc: ptr, value: ptr) => ptr;
  applyDismiss!: (fn: int, acc: ptr, value: ptr) => Opt<ptr>;
  getArrayValue!: (idx: int) => ptr;
  getErrorHdl!: (exn: ptr) => number;
  applyConvertToRowFun!: (fn: int, key: ptr, it: ptr) => ptr;

  private updateGetter!: (getter: (idx: int) => ptr) => void;
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
    this.updateGetter = (getter: (idx: int) => any) => {
      this.getArrayValue = (idx: int) => {
        return skjson().exportJSON(getter(idx));
      };
    };
    this.applyMapFun = (fn: int, ctx: ptr, writer: ptr, key: ptr, it: ptr) => {
      ref.push(ctx);
      const jsu = skjson();
      const w = new WriterImpl(jsu, fromWasm, writer, this.updateGetter);
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
      const w = new WriterImpl(jsu, fromWasm, writer, this.updateGetter);
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

    this.applyLazyFun = (fn: int, ctx: ptr, hdl: ptr, key: ptr) => {
      ref.push(ctx);
      const jsu = skjson();
      const context = new ContextImpl(jsu, fromWasm, this.handles, ref);
      const res = jsu.exportJSON(
        this.handles.apply(fn, [
          new LSelfImpl(context, hdl),
          jsu.importJSON(key),
        ]),
      );
      ref.pop();
      return res;
    };
    this.init = (builder: ptr) => {
      ref.push(builder);
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
        () => new ContextImpl(skjson(), fromWasm, this.handles, ref),
        create,
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
    toWasm.SKIP_SKStore_init = (builder: ptr) => links.init(builder);
    toWasm.SKIP_SKStore_applyLazyFun = (fn, scope, self, key) =>
      links.applyLazyFun(fn, scope, self, key);
    toWasm.SKIP_SKStore_applyAccumulate = (fn: int, acc: ptr, value: ptr) =>
      links.applyAccumulate(fn, acc, value);
    toWasm.SKIP_SKStore_applyDismiss = (fn: int, acc: ptr, value: ptr) =>
      links.applyDismiss(fn, acc, value);
    toWasm.SKIP_SKStore_getArrayValue = (idx: int) => links.getArrayValue(idx);
    toWasm.SKIP_SKStore_getErrorHdl = (exn: ptr) => links.getErrorHdl(exn);
    return links;
  };
}

/** @sk init */
export function init(env: Environment) {
  return Promise.resolve(new Manager(env));
}
