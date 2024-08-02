// prettier-ignore
import { type ptr, type Opt, metadata } from "#std/sk_types.js";
import type { Context } from "./skstore_types.js";
import type {
  Accumulator,
  EHandle,
  LHandle,
  Mapper,
  OutputMapper,
  TableHandle,
  SKStore,
  SKStoreFactory,
  Mapping,
  MirrorSchema,
  ColumnSchema,
  EntryMapper,
  Table,
  Loadable,
  AValue,
  JSONObject,
  TJSON,
} from "../skstore_api.js";

// prettier-ignore
import type { MirrorDefn, Params, SKDBSync } from "#skdb/skdb_types.js";

class EHandleImpl<K extends TJSON, V extends TJSON> implements EHandle<K, V> {
  //
  protected context: Context;
  eagerHdl: string;

  constructor(context: Context, eagerHdl: string) {
    this.context = context;
    this.eagerHdl = eagerHdl;
  }
  getId(): string {
    return this.eagerHdl;
  }

  protected derive<K2 extends TJSON, V2 extends TJSON>(
    eagerHdl: string,
  ): EHandle<K2, V2> {
    return new EHandleImpl<K2, V2>(this.context, eagerHdl);
  }

  get(key: K): V {
    return this.context.get(this.eagerHdl, key);
  }

  maybeGet(key: K): Opt<V> {
    return this.context.maybeGet(this.eagerHdl, key);
  }

  size = () => {
    return this.context.size(this.eagerHdl);
  };

  map<K2 extends TJSON, V2 extends TJSON>(mapper: Mapper<K, V, K2, V2>) {
    const data = metadata(1);
    const eagerHdl = this.context.map(this.eagerHdl, data, mapper);
    return this.derive<K2, V2>(eagerHdl);
  }

  mapReduce<K2 extends TJSON, V2 extends TJSON, V3 extends TJSON>(
    mapper: Mapper<K, V, K2, V2>,
    accumulator: Accumulator<V2, V3>,
  ) {
    const eagerHdl = this.context.mapReduce(
      this.eagerHdl,
      metadata(1),
      mapper,
      accumulator,
    );
    return this.derive<K2, V3>(eagerHdl);
  }

  mapTo<R extends TJSON[]>(
    table: TableHandle<R>,
    mapper: OutputMapper<R, K, V>,
  ): void {
    this.context.mapToSkdb(this.eagerHdl, table.getName(), mapper);
  }
}

class LHandleImpl<K extends TJSON, V extends TJSON> implements LHandle<K, V> {
  protected context: Context;
  protected lazyHdl: string;

  constructor(context: Context, lazyHdl: string) {
    this.context = context;
    this.lazyHdl = lazyHdl;
  }

  get(key: K): V {
    return this.context.getLazy(this.lazyHdl, key);
  }
}

export class LSelfImpl<K extends TJSON, V extends TJSON>
  implements LHandle<K, V>
{
  protected context: Context;
  protected lazyHdl: ptr;

  constructor(context: Context, lazyHdl: ptr) {
    this.context = context;
    this.lazyHdl = lazyHdl;
  }

  get(key: K): V {
    return this.context.getSelf(this.lazyHdl, key);
  }
}

export class TableHandleImpl<R extends TJSON[]> implements TableHandle<R> {
  protected context: Context;
  protected skdb: SKDBSync;
  protected schema: MirrorSchema;

  constructor(context: Context, skdb: SKDBSync, schema: MirrorSchema) {
    this.context = context;
    this.skdb = skdb;
    this.schema = schema;
  }

  getName(): string {
    return this.schema.name;
  }

  get(key: TJSON, index?: string | undefined): R[] {
    return this.context.getFromTable(this.getName(), key, index);
  }

  map<K extends TJSON, V extends TJSON>(
    mapper: EntryMapper<R, K, V>,
  ): EHandle<K, V> {
    const name = this.getName();
    const data = metadata(1);
    const eagerHdl = this.context.mapFromSkdb(name, data, mapper);
    return new EHandleImpl<K, V>(this.context, eagerHdl);
  }

  toTable() {
    return new TableImpl(this.context.noref(), this.skdb, this.schema);
  }
}

export class TableImpl<R extends TJSON[]> implements Table<R> {
  protected context: Context;
  protected skdb: SKDBSync;
  protected schema: MirrorSchema;

  constructor(context: Context, skdb: SKDBSync, schema: MirrorSchema) {
    this.context = context;
    this.skdb = skdb;
    this.schema = schema;
  }

  getName(): string {
    return this.schema.name;
  }

  insert(entries: R[], update?: boolean | undefined): void {
    this.context.insert(this.getName(), entries, update);
  }

  update(entry: R, updates: JSONObject): void {
    this.context.update(
      this.getName(),
      this.schema.expected.map((c) => c.name),
      entry,
      updates,
    );
  }

  updateWhere(where: JSONObject, updates: JSONObject): void {
    this.context.updateWhere(this.getName(), where, updates);
  }

  select(select: JSONObject, columns?: string[]): JSONObject[] {
    return this.context.select(this.getName(), select, columns);
  }

  delete(entry: R): void {
    this.context.delete(
      this.getName(),
      this.schema.expected.map((c) => c.name),
      entry,
    );
  }

  deleteWhere(where: JSONObject): void {
    this.context.deleteWhere(this.getName(), where);
  }

  watch = (update: (rows: JSONObject[]) => void) => {
    const query = `SELECT * FROM "${this.getName()}"`;
    return this.skdb.watch(query, {}, update);
  };

