// prettier-ignore
import type { ptr, Opt, App } from "#std/sk_types.js";
import type { JSONObject, TJSON } from "skstore_skjson.js";
import type {
  Accumulator,
  EHandle,
  LHandle,
  Context,
  Mapper,
  OutputMapper,
  TableHandle,
  Lazy,
  SKStore,
  SKStoreFactory,
  Mapping,
  MirrorSchema,
  ColumnSchema,
  EntryMapper,
  Table,
} from "./skstore_api.js";

import { metadata } from "./skstore_api.js";
// prettier-ignore
import type { MirrorDefn, Params, SKDBShared, SKDBSync } from "#skdb/skdb_types.js";

type Query = { query: string; params?: JSONObject };

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
    const query = toInsertQuery(this.getName(), entries, update);
    const params = query.params ? toParams(query.params) : undefined;
    this.skdb.exec(query.query, params);
  }

  update(entry: R, updates: JSONObject): void {
    const query = toUpdateQuery(
      this.getName(),
      this.schema.expected,
      entry,
      updates,
    );
    this.skdb.exec(
      query.query,
      query.params ? toParams(query.params) : undefined,
    );
  }

  updateWhere(where: JSONObject, updates: JSONObject): void {
    const query = toUpdateWhereQuery(this.getName(), where, updates);
    this.skdb.exec(
      query.query,
      query.params ? toParams(query.params) : undefined,
    );
  }

  select(select: JSONObject, colmuns?: string[]): JSONObject[] {
    const query = toSelectQuery(this.getName(), select, colmuns);
    return this.skdb.exec(
      query.query,
      query.params ? toParams(query.params) : undefined,
    ) as JSONObject[];
  }

  delete(entry: R): void {
    const query = toDeleteQuery(this.getName(), this.schema.expected, entry);
    this.skdb.exec(
      query.query,
      query.params ? toParams(query.params) : undefined,
    );
  }

  deleteWhere(where: JSONObject): void {
    const query = toDeleteWhereQuery(this.getName(), where);
    this.skdb.exec(
      query.query,
      query.params ? toParams(query.params) : undefined,
    );
  }
  watch = (update: (rows: JSONObject[]) => void) => {
    const query = toSelectQuery(this.getName(), {});
    return this.skdb.watch(
      query.query,
      query.params ? toParams(query.params) : {},
      update,
    );
  };

  watchChanges = (
    init: (rows: JSONObject[]) => void,
    update: (added: JSONObject[], removed: JSONObject[]) => void,
  ) => {
    const query = toSelectQuery(this.getName(), {});
    return this.skdb.watchChanges(
      query.query,
      query.params ? toParams(query.params) : {},
      init,
      update,
    );
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

  lazy<K extends TJSON, V extends TJSON>(fn: Lazy<K, V>): LHandle<K, V> {
    const lazyHdl = this.context.lazy(metadata(1), fn);
    return new LHandleImpl<K, V>(this.context, lazyHdl);
  }
}

export class SKStoreFactoryImpl implements SKStoreFactory {
  private context: () => Context;
  private create: (init: () => void) => void;

  constructor(context: () => Context, create: (init: () => void) => void) {
    this.context = context;
    this.create = create;
  }

  getName = () => "SKStore";

