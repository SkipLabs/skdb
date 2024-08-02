// prettier-ignore
import { runUrl, type ModuleInit } from "#std/sk_types.js";
import type {
  SKStore,
  SKStoreFactory,
  ColumnSchema,
  MirrorSchema,
  TableHandle,
  Table,
  TTableHandle,
  TTable,
  TJSON,
  JSONObject,
  Accumulator,
} from "./skstore_api.js";

export type {
  SKStore,
  TJSON,
  TableHandle,
  Table,
  MirrorSchema,
  JSONObject,
  TTableHandle,
  TTable,
  ColumnSchema,
  Accumulator,
};

export {
  Sum,
  Min,
  Max,
  schema,
  ctext,
  cinteger,
  cfloat,
  cjson,
} from "./skstore_utils.js";

var modules: ModuleInit[];
/*--MODULES--*/

async function wasmUrl(): Promise<URL> {
  //@ts-ignore
  if (import.meta.env || import.meta.webpack) {
    //@ts-ignore
    return await import("./skstore.wasm?url");
  }

  return new URL("./skstore.wasm", import.meta.url);
}

export async function createSKStore(
  init: (skstore: SKStore, ...tables: TableHandle<TJSON[]>[]) => void,
  tables: MirrorSchema[],
  connect: boolean = true,
): Promise<Table<TJSON[]>[]> {
  let data = await runUrl(wasmUrl, modules, [], "SKDB_factory");
  const factory = data.environment.shared.get("SKStore") as SKStoreFactory;
  return factory.runSKStore(init, tables, connect);
}
