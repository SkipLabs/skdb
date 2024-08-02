// prettier-ignore
import type { Opt, Shared, ptr, int, float, Metadata } from "#std/sk_types.js";
import type {
  Accumulator,
  AValue,
  EntryMapper,
  LHandle,
  Mapper,
  Mapping,
  MirrorSchema,
  OutputMapper,
  TJSON,
  JSONObject,
} from "../skstore_api.js";

export interface SKJSON extends Shared {
  importJSON: (value: ptr, copy?: boolean) => any;
  exportJSON: <T>(v: T) => ptr;
  importOptJSON: (value: Opt<ptr>, copy?: boolean) => any;
  importString: (v: ptr) => string;
  exportString: (v: string) => ptr;
  runWithGC: <T>(fn: () => T) => T;
}

export interface Context {
  mapReduce: <
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
  ) => string;

  map: <K extends TJSON, V extends TJSON, K2 extends TJSON, V2 extends TJSON>(
    eagerHdl: string,
    metadata: Metadata,
    compute: Mapper<K, V, K2, V2>,
  ) => string;
  lazy: <K extends TJSON, V extends TJSON>(
    metadata: Metadata,
    compute: (selfHdl: LHandle<K, V>, key: K) => Opt<V>,
  ) => string;
  asyncLazy: <
    K extends TJSON,
    V extends TJSON,
    P extends TJSON,
    M extends TJSON,
  >(
    metadata: Metadata,
    get: (key: K) => P,
    call: (key: K, params: P) => Promise<AValue<V, M>>,
  ) => string;
  get: <K, V>(eagerHdl: string, key: K) => V;
  getFromTable: <K, R>(table: string, key: K, index?: string) => R[];
  maybeGet: <K, V>(eagerHdl: string, key: K) => Opt<V>;
  getLazy: <K, V>(lazyHdl: string, key: K) => V;
  getSelf: <K, V>(lazyHdl: ptr, key: K) => V;

  size: (eagerHdl: string) => number;

  mapFromSkdb: <R extends TJSON, K extends TJSON, V extends TJSON>(
    table: string,
    metadata: Metadata,
    mapper: EntryMapper<R, K, V>,
  ) => string;
  mapToSkdb: <R extends TJSON, K extends TJSON, V extends TJSON>(
    eagerHdl: string,
    table: string,
    mapper: OutputMapper<R, K, V>,
  ) => void;

  multimap<
    K1 extends TJSON,
    V1 extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
  >(
    metadata: Metadata,
    mappings: Mapping<K1, V1, K2, V2>[],
  ): string;
  multimapReduce<
    K1 extends TJSON,
    V1 extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
    V3 extends TJSON,
  >(
    metadata: Metadata,
    mappings: Mapping<K1, V1, K2, V2>[],
    accumulator: Accumulator<V2, V3>,
  ): string;

  createTables: (schemas: MirrorSchema[]) => void;

  insert: <R extends TJSON[][]>(
    name: string,
    entries: R,
    update?: boolean,
  ) => void;

  update: <R extends TJSON[]>(
    name: string,
    columns: string[],
    entry: R,
    updates: JSONObject,
  ) => void;

  updateWhere: (name: string, where: JSONObject, updates: JSONObject) => void;

  select: (
    name: string,
    select: JSONObject,
    columns?: string[],
  ) => JSONObject[];

  delete: <R extends TJSON[]>(
    name: string,
    columns: string[],
    entry: R,
  ) => void;

  deleteWhere: (name: string, where: JSONObject) => void;

  jsonExtract(value: JSONObject, pattern: string): TJSON[];

  noref: () => Context;
  notify?: () => void;
}

export interface Handles {
  register(v: any): int;
  get(id: int): any;
  apply<T>(id: int, parameters: T[]): T;
  delete(id: int): any;
  name(metadata: Metadata): string;
}

export interface FromWasm {
  // Handle
  SKIP_SKStore_map(ctx: ptr, eagerHdl: ptr, name: ptr, fnPtr: int): ptr;

  SKIP_SKStore_mapReduce(
    ctx: ptr,
    eagerHdl: ptr,
    name: ptr,
    fnPtr: int,
    accumulator: int,
    accInit: ptr,
  ): ptr;

  SKIP_SKStore_get(ctx: ptr, getterHdl: ptr, key: ptr): ptr;
  SKIP_SKStore_getFromTable(ctx: ptr, table: ptr, key: ptr, index: ptr): ptr;

  SKIP_SKStore_maybeGet(ctx: ptr, getterHdl: ptr, key: ptr): ptr;

  SKIP_SKStore_getLazy(ctx: ptr, lazyId: ptr, key: ptr): ptr;

  SKIP_SKStore_getSelf(ctx: ptr, selfHdl: ptr, key: ptr): ptr;

  SKIP_SKStore_size(ctx: ptr, eagerHdl: ptr): number;

  SKIP_SKStore_toSkdb(ctx: ptr, eagerHdl: ptr, table: ptr, fnPtr: int): void;

  // NonEmptyIterator
  SKIP_SKStore_iteratorNext(it: ptr): Opt<ptr>;
  SKIP_SKStore_iteratorUniqueValue(it: ptr): Opt<ptr>;
  SKIP_SKStore_iteratorFirst(it: ptr): ptr;
  // Writer
  SKIP_SKStore_writerSet(writer: ptr, key: ptr, value: ptr): void;

  // Store
  SKIP_SKStore_createFor(session: ptr): float;

  // SKStore
  SKIP_SKStore_asyncLazy(ctx: ptr, name: ptr, paramsFn: int, lazyFn: int): ptr;
  SKIP_SKStore_lazy(ctx: ptr, name: ptr, lazyFn: int): ptr;
  SKIP_SKStore_fromSkdb(ctx: ptr, table: ptr, name: ptr, fnPtr: int): ptr;
  SKIP_SKStore_multimap(ctx: ptr, name: ptr, mappings: ptr): ptr;
  SKIP_SKStore_asyncResult(
    callId: ptr,
    name: ptr,
    key: ptr,
    param: ptr,
    value: ptr,
  ): number;

  SKIP_SKStore_multimapReduce(
    ctx: ptr,
    name: ptr,
    mappings: ptr,
    accumulator: int,
    accInit: ptr,
  ): ptr;

  // SKDB
  SKIP_SKStore_createTables(schemas: ptr): number;
  SKIP_SKStore_insert(name: ptr, entries: ptr, update: boolean): number;
  SKIP_SKStore_update(
    name: ptr,
    columns: ptr,
    entry: ptr,
    updates: ptr,
  ): number;
  SKIP_SKStore_updateWhere(name: ptr, where: ptr, updates: ptr): number;
  SKIP_SKStore_select(name: ptr, select: ptr, columns: ptr): ptr;
  SKIP_SKStore_delete(name: ptr, columns: ptr, entry: ptr): number;
  SKIP_SKStore_deleteWhere(name: ptr, where: ptr): number;

  // Utils
  SKIP_SKStore_jsonExtract(json: ptr, pattern: ptr): ptr;
}
