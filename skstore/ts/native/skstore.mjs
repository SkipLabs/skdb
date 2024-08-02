import { createRequire } from "node:module";
const requireFn = createRequire(import.meta.url);

const addon = requireFn("./build/Release/skstore.node");

export const cinteger = addon.cinteger;
export const cfloat = addon.cfloat;
export const ctext = addon.ctext;
export const cjson = addon.cjson;
export const schema = addon.schema;

export { Sum, Min, Max, equals } from "./skstore_utils.mjs";

export async function createSKStore(init, tables, connect = true) {
  return addon.createSKStore(init, tables, connect);
}
