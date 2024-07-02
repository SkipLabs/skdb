import { test, expect } from "@playwright/test";
import type { SKStore, TJSON, TableHandle, MirrorSchema, Table } from "skstore";
import { Sum, createSKStore, integer, schema, text } from "skstore";

function check(name: String, got: TJSON, expected: TJSON): void {
  expect([name, got]).toEqual([name, expected]);
}

export type Test = {
  name: string;
  schema: MirrorSchema[];
  init: (skstore: SKStore, ...tables: any[]) => void;
  run: (...tables: any[]) => void;
  error?: (err: any) => void;
};

//// testMap1

function testMap1Init(
  _skstore: SKStore,
  input: TableHandle<[number, number]>,
  output: TableHandle<[number, number]>,
) {
  const eager1 = input.map((entry, _occ) => {
    return Array([entry[0], entry[1] + 2]);
  });
  eager1.mapTo(output, (key, it) => {
    return [key, it.first()];
  });
}

function testMap1Run(input: Table<TJSON[]>, output: Table<TJSON[]>) {
  input.insert([[1, 10]], true);
  check("testMap1", output.select({ id: 1 }, ["value"]), [{ value: 12 }]);
}

//// testMap2

function testMap2Init(
  _skstore: SKStore,
  input1: TableHandle<[number, string]>,
  input2: TableHandle<[number, string]>,
  output: TableHandle<[number, number]>,
) {
  const eager1 = input1.map((row, _occ) => {
    return Array([row[0], parseInt(row[1])]);
  });
  const eager2 = input2.map((row, _occ) => {
    return Array([row[0], parseInt(row[1])]);
  });
  const eager3 = eager1.map<number, number>((key, it) => {
    const v = it.first();
    const ev = eager2.maybeGet(key);
    return Array([key, v + (ev ?? 0)]);
  });
  eager3.mapTo(output, (key: number, it) => {
    return [key, it.first()];
  });
}

function testMap2Run(
  input1: Table<[number, string]>,
  input2: Table<[number, string]>,
  output: Table<[number, number]>,
) {
  input1.insert([[1, "10"]], true);
  input2.insert([[1, "20"]], true);
  check("testMap2Init", output.select({ id: 1 }, ["value"]), [{ value: 30 }]);
  input1.insert([[2, "3"]], true);
  input2.insert([[2, "7"]], true);
  check("testMap2Insert", output.select({}, ["value"]), [
    { value: 10 },
    { value: 30 },
  ]);
}

//// testSize

function testSizeInit(
  _skstore: SKStore,
  input: TableHandle<[number, number]>,
  size: TableHandle<[number]>,
  output: TableHandle<[number, number]>,
) {
  const eager1 = input.map((row, _occ) => {
    return Array([row[0], row[1]]);
  });
  const eager2 = size.map((row, _occ) => {
    if (row[0] == 0) return Array([row[0], eager1.size()]);
    return Array();
  });
  eager2.mapTo(output, (key, it) => {
    return [key, it.first()];
  });
}

function testSizeRun(
  input: Table<[number, number]>,
  size: Table<[number]>,
  output: Table<[number, number]>,
) {
  size.insert([[0]]);
  check("testSizeInit", output.select({ id: 0 }, ["value"]), [{ value: 0 }]);
  input.insert([
    [1, 10],
    [2, 5],
  ]);
  check("testSizeInsert", output.select({ id: 0 }, ["value"]), [{ value: 2 }]);
  input.deleteWhere({ id: 1 });
  check("testSizeRemove", output.select({ id: 0 }, ["value"]), [{ value: 1 }]);
}

//// testLazy

function testLazyInit(
  skstore: SKStore,
  input: TableHandle<[number, number]>,
  output: TableHandle<[number, number]>,
) {
  const eager1 = input.map((row, _occ) => {
    return Array([row[0], row[1]]);
  });
  const lazy = skstore.lazy<number, number>((_self, key) => {
    const v = eager1.maybeGet(key);
    return (v ?? 0) + 2;
  });
  const eager2 = eager1.map((key, it) => {
    return Array([key, lazy.get(key) - it.first()]);
  });
  eager2.mapTo(output, (key: number, it) => {
    return [key, it.first()];
  });
}

