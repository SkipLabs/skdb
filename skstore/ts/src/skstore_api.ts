// prettier-ignore
import type {App, Opt, Shared, float, int, ptr} from "#std/sk_types.js";
import type { JSONObject, TJSON } from "./skstore_skjson.js";

export type { Opt, float, int, ptr };

export type DBType = "TEXT" | "JSON" | "INTEGER" | "FLOAT" | "SCHEMA";
export type DBFilter = { filter: string; params?: JSONObject };
export type ColumnSchema = {
  name: string;
  type: DBType;
  notnull?: boolean;
  primary?: boolean;
};
export type TableSchema = { name: string; columns: ColumnSchema[] };
export type MirrorSchema = {
  name: string;
  expected: ColumnSchema[];
  filter?: DBFilter;
};

export type Metadata = {
  filepath: string;
  line: number;
  column: number;
};

export interface Handles {
  register(v: any): int;
  get(id: int): any;
  apply(id: int, parameters: any[]): any;
  delete(id: int): any;
  name(metadata: Metadata): string;
}

/**
 * An error thrown when an index is not found during table lookup
 */
export class TableIndexError extends Error {}

/**
 * The table entry mapper function
 * @param entry - the table entry to manage
 * @param occ - the occurence of entry in the table
 * @returns {Iterable} an iterable of Key, Value pair the depends on the entry
 */
export type EntryMapper<R extends TJSON, K extends TJSON, V extends TJSON> = (
  entry: R,
  occ: number,
) => Iterable<[K, V]>;

/**
 * The handle entry mapper function
 * @param key - the mapped handle entry key
 * @param {NonEmptyIterator} it - an iterator on values avalable for a key
 * @returns {Iterable} an iterable of Key, Value pair that depends on the entry
 */
export type Mapper<
  K1 extends TJSON,
  V1 extends TJSON,
  K2 extends TJSON,
  V2 extends TJSON,
> = (key: K1, it: NonEmptyIterator<V1>) => Iterable<[K2, V2]>;

/**
 * The handle entry mapper function to write data into table
 * @param key - the mapped handle entry key
 * @param {NonEmptyIterator} it - an iterator on values avalable for a key
 * @returns {R} the table entry corresponding to eager map key value pair
 */
export type OutputMapper<R extends TJSON, K extends TJSON, V extends TJSON> = (
  key: K,
  it: NonEmptyIterator<V>,
) => R;

/**
 * The Accumulator
 */
export interface Accumulator<T extends TJSON, V extends TJSON> {
  /** The default value of the accumulator */
  default: Opt<V>;
  /**
   * The computation the perform when a value is added the a reactive map
   * @param acc - the current accumulated value
   * @param value - the value to accumulale
   * @return The resulting acculated value
   */
  accumulate(acc: Opt<V>, value: T): V;
  /**
   * The computation the perform when a value is removed from a reactive map
   * @param acc - the current accumulated value
   * @param value - the value to dismiss
   * @return The resulting acculated value
   */
  dismiss(acc: V, value: T): Opt<V>;
}

/**
 * A Iterator that have at least one object
 */
export interface NonEmptyIterator<T> {
  /**
   * Returns the next element in the iteration.
   *   first() cannot be call after this call
   */
  next: () => Opt<T>;
  /**
   * Returns the first element of the iteration.
   * @throws {Error} when next called before
   */
  first: () => T;

  /**
   * Returns the first element of the iteration if it's unique.
   */
  uniqueValue: () => Opt<T>;

  /**
   * Returns an array containing the remaining values of the iterator
   */
  toArray: () => T[];
}

/**
 * An handle to access to value of a lazy reactive map
 */
export interface LHandle<K, V> {
  /**
   * Get/Compute a value of a lazy reactive map
   * @param key - the key of the to get
   */
  get(key: K): V;
}

/**
 * An handle to act on an eager reactive map
 */
export interface EHandle<K extends TJSON, V extends TJSON> {
  /**
   * Get a value of a eager reactive map
   * @param key - the key of the to get
   * @returns the value corresponding to the key
   * @throws {Error} when key not exist
   */
  get(key: K): V;
  /**
   * Get a value of a eager reactive map if exist
   * @param key - the key of the to get
   * @returns the value corresponding to the key if exist else null
   */
  maybeGet(key: K): Opt<V>;

