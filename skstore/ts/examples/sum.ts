import type { SKStore, TableHandle } from "skstore";
import { type ReactiveStorage, main } from "./utils.js";
import { integer, schema } from "skstore";

class MyStorage implements ReactiveStorage {
  schema = () => {
    console.log("## INPUTS");
    console.log("  input1 (id INTEGER, value INTEGER)");
    console.log("  input2 (id INTEGER, value INTEGER)");
    console.log("## OUTPUT");
    console.log("  output (id INTEGER, value INTEGER)");
    console.log("##");
    return [
      schema("input1", [integer("id", true), integer("v")]),
      schema("input2", [integer("id", true), integer("v")]),
      schema("output", [integer("id", true), integer("v")]),
    ];
  };
  initReactiveFlow = (
    _store: SKStore,
    input1: TableHandle<[number, number]>,
    input2: TableHandle<[number, number]>,
    output: TableHandle<[number, number]>,
  ) => {
    const eager1 = input1.map((row, _occ) => {
      return Array([row[0], row[1]]);
    });
    const eager2 = input2.map((row, _occ) => {
      return Array([row[0], row[1]]);
    });
    const eager3 = eager1.map((key, it) => {
      const v = it.first();
      const ev = eager2.maybeGet(key);
      if (ev !== null) {
        return Array([key, v + (ev ?? 0)]);
      }
      return Array();
    });
    eager3.mapTo(output, (key, it) => {
      return [key, it.first()];
    });
  };
}

await main(new MyStorage(), false, [
  [
    "watch output",
    "insert input1 [[1, 2]]",
    "insert input2 [[1, 3]]",
    'delete input1 {"id":1}',
    "insert input1 [[1, 4], [2,6]]",
    "insert input2 [[2, 0]]",
    'update input1 {"update":{"v":8},"where":{"id":1}}',
    'select output {"columns":["id","v"],"where":{}}',
  ],
]);
