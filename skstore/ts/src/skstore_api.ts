/**
 * This file contains the SKStore public API: types, interfaces, and operations that can be
 * used to specify and interact with reactive computations. See [todo: pointer to public
 * overview page] for a detailed description and introduction to the SKStore system.
 */

// prettier-ignore
import type { Opt, Shared, float, int, ptr } from "#std/sk_types.js";
export type { Opt, float, int, ptr };

export type JSONObject = { [key: string]: TJSON };

export type TJSON = number | JSONObject | boolean | TJSON[] | string;

export type TTableHandle = any;
export type TTable = any;
export type Param = any;

export type DBType = "TEXT" | "JSON" | "INTEGER" | "FLOAT" | "SCHEMA";

// `filter` is interpreted as a SQL "where" clause
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

/**
 * SKStore async function calls return a `Result` value which is one of `Success`,
 * `Failure`, or `Unchanged`
 */

/**
 * A `Success` return value indicates successful function evaluation and contains:
 * `payload`: the function return value
 * `metadata`: optional data that can be added to specify further information
               about data such as source location.
 */
export type Success<V extends TJSON, M extends TJSON> = {
  status: "success";
  payload: V;
  metadata?: M;
};

/**
 * A `Failure` return value indicates a runtime error and contains:
 * `error` - the error message associated with the error
 */
export type Failure = {
  status: "failure";
  error: string;
};

/**
 * An `Unchanged` return value indicates that the data is the same as the last invocation,
 * and is analogous to HTTP response code 304 'Not Modified'.  It contains:
 * `metadata` - optional data that can be added to supersede metadata on the unchanged return value
 */
export type Unchanged<M extends TJSON> = {
  status: "unchanged";
  metadata?: M;
};

export type Result<V extends TJSON, M extends TJSON> =
  | Success<V, M>
  | Failure
  | Unchanged<M>;

/**
 * Lazy function calls carry additional structure in their `Loadable` return types, to
 * indicate that computation is in progress or record information about previous values;
 * the `Success` case is the same as for non-lazy calls, or the result can be `Loading`
 * or `Error`.
 */

/**
 * A `Loading` return value indicates that a new call has been performed, but its result
 * is not yet available.  It contains:
 * `previous` - the return value of the previous successful call, if available
 */
export type Loading<V extends TJSON, M extends TJSON> = {
  status: "loading";
  previous?: { payload: V; metadata?: M };
};

/**
 * An `Error` return value indicates that a runtime error occurred during a lazy function
 * call.  It contains:
 * `error` - the error message associated with the error
 * `previous` - the return value of the previous successful call, if available
 */
export type Error<V extends TJSON, M extends TJSON> = {
  status: "failure";
  error: string;
  previous?: { payload: V; metadata?: M };
};

export type Loadable<V extends TJSON, M extends TJSON> =
  | Success<V, M>
  | Loading<V, M>
  | Error<V, M>;

export type AValue<V extends TJSON, M extends TJSON> = {
  payload?: V;
  metadata?: M;
};

/**
 * Error thrown when an index is not found during table lookup
 */
export class TableIndexError extends Error {}

/**
 * The type of a reactive function mapping over a table.
 * @param entry - the input table row
 * @param occ - the number of repeat occurrences of `entry`
 * @returns {Iterable} an iterable of key/value pairs to output for the given input(s)
 */
export interface EntryMapper<
  R extends TJSON,
  K extends TJSON,
  V extends TJSON,
> {
  mapElement: (entry: R, occ: number) => Iterable<[K, V]>;
}

export type EMParameters<
  K extends TJSON,
  V extends TJSON,
  R extends TJSON[],
  C extends new (...params: Param[]) => EntryMapper<R, K, V>,
> = C extends new (...params: infer P) => EntryMapper<R, K, V> ? P : never;

/**
 * The type of a reactive function mapping over an arbitrary collection.
 * For each key & values in the input collection (of type K1/V1 respectively),
 * produces some key/value pairs for the output collection (of type K2/V2 respectively)
 * @param key - a key found in the input collection
 * @param {NonEmptyIterator} it - the values mapped to by `key` in the input collection
 * @returns {Iterable} an iterable of key/value pairs to output for the given input(s)
 */
export interface Mapper<
  K1 extends TJSON,
  V1 extends TJSON,
  K2 extends TJSON,
  V2 extends TJSON,
> {
  mapElement: (key: K1, it: NonEmptyIterator<V1>) => Iterable<[K2, V2]>;
}

export type MParameters<
  K1 extends TJSON,
  V1 extends TJSON,
  K2 extends TJSON,
  V2 extends TJSON,
  C extends new (...params: Param[]) => Mapper<K1, V1, K2, V2>,
> = C extends new (...params: infer P) => Mapper<K1, V1, K2, V2> ? P : never;

/**
 * The handle entry mapper function to write data into table
 * @param key - the mapped handle entry key
 * @param {NonEmptyIterator} it - an iterator on values avalable for a key
 * @returns {R} the table entry corresponding to eager map key value pair
 */