  /**
   * Map over each eager reative map entry and apply mapper function
   * @param {Mapper} mapper - function to apply to the table entry
   * @returns {EHandle} The the resulting eager reactive map handle
   */
  map<K2 extends TJSON, V2 extends TJSON>(
    mapper: Mapper<K, V, K2, V2>,
  ): EHandle<K2, V2>;
  /**
   * Map over each eager reative map entry and apply mapper function
   *  then reduce the when the given accumulator
   * @param {Mapper} mapper - function to apply to the eager map entry
   * @param {Accumulator} accumulator - reduction manager
   * @returns {EHandle} The the resulting eager reactive map handle
   */
  mapReduce<K2 extends TJSON, V2 extends TJSON, V3 extends TJSON>(
    mapper: Mapper<K, V, K2, V2>,
    accumulator: Accumulator<V2, V3>,
  ): EHandle<K2, V3>;

  /**
   * Access the reactive size of the reactive eager map
   */
  size: () => number;

  /**
   * Map over each eager reative map entry to write it into given table
   * @param {Mapper} mapper - function to apply to the table entry
   */
  mapTo<R extends TJSON[]>(
    table: TableHandle<R>,
    mapper: OutputMapper<R, K, V>,
  ): void;

  getId(): string;
}

export interface TableHandle<R extends TJSON[]> {
  /**
   * @returns {string} The name of the table
   */
  getName(): string;
  /**
   * Lookup in the table using specified index
   * @param key - the key to lookup in the table
   * @param index - the index which you want lookup the table
   * @returns The results of the lookup
   * @throws {TableIndexError} when an index is not found
   *          or the index type is not valid
   */
  // TODO get(key: TJSON, index?: string): R[];

  /**
   * Map over each table entry and apply mapper function
   * @param {EntryMapper} mapper - function to apply to the table entry
   * @returns {EHandle} The the resulting eager reactive map handle
   */
  map<K extends TJSON, V extends TJSON>(
    mapper: EntryMapper<R, K, V>,
  ): EHandle<K, V>;
}

export interface Table<R extends TJSON[]> {
  getName(): string;
  /**
   * Insert an entry in the table
   * @param entries - the entries to insert in the table
   * @param update - indicate if the value need to be updated in case of index conflict
   * @throws {Error} when not update and an index contraints is broken
   */
  insert(entry: R[], update?: boolean): void;
  /**
   * Update an entry in the table
   * @param row - the table entry to update
   * @param updates - the column values updates
   * @throws {Error} when an index contraints is broken
   */
  update(row: R, updates: JSONObject): void;
  /**
   * Update an entry in the table
   * @param where - the column values to filter entries
   * @param updates - the column values updates
   * @throws {Error} when an index contraints is broken
   */
  updateWhere(where: JSONObject, updates: JSONObject): void;
  /**
   * Select entries in the table
   * @param where - the column values to filter entries
   * @throws {Error} when an index contraints is broken
   */
  select(where: JSONObject, columns?: string[]): JSONObject[];
  /**
   * Delete an entry in the table
   * @param entry - the entry to delete from the table
   */
  delete(entry: R): void;
  /**
   * Delete entries in the table
   * @param where - the column values to filter entries
   */
  deleteWhere(where: JSONObject): void;
  /**
   * Add a watch to the table
   * @param update - the function to call on table update
   */
  watch: (update: (rows: JSONObject[]) => void) => { close: () => void };
  /**
   * Add a watch changes to the table
   * @param init - the function to call on table init/reset
   * @param update - the function to call on table update
   */
  watchChanges: (
    init: (rows: JSONObject[]) => void,
    update: (added: JSONObject[], removed: JSONObject[]) => void,
  ) => { close: () => void };
}

export type Mapping<
  K1 extends TJSON,
  V1 extends TJSON,
  K2 extends TJSON,
  V2 extends TJSON,
> = [EHandle<K1, V1>, Mapper<K1, V1, K2, V2>];

export type Lazy<K extends TJSON, V extends TJSON> = (
  selfHdl: LHandle<K, V>,
  key: K,
) => Opt<V>;

export interface SKStoreFactory extends Shared {
  runSKStore(
    init: (skstore: SKStore, ...tables: TableHandle<TJSON[]>[]) => void,
    app: App,
    tables: MirrorSchema[],
    connect?: boolean,
  ): Promise<Table<TJSON[]>[]>;
}

