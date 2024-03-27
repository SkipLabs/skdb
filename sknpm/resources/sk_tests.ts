import { run, type ModuleInit } from "./sk_types.js";

var modules: ModuleInit[];
/*--MODULES--*/

const wasmurl = new URL("./test.wasm", import.meta.url);

export async function load() {
  let data = await run(wasmurl, modules, []);
  return data.main;
}