export interface OutputMapper<
  R extends TJSON,
  K extends TJSON,
  V extends TJSON,
> {
  mapElement: (key: K, it: NonEmptyIterator<V>) => R;
}

export type OMParameters<
  R extends TJSON,
  K extends TJSON,
  V extends TJSON,
  C extends new (...params: Param[]) => OutputMapper<R, K, V>,
> = C extends new (...params: infer P) => OutputMapper<R, K, V> ? P : never;

/**
 * The type of a reactive accumulator (a.k.a. reducer) function, which computes an output
 * value over a collection as values are added/removed to the collection
 */
export interface Accumulator<T extends TJSON, V extends TJSON> {
  default: Opt<V>;
  /**
   * The computation to perform when an input value is added
   * @param acc - the current accumulated value
   * @param value - the added value
   * @return the resulting accumulated value
   */
  accumulate(acc: Opt<V>, value: T): V;
  /**
   * The computation to perform when an input value is removed
   * @param acc - the current accumulated value
   * @param value - the removed value
   * @return the resulting accumulated value
   */
  dismiss(acc: V, value: T): Opt<V>;
}

/**
 * A mutable iterator with at least one element
 */
export interface NonEmptyIterator<T> extends Iterable<T> {
  /**
   * Return the next element of the iteration.
   *   `first` cannot be called after `next`
   */
  next: () => Opt<T>;
  /**
   * Returns the first element of the iteration.
   * @throws {Error} when next called before
   */
  first: () => T;

  /**
   * Returns the first element of the iteration iff it contains exactly one element
   */
  uniqueValue: () => Opt<T>;

  /**
   * Returns an array containing the remaining values of the iterator
   */
  toArray: () => T[];
}

/**
 * A _Lazy_ Handle on a reactive collection, whose values are computed only when queried
 * using `get`
 */
export interface LHandle<K, V> {
  /**
   * Get (and potentially compute) a value of a lazy reactive collection
   * @throws {Error} when the key does not exist
   */
  get(key: K): V;
}

/**
 * An _Eager_ handle on a reactive collection, whose values are computed eagerly as
 * inputs grow/change
 */
export interface EHandle<K extends TJSON, V extends TJSON> {
  /**
   * Get a value of an eager reactive collection
   * @throws {Error} when the key does not exist
   */
  get(key: K): V;
  /**
   * Get a value of an eager reactive collection, if it exists
   * @returns the value for this `key`, or null if no such value exists
   */
  maybeGet(key: K): Opt<V>;

  /**
   *  Create a new eager reactive collection by mapping some computation over this one
   * @param {Mapper} mapper - function to apply to each element of this collection
   * @returns {EHandle} An eager handle on the resulting output collection
   */
  map<
    K2 extends TJSON,
    V2 extends TJSON,
    C extends new (...params: Param[]) => Mapper<K, V, K2, V2>,
  >(
    mapper: C,
    ...params: MParameters<K, V, K2, V2, C>
  ): EHandle<K2, V2>;
  /**
   * Create a new eager reactive collection by mapping some computation `mapper` over this
   * one and then reducing the results with `accumulator`
   * @param {Mapper} mapper - function to apply to each element of this collection
   * @param {Accumulator} accumulator - function to combine results of the `mapper`
   * @returns {EHandle} An eager handle on the output of the `accumulator`
   */
  mapReduce<
    K2 extends TJSON,
    V2 extends TJSON,
    V3 extends TJSON,
    C extends new (...params: Param[]) => Mapper<K, V, K2, V2>,
  >(
    mapper: C,
    accumulator: Accumulator<V2, V3>,
    ...params: MParameters<K, V, K2, V2, C>
  ): EHandle<K2, V3>;

  /**
   * The current number of elements in the collection
   */
  size: () => number;

  /**
   * Eagerly write/update `table` with the contents of this collection
   * @param {Mapper} mapper - function to apply to each key/value pair in this collection
   *                          to produce a table row
   */
  mapTo<
    R extends TJSON[],
    C extends new (...params: Param[]) => OutputMapper<R, K, V>,
  >(
    table: TableHandle<R>,
    mapper: C,
    ...params: OMParameters<R, K, V, C>
  ): void;

  getId(): string;
}

/** An eager handle on a Table */
export interface TableHandle<R extends TJSON[]> {
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
   * Create a new eager reactive collection by mapping over each table entry
   * @returns {EHandle} An eager handle on the resulting collection
   */
  map<
    K extends TJSON,
    V extends TJSON,
    C extends new (...params: Param[]) => EntryMapper<R, K, V>,
  >(
    mapper: C,
    ...params: EMParameters<K, V, R, C>
  ): EHandle<K, V>;
}

/**
 * This interface supports SQL-like operations accessing and/or mutating the data in a
 * collection.  These operations are available only on collections which satisfy certain
 * structural constraints, such as those produced by `mapTo`.
 */