  runSKStore = async (
    init: (skstore: SKStore, ...tables: TableHandle<TJSON[]>[]) => void,
    app: App,
    tablesSchema: MirrorSchema[],
    connect: boolean = true,
  ): Promise<Table<TJSON[]>[]> => {
    let context = this.context();
    let skdb = await (
      app.environment.shared.get("SKDB") as SKDBShared
    ).createSync();
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
    tables.forEach((table) => {
      const query = create(table);
      skdb.exec(query.query, query.params ? toParams(query.params) : undefined);
    });
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

function create(table: MirrorSchema): Query {
  const query = `CREATE TABLE IF NOT EXISTS "${table.name}" ${toColumns(
    table.expected,
  )};`;
  return { query };
}

function toValues(entry: TJSON[], prefix: string = ""): Query {
  let exprs: string[] = [];
  let params: JSONObject = {};
  for (let i = 0; i < entry.length; i++) {
    const field = entry[i];
    if (
      typeof field == "string" ||
      typeof field == "number" ||
      typeof field == "boolean"
    ) {
      params[prefix + i] = field;
    } else {
      params[prefix + i] = JSON.stringify(field);
    }
    exprs.push(`@${prefix + i}`);
  }
  return {
    query: exprs.join(" , "),
    params,
  };
}

function toWhere(
  columns: ColumnSchema[],
  entry: TJSON[],
  prefix: string = "",
): Query {
  if (columns.length != entry.length) throw new Error("Invalid entry type.");
  let exprs: string[] = [];
  let params: JSONObject = {};
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    const field = entry[i];
    if (Array.isArray(field)) {
      const inVal: string[] = [];
      for (let idx = 0; idx < field.length; idx++) {
        const pName = prefix + idx + "_" + column.name;
        params[pName] = field[idx];
        inVal.push(`@${pName}`);
      }
      exprs.push(`${column.name} IN (${inVal.join(", ")})`);
    } else {
      const pName = prefix + column.name;
      params[pName] = field;
      exprs.push(`${column.name} = @${pName}`);
    }
  }
  return {
    query: exprs.join(" AND "),
    params,
  };
}

function toSets(update: JSONObject, prefix: string = ""): Query {
  let exprs: string[] = [];
  let params: JSONObject = {};
  Object.keys(update).forEach((column: keyof JSONObject) => {
    const field = update[column];
    params[prefix + column] = field;
    exprs.push(`${column} = @${prefix + column}`);
  });
  return {
    query: exprs.join(" , "),
    params,
  };
}

function toSelectWhere(select: JSONObject, prefix: string = ""): Query {
  const keys = Object.keys(select);
  if (keys.length <= 0) return { query: "true" };
  let exprs: string[] = [];
  let params: JSONObject = {};
  keys.forEach((column: keyof JSONObject) => {
    const field = select[column];
    if (Array.isArray(field)) {
      const inVal: string[] = [];
      for (let idx = 0; idx < field.length; idx++) {
        const pName = prefix + idx + "_" + column;
        params[pName] = field[idx];
        inVal.push(`@${pName}`);
      }
      exprs.push(`${column} IN (${inVal.join(", ")})`);
    } else {
      const pName = prefix + column;
      params[pName] = field;
      exprs.push(`${column} = @${pName}`);
    }
  });
  return {
    query: exprs.join(" AND "),
    params,
  };
}

function toParams(params: JSONObject): Params {
  let res: Params = {};
  Object.keys(params).forEach((key) => {
    const v = params[key];
    if (typeof v == "string" || typeof v == "number" || typeof v == "boolean") {
      res[key] = v;
    } else {
      res[key] = JSON.stringify(v);
    }
  });
  return res;
}

function toUpdateQuery(
  name: string,
  columns: ColumnSchema[],
  entry: TJSON[],
  updates: JSONObject,
): Query {
  const where = toWhere(columns, entry, "w_");
  const sets = toSets(updates, "u_");
  const query = `UPDATE "${name}" SET ${sets.query} WHERE ${where.query};`;
  return { query, params: { ...sets.params, ...where.params } };
}

function toSelectQuery(
  name: string,
  select: JSONObject,
  columns?: string[],
): Query {
  const where = toSelectWhere(select, "s_");
  const strColumns = columns ? columns.join(", ") : "*";
  const orderBy = columns
    ? " ORDER BY " + columns.map((n) => n + " ASC").join(", ")
    : "";
  const query = `SELECT ${strColumns} FROM "${name}" WHERE ${where.query}${orderBy};`;
  return { query, params: where.params };
}

function toInsertQuery(
  name: string,
  entries: TJSON[][],
  update?: boolean | undefined,
): Query {
  let params: JSONObject = {};
  const values = entries.map((vs, idx) => {
    const q = toValues(vs, "v" + idx + "_");
    params = { ...params, ...q.params };
    return q;
  });
  const strValue = values.map((v) => `(${v.query})`).join(",");
  const query = `INSERT ${
    update ? "OR REPLACE " : ""
  }INTO "${name}" VALUES ${strValue};`;
  return { query, params };
}

function toDeleteQuery(
  name: string,
  columns: ColumnSchema[],
  entry: TJSON[],
): Query {
  const where = toWhere(columns, entry);
  const query = `DELETE FROM "${name}" WHERE ${where.query};`;
  return { query, params: where.params };
}

function toDeleteWhereQuery(name: string, where: JSONObject): Query {
  const qWhere = toSelectWhere(where, "d_");
  const query = `DELETE FROM "${name}" WHERE ${qWhere.query};`;
  return { query, params: qWhere.params };
}

function toUpdateWhereQuery(
  name: string,
  where: JSONObject,
  updates: JSONObject,
): Query {
  const qWhere = toSelectWhere(where, "uw_");
  const sets = toSets(updates, "us_");
  const query = `UPDATE "${name}" SET ${sets.query} WHERE ${qWhere.query};`;
  return { query, params: { ...sets.params, ...qWhere.params } };
}