function testLazyRun(
  input: Table<[number, number]>,
  output: Table<[number, number]>,
) {
  input.insert([
    [0, 10],
    [1, 20],
  ]);
  check("testLazyInit", output.select({ id: [0, 1] }, ["value"]), [
    { value: 2 },
    { value: 2 },
  ]);
  input.insert([[2, 4]]);
  check("testLazyInit", output.select({ id: [0, 1, 2] }, ["value"]), [
    { value: 2 },
    { value: 2 },
    { value: 2 },
  ]);
  input.deleteWhere({ id: 2 });
  check("testLazyInit", output.select({ id: [0, 1, 2] }, ["id", "value"]), [
    { id: 0, value: 2 },
    { id: 1, value: 2 },
  ]);
}

//// testMapReduce

function testMapReduceInit(
  _skstore: SKStore,
  input: TableHandle<[number, number]>,
  output: TableHandle<[number, number]>,
) {
  const eager1 = input.map((row, _occ) => {
    return Array([row[0], row[1]]);
  });
  const eager2 = eager1.mapReduce((key, it) => {
    return Array([key % 2, it.first()]);
  }, new Sum());
  eager2.mapTo(output, (key, it) => {
    return [key, it.first()];
  });
}

function testMapReduceRun(
  input: Table<[number, number]>,
  output: Table<[number, number]>,
) {
  input.insert([
    [0, 1],
    [1, 1],
    [2, 1],
  ]);
  check("testMapReduceInit", output.select({}, ["id", "v"]), [
    { id: 0, v: 2 },
    { id: 1, v: 1 },
  ]);
  input.insert([[3, 2]]);
  check("testMapReduceInsert", output.select({}, ["id", "v"]), [
    { id: 0, v: 2 },
    { id: 1, v: 3 },
  ]);
  input.update([0, 1], { v: 2 });
  check("testMapReduceUpdate", output.select({}, ["id", "v"]), [
    { id: 0, v: 3 },
    { id: 1, v: 3 },
  ]);
  input.deleteWhere({ id: 3 });
  check("testMapReduceRemove", output.select({}, ["id", "v"]), [
    { id: 0, v: 3 },
    { id: 1, v: 1 },
  ]);
}

//// testMultiMap1

function testMultiMap1Init(
  skstore: SKStore,
  input1: TableHandle<[number, string]>,
  input2: TableHandle<[number, string]>,
  output: TableHandle<[number, number, number]>,
) {
  const eager1 = input1.map((row, _occ) => {
    return Array([row[0], parseInt(row[1])]);
  });
  const eager2 = input2.map((row, _occ) => {
    return Array([row[0], parseInt(row[1])]);
  });
  const eager3 = skstore.multimap([
    [
      eager1,
      (key, it) => {
        const v = it.first();
        return Array([[0, key], v]);
      },
    ],
    [
      eager2,
      (key, it) => {
        const v = it.first();
        return Array([[1, key], v]);
      },
    ],
  ]);
  eager3.mapTo(output, (key, it) => {
    return [key[0], key[1], it.first()];
  });
}

function testMultiMap1Run(
  input1: Table<[number, number]>,
  input2: Table<[number, number]>,
  output: Table<[number, number, number]>,
) {
  input1.insert([[1, 10]], true);
  input2.insert([[1, 20]], true);
  check("testMultiMapInit", output.select({}, ["src", "id", "v"]), [
    { src: 0, id: 1, v: 10 },
    { src: 1, id: 1, v: 20 },
  ]);
  input1.insert([[2, 3]], true);
  input2.insert([[2, 7]], true);
  check("testMultiMapInsert", output.select({}, ["src", "id", "v"]), [
    { src: 0, id: 1, v: 10 },
    { src: 0, id: 2, v: 3 },
    { src: 1, id: 1, v: 20 },
    { src: 1, id: 2, v: 7 },
  ]);
  input1.deleteWhere({ id: 1 });
  check("testMultiMapDelete", output.select({}, ["src", "id", "v"]), [
    { src: 0, id: 2, v: 3 },
    { src: 1, id: 1, v: 20 },
    { src: 1, id: 2, v: 7 },
  ]);
}