export interface Table<R extends TJSON[]> {
  getName(): string;
  /**
   * Insert an entry (or entries) into the table
   * @param entries - The new data to insert
   * @param update - If true, update the existing row in case of index conflict
   * @throws {Error} in case of index conflict (when `update` is false) or constraint
   *         violation
   */
  insert(entry: R[], update?: boolean): void;
  /**
   * Update an entry in the table
   * @param row - the table entry to update
   * @param updates - the column values updates
   * @throws {Error} when the updates violate an index or other contraint
   */
  update(row: R, updates: JSONObject): void;
  /**
   * Update entries in the table matching some `where` clause
   * @param where - the column values to filter entries
   * @param updates - the column values updates
   * @throws {Error} when an index contraints is broken
   */
  updateWhere(where: JSONObject, updates: JSONObject): void;
  /**
   * Select entries in the table
   * @param where - the column values to filter entries
   * @param columns - the columns to include in the output; include all by default
   * @throws {Error} when an index contraints is broken
   */
  select(where: JSONObject, columns?: string[]): JSONObject[];
  /**
   * Delete an entry from the table
   * @param entry - the entry to delete
   */
  delete(entry: R): void;
  /**
   * Delete entries from the table matching some `where` clause.
   * @param where - the column values to filter entries
   */
  deleteWhere(where: JSONObject): void;
  /**
   * Register a callback to be invoked on the `rows` of this table whenever data changes
   * @param update - the callback to invoke when data changes
   * @returns a callback `close` to terminate and clean up the watch
   */
  watch: (update: (rows: JSONObject[]) => void) => { close: () => void };
  /**
   * Register a callback to be invoked on the `added` and `removed` rows of this table
   * whenever data changes
   * @param init - a callback to invoke on table initialization and reset
   * @param update - the callback to invoke on changes
   */
  watchChanges: (
    init: (rows: JSONObject[]) => void,
    update: (added: JSONObject[], removed: JSONObject[]) => void,
  ) => { close: () => void };
}

/**
 * A `Mapping` is an edge in the reactive computation graph, specified by an eager source handle together with a `Mapper` function
 */
export type Mapping<
  K1 extends TJSON,
  V1 extends TJSON,
  K2 extends TJSON,
  V2 extends TJSON,
> = {
  handle: EHandle<K1, V1>;
  mapper: new (...params: Param[]) => Mapper<K1, V1, K2, V2>;
  params?: Param[];
};

export interface SKStoreFactory extends Shared {
  runSKStore(
    init: (skstore: SKStore, ...tables: TableHandle<TJSON[]>[]) => void,
    tables: MirrorSchema[],
    connect?: boolean,
  ): Promise<Table<TJSON[]>[]>;
}

export interface LazyCompute<K extends TJSON, V extends TJSON> {
  compute: (selfHdl: LHandle<K, V>, key: K) => Opt<V>;
}

export interface AsyncLazyCompute<
  K extends TJSON,
  V extends TJSON,
  P extends TJSON,
  M extends TJSON,
> {
  params: (key: K) => P;
  call: (key: K, params: P) => Promise<AValue<V, M>>;
}

export type LParameters<
  K extends TJSON,
  V extends TJSON,
  C extends new (...params: Param[]) => LazyCompute<K, V>,
> = C extends new (...params: infer P) => LazyCompute<K, V> ? P : never;

export type ALParameters<
  K extends TJSON,
  V extends TJSON,
  P extends TJSON,
  M extends TJSON,
  C extends new (...params: Param[]) => AsyncLazyCompute<K, V, P, M>,
> = C extends new (...params: infer U) => AsyncLazyCompute<K, V, P, M>
  ? U
  : never;

export interface SKStore {
  /**
   * Creates a lazy reactive map
   * @param compute - the lazy function to compute entries of the lazy map
   * @returns {LHandle} The the resulting lazy reactive map handle
   */
  lazy<
    K extends TJSON,
    V extends TJSON,
    C extends new (...params: Param[]) => LazyCompute<K, V>,
  >(
    compute: C,
    ...params: LParameters<K, V, C>
  ): LHandle<K, V>;

  /**
   * Map over each entry of each eager reative map and apply the corresponding mapper function
   * @param {Mapping[]} mappings - the handles to combine
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

  /**
   * Creates a lazy reactive map attched to a asynch call
   * @param get - the function the gather the values from others reactive maps
   * @param call - the async function to call with gathered values
   * @returns {LHandle} The the resulting lazy reactive map handle
   */
  asyncLazy<
    K extends TJSON,
    V extends TJSON,
    P extends TJSON,
    M extends TJSON,
    C extends new (...params: Param[]) => AsyncLazyCompute<K, V, P, M>,
  >(
    compute: C,
    ...params: ALParameters<K, V, P, M, C>
  ): LHandle<K, Loadable<V, M>>;

  log(object: TJSON): void;
}