  watchChanges = (
    init: (rows: JSONObject[]) => void,
    update: (added: JSONObject[], removed: JSONObject[]) => void,
  ) => {
    const query = `SELECT * FROM "${this.getName()}"`;
    return this.skdb.watchChanges(query, {}, init, update);
  };
}

export class SKStoreImpl implements SKStore {
  private context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  multimap<
    K1 extends TJSON,
    V1 extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
  >(mappings: Mapping<K1, V1, K2, V2>[]): EHandle<K2, V2> {
    const eagerHdl = this.context.multimap(metadata(1), mappings);
    return new EHandleImpl<K2, V2>(this.context, eagerHdl);
  }

  multimapReduce<
    K1 extends TJSON,
    V1 extends TJSON,
    K2 extends TJSON,
    V2 extends TJSON,
    V3 extends TJSON,
  >(
    mappings: Mapping<K1, V1, K2, V2>[],
    accumulator: Accumulator<V2, V3>,
  ): EHandle<K2, V3> {
    const eagerHdl = this.context.multimapReduce(
      metadata(1),
      mappings,
      accumulator,
    );
    return new EHandleImpl<K2, V3>(this.context, eagerHdl);
  }

  lazy<K extends TJSON, V extends TJSON>(
    compute: (selfHdl: LHandle<K, V>, key: K) => Opt<V>,
  ): LHandle<K, V> {
    const lazyHdl = this.context.lazy(metadata(1), compute);
    return new LHandleImpl<K, V>(this.context, lazyHdl);
  }

  asyncLazy<K extends TJSON, V extends TJSON, P extends TJSON, M extends TJSON>(
    get: (key: K) => P,
    call: (key: K, params: P) => Promise<AValue<V, M>>,
  ): LHandle<K, Loadable<V, M>> {
    const lazyHdl = this.context.asyncLazy<K, V, P, M>(metadata(1), get, call);
    return new LHandleImpl<K, Loadable<V, M>>(this.context, lazyHdl);
  }

  jsonExtract(value: JSONObject, pattern: string): TJSON[] {
    return this.context.jsonExtract(value, pattern);
  }

  log(...objects: TJSON[]): void {
    const toLog = objects.map((object) => {
      if (object === null) {
        return null;
      } else if (
        typeof object == "object" &&
        (("__isArrayProxy" in object && object.__isArrayProxy) ||
          ("__isObjectProxy" in object && object.__isObjectProxy)) &&
        "clone" in object
      ) {
        return (object as any).clone();
      } else {
        return object;
      }
    });
    console.log(...toLog);
  }
}

export class SKStoreFactoryImpl implements SKStoreFactory {
  private context: () => Context;
  private create: (init: () => void) => void;
  private createSync: (
    dbName?: string,
    asWorker?: boolean,
  ) => Promise<SKDBSync>;

  constructor(
    context: () => Context,
    create: (init: () => void) => void,
    createSync: (dbName?: string, asWorker?: boolean) => Promise<SKDBSync>,
  ) {
    this.context = context;
    this.create = create;
    this.createSync = createSync;
  }

  getName = () => "SKStore";

  runSKStore = async (
    init: (skstore: SKStore, ...tables: TableHandle<TJSON[]>[]) => void,
    tablesSchema: MirrorSchema[],
    connect: boolean = true,
  ): Promise<Table<TJSON[]>[]> => {
    let context = this.context();
    let skdb = await this.createSync();
    const tables = mirror(context, skdb, connect, ...tablesSchema);
    const skstore = new SKStoreImpl(context);
    this.create(() => init(skstore, ...tables));
    return tables.map((t) => (t as TableHandleImpl<TJSON[]>).toTable());
  };
}

/**
 * Mirror table from skdb with a specific filter
 * @param context
 * @param skdb - the database to work with
 * @param tables - tables the mirroring info
 * @returns - the mirrors table handles
 */
export function mirror(
  context: Context,
  skdb: SKDBSync,
  connect: boolean,
  ...tables: MirrorSchema[]
): TableHandle<TJSON[]>[] {
  if (connect) {
    skdb.mirror(...toMirrorDefinitions(...tables));
  } else {
    /*
    console.log("Warning:");
    console.log("\tThe mirror tables filter are not applied.");
    console.log(
      "\tThe produced data will be lost as soon as the process shutdown.",
    );
    */
    context.createTables(tables);
  }
  return tables.map((table) => new TableHandleImpl(context, skdb, table));
}

function toColumn(column: ColumnSchema): string {
  let res = `${column.name} ${column.type}`;
  if (column.notnull) {
    res += " NOT NULL";
  }
  if (column.primary) {
    res += " PRIMARY KEY";
  }
  return res;
}

function toColumns(columns: ColumnSchema[]): string {
  return `(${columns.map(toColumn).join(",")})`;
}

function toMirrorDefinition(table: MirrorSchema): MirrorDefn {
  return {
    table: table.name,
    expectedColumns: toColumns(table.expected),
    filterExpr: table.filter ? table.filter.filter : undefined,
    filterParams:
      table.filter && table.filter.params
        ? toParams(table.filter.params)
        : undefined,
  };
}

function toMirrorDefinitions(...tables: MirrorSchema[]): MirrorDefn[] {
  return tables.map(toMirrorDefinition);
}

function toParams(params: JSONObject): Params {
  let res: Record<string, string | number | boolean> = {};
  Object.keys(params).forEach((key: keyof JSONObject) => {
    const v = params[key];
    if (typeof v == "string") {
      res[key] = v;
    } else if (typeof v == "number") {
      res[key] = v;
    } else if (typeof v == "boolean") {
      res[key] = v;
    } else {
      res[key] = JSON.stringify(v);
    }
  });
  return res;
}