//// testMultiMapReduce

function testMultiMapReduceInit(
  skstore: SKStore,
  input1: TableHandle<[number, string]>,
  input2: TableHandle<[number, string]>,
  output: TableHandle<[number, number]>,
) {
  const eager1 = input1.map((row, _occ) => {
    return Array([row[0], parseInt(row[1])]);
  });
  const eager2 = input2.map((row, _occ) => {
    return Array([row[0], parseInt(row[1])]);
  });
  const eager3 = skstore.multimapReduce(
    [
      [
        eager1,
        (key, it) => {
          const v = it.first();
          return Array([key, v]);
        },
      ],
      [
        eager2,
        (key, it) => {
          const v = it.first();
          return Array([key, v]);
        },
      ],
    ],
    new Sum(),
  );
  eager3.mapTo(output, (key, it) => {
    return [key, it.first()];
  });
}

function testMultiMapReduceRun(
  input1: Table<[number, number]>,
  input2: Table<[number, number]>,
  output: Table<[number, number]>,
) {
  input1.insert([[1, 10]], true);
  input2.insert([[1, 20]], true);
  check("testMultiMapReduceInit", output.select({}, ["id", "v"]), [
    { id: 1, v: 30 },
  ]);
  input1.insert([[2, 3]], true);
  input2.insert([[2, 7]], true);
  check("testMultiMapReduceInsert", output.select({}, ["id", "v"]), [
    { id: 1, v: 30 },
    { id: 2, v: 10 },
  ]);
  input1.deleteWhere({ id: 1 });
  check("testMultiMapReduceDelete", output.select({}, ["id", "v"]), [
    { id: 1, v: 20 },
    { id: 2, v: 10 },
  ]);
}

//// Tests

export const tests: Test[] = [
  {
    name: "testMap1",
    schema: [
      schema("input", [integer("id", true), integer("value")]),
      schema("output", [integer("id", true), integer("value")]),
    ],
    init: testMap1Init,
    run: testMap1Run,
  },
  {
    name: "testMap2",
    schema: [
      schema("input1", [integer("id", true), text("value")]),
      schema("input2", [integer("id", true), text("value")]),
      schema("output", [integer("id", true), integer("value")]),
    ],
    init: testMap2Init,
    run: testMap2Run,
  },
  {
    name: "testSize",
    schema: [
      schema("input", [integer("id", true), integer("value")]),
      schema("size", [integer("id", true)]),
      schema("output", [integer("id", true), integer("value")]),
    ],
    init: testSizeInit,
    run: testSizeRun,
  },
  {
    name: "testLazy",
    schema: [
      schema("input", [integer("id", true), integer("value")]),
      schema("output", [integer("id", true), integer("value")]),
    ],
    init: testLazyInit,
    run: testLazyRun,
  },
  {
    name: "testMapReduce",
    schema: [
      schema("input", [integer("id", true), integer("v")]),
      schema("output", [integer("id", true), integer("v")]),
    ],
    init: testMapReduceInit,
    run: testMapReduceRun,
  },
  {
    name: "testMultiMap1",
    schema: [
      schema("input1", [integer("id", true), integer("value")]),
      schema("input2", [integer("id", true), integer("value")]),
      schema("output", [integer("src"), integer("id"), integer("v")]),
    ],
    init: testMultiMap1Init,
    run: testMultiMap1Run,
  },
  {
    name: "testMultiMapReduce",
    schema: [
      schema("input1", [integer("id", true), integer("value")]),
      schema("input2", [integer("id", true), integer("value")]),
      schema("output", [integer("id", true), integer("v")]),
    ],
    init: testMultiMapReduceInit,
    run: testMultiMapReduceRun,
  },
];

function run(t: Test) {
  test(t.name, async ({ page }) => {
    let tables: Table<TJSON[]>[] = [];
    try {
      tables = await createSKStore(t.init, t.schema, false);
    } catch (err: any) {
      if (t.error) t.error(err);
      else console.error(err);
    }

    if (tables.length > 0) t.run(...tables);
  });
}

export function runAll() {
  tests.forEach(run);
}