export interface SKStore {
  /**
   * Creates a lazy reactive map
   * @param {Lazy} compute - the lazy function to compute lazy map entry
   * @returns {LHandle} The the resulting lazy reactive map handle
   */
  lazy<K extends TJSON, V extends TJSON>(compute: Lazy<K, V>): LHandle<K, V>;
  /**
   * Map over each entry of each eager reative map and apply the corresponding mapper function
   * @param {Mapping} mappings - the handles to combine
   * @returns {EHandle} The the resulting eager reactive map handle
   */
  multimap<
    K1 extends TJSON,
    V1 extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
  >(
    mappings: Mapping<K1, V1, K2, V2>[],
  ): EHandle<K2, V2>;
  /**
   * Map over each entry of each eager reative map and apply the corresponding mapper function
   *  then reduce the when the given accumulator
   * @param {Mapping} mappings - the handles to combine
   * @param {Accumulator} accumulator - reduction manager
   * @returns {EHandle} The the resulting eager reactive map handle
   */
  multimapReduce<
    K1 extends TJSON,
    V1 extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
    V3 extends TJSON,
  >(
    mappings: Mapping<K1, V1, K2, V2>[],
    accumulator: Accumulator<V2, V3>,
  ): EHandle<K2, V3>;
}

export interface Handles {
  register(v: any): int;
  get(id: int): any;
  apply(id: int, parameters: any[]): any;
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

  SKIP_SKStore_set(ctx: ptr, inputHdl: ptr, key: ptr, value: ptr): void;
  SKIP_SKStore_remove(ctx: ptr, inputHdl: ptr, key: ptr): void;
  SKIP_SKStore_size(ctx: ptr, eagerHdl: ptr): number;

  SKIP_SKStore_toSkdb(ctx: ptr, eagerHdl: ptr, table: ptr, fnPtr: int): void;

  // NonEmptyIterator
  SKIP_SKStore_iteratorNext(it: ptr): Opt<ptr>;
  SKIP_SKStore_iteratorUniqueValue(it: ptr): Opt<ptr>;
  SKIP_SKStore_iteratorFirst(it: ptr): ptr;
  // Writer
  SKIP_SKStore_writerSetValues(writer: ptr, key: ptr, size: int): void;
  SKIP_SKStore_writerSet(writer: ptr, key: ptr, value: ptr): void;
  SKIP_SKStore_writerRemove(writer: ptr, key: ptr): void;

  // Store
  SKIP_SKStore_update(): float;
  SKIP_SKStore_createFor(session: ptr): float;
  SKIP_SKStore_setInput(input: ptr, key: ptr, value: ptr): void;
  SKIP_SKStore_removeInput(input: ptr, key: ptr): void;
  SKIP_SKStore_getValue(prop: ptr, key: ptr): ptr;

  // SKSTore
  SKIP_SKStore_input(ctx: ptr, name: ptr, values: ptr): ptr;
  SKIP_SKStore_lazy(ctx: ptr, name: ptr, lazyFn: int): ptr;
  SKIP_SKStore_fromSkdb(ctx: ptr, table: ptr, name: ptr, fnPtr: int): ptr;
  SKIP_SKStore_multimap(ctx: ptr, name: ptr, mappings: ptr): ptr;

  SKIP_SKStore_multimapReduce(
    ctx: ptr,
    name: ptr,
    mappings: ptr,
    accumulator: int,
    accInit: ptr,
  ): ptr;
}

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
  input: <K extends TJSON, V extends TJSON>(
    name: string,
    value: [K, V][],
  ) => string;
  lazy: <K extends TJSON, V extends TJSON>(
    metadata: Metadata,
    compute: Lazy<K, V>,
  ) => string;
  get: <K, V>(eagerHdl: string, key: K) => V;
  getFromTable: <K, R>(table: string, key: K, index?: string) => R[];
  maybeGet: <K, V>(eagerHdl: string, key: K) => Opt<V>;
  getLazy: <K, V>(lazyHdl: string, key: K) => V;
  getSelf: <K, V>(lazyHdl: ptr, key: K) => V;
  getValue: <K, V>(name: string, key: K) => Opt<V>;

  size: (eagerHdl: string) => number;

  set: <K extends TJSON, V extends TJSON>(
    inputHdl: string,
    key: K,
    value: V,
  ) => void;
  remove: <K extends TJSON>(inputHdl: string, key: K) => void;
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

  update: () => void;
  noref: () => Context;
}

/**
 * Collect function file line colum
 * @param offset
 * @returns
 */
export function metadata(offset: number): Metadata {
  const stack = new Error().stack!.split("\n");
  // Skip "Error" and metadata call
  const info = /\((.*):(\d+):(\d+)\)$/.exec(stack[2 + offset]);
  const metadata = {
    filepath: info![1],
    line: parseInt(info![2]),
    column: parseInt(info![3]),
  };
  return metadata;
}
