import { expect } from "@playwright/test";
import { SKDB, SKDBTable } from "skdb";

type Test = {
  name: string;
  fun: (skdb: SKDB) => Promise<any>;
  check: (res: any) => void;
};

function n(name: string, asWorker: boolean) {
  if (asWorker) return name + " in Worker";
  return name;
}

const watchTests: (asWorker: boolean) => Test[] = (asWorker: boolean) => {
  let wn = (name: string, asWorker: boolean) => {
    return n("Watch: " + name, asWorker);
  };
  return [
    {
      name: wn("Test on empty table", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1;",
          {},
          (changes: Array<any>) => result.push(changes),
        );
        await handle.close();
        return result;
      },
      check: (res) => {
        let expected = [[]];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Test reactive query updated on insert and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1;",
          {},
          (changes: Array<any>) => result.push(changes),
        );
        await skdb.insert("t1", [14, "bar", 44.5]);
        await handle.close();
        await skdb.insert("t1", [15, "foo", 46.8]);
        return result;
      },
      check: (res) => {
        let expected = [
          [{ a: 13, b: "9", c: 42.1 }],
          [
            { a: 13, b: "9", c: 42.1 },
            { a: 14, b: "bar", c: 44.5 },
          ],
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Test reactive query updated on update and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1;",
          {},
          (changes: Array<any>) => result.push(changes),
        );
        await skdb.exec("update t1 set b = 'foo' where a = 13");
        await handle.close();
        await skdb.exec("update t1 set b = 'bar' where a = 13");
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [{ a: 13, b: "9", c: 42.1 }],
          [{ a: 13, b: "foo", c: 42.1 }],
        ]);
      },
    },
    {
      name: wn(
        "Test reactive query updated on delete and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [14, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1;",
          {},
          (changes: Array<any>) => result.push(changes),
        );
        await skdb.exec("delete from t1 where a = 13");
        await handle.close();
        await skdb.exec("delete from t1 where a = 14");
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [
            { a: 13, b: "9", c: 42.1 },
            { a: 14, b: "9", c: 42.1 },
          ],
          [{ a: 14, b: "9", c: 42.1 }],
        ]);
      },
    },
    {
      name: wn("Test reactive query is not n^2", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [14, "9", 42.1]);
        await skdb.insert("t1", [15, "9", 42.1]);
        await skdb.insert("t1", [16, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1 WHERE a > 13;",
          {},
          (changes: Array<any>) => result.push(changes),
        );
        // update all 4 rows. we're checking this doesn't result in 16
        // objects built in js.
        await skdb.exec("update t1 set b = 'foo';");
        await handle.close();
        await skdb.exec("update t1 set b = 'bar';");
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [
            { a: 14, b: "9", c: 42.1 },
            { a: 15, b: "9", c: 42.1 },
            { a: 16, b: "9", c: 42.1 },
          ],
          [
            { a: 14, b: "foo", c: 42.1 },
            { a: 15, b: "foo", c: 42.1 },
            { a: 16, b: "foo", c: 42.1 },
          ],
        ]);
      },
    },
    {
      name: wn(
        "Test filtering reactive query updated on insert and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b INTEGER, c INTEGER);");
        await skdb.insert("t1", [13, 9, 42]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1 where a = 13 or a = 14;",
          {},
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.insert("t1", [14, 9, 44]);
        await handle.close();
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [{ a: 13, b: 9, c: 42 }],
          [
            { a: 13, b: 9, c: 42 },
            { a: 14, b: 9, c: 44 },
          ],
        ]);
      },
    },
    {
      name: wn(
        "Test filtering reactive query updated on update and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1 where a = 13 or a = 14;",
          {},
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.exec("update t1 set b = 'foo' where a = 13");
        await handle.close();
        await skdb.exec("update t1 set b = 'bar' where a = 13");
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [{ a: 13, b: "9", c: 42.1 }],
          [{ a: 13, b: "foo", c: 42.1 }],
        ]);
      },
    },
    {
      name: wn(
        "Test filtering reactive query updated on delete and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [14, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1 where a = 13 or a = 14;",
          {},
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.exec("delete from t1 where a = 13");
        await handle.close();
        await skdb.exec("delete from t1 where a = 14");
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [
            { a: 13, b: "9", c: 42.1 },
            { a: 14, b: "9", c: 42.1 },
          ],
          [{ a: 14, b: "9", c: 42.1 }],
        ]);
      },
    },
    {
      name: wn(
        "Complex reactive query updated on insert, update, delete, then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          "create table if not exists todos (id integer primary key, text text, completed integer);",
        );
        await skdb.exec(
          [
            "insert into todos values (0, 'foo', 0);",
            "insert into todos values (1, 'foo', 0);",
            "insert into todos values (2, 'foo', 1);",
            "insert into todos values (3, 'foo', 0);",
          ].join("\n"),
        );
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "select completed, count(*) as n from (select * from todos where id > 0) group by completed",
          {},
          (changes) => {
            result.push(changes);
          },
        );

        await skdb.exec("insert into todos values (4, 'foo', 1);");
        await skdb.exec("update todos set text = 'baz' where id = 0;");

        await handle.close();
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [
            { completed: 0, n: 2 },
            { completed: 1, n: 1 },
          ],
          [
            { completed: 0, n: 2 },
            { completed: 1, n: 2 },
          ],
        ]);
      },
    },
    {
      name: wn("Reactive queries support params", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          [
            "create table if not exists test (x integer primary key, y text, z float, w integer);",
            "insert into test values (0, 'foo', 1.2, 42);",
          ].join("\n"),
        );
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "select w from test where x = @x and y = @y and z = @zed",
          new Map<string, string | number>([
            ["x", 0],
            ["y", "foo"],
            ["zed", 1.2],
          ]),
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.exec("update test set w = 21 where y = 'foo';");
        await handle.close();
        return result;
      },
      check: (res) => {
        expect(res).toEqual([[{ w: 42 }], [{ w: 21 }]]);
      },
    },
    {
      name: wn("Reactive queries support object params", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          [
            "create table if not exists test (x integer primary key, y text, z float, w integer);",
            "insert into test values (0, 'foo', 1.2, 42);",
          ].join("\n"),
        );
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "select w from test where x = @x and y = @y and z = @zed",
          { x: 0, y: "foo", zed: 1.2 },
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.exec("update test set w = 21 where y = 'foo';");
        await handle.close();
        return result;
      },
      check: (res) => {
        expect(res).toEqual([[{ w: 42 }], [{ w: 21 }]]);
      },
    },
    {
      name: wn(
        "A reactive query can be updated with new spliced arguments",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1 where a = 13;",
          {},
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.insert("t1", [14, "bar", 44.5]);
        await handle.close();
        handle = await skdb.watch(
          "SELECT * FROM t1 where a = 14;",
          {},
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.insert("t1", [15, "foo", 46.8]);
        await handle.close();
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [{ a: 13, b: "9", c: 42.1 }],
          [{ a: 14, b: "bar", c: 44.5 }],
        ]);
      },
    },
    {
      name: wn("A reactive query can be replaced with new params", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watch(
          "SELECT * FROM t1 where a = @a;",
          { a: 13 },
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.insert("t1", [14, "bar", 44.5]);
        await handle.close();
        handle = await skdb.watch(
          "SELECT * FROM t1 where a = @a;",
          { a: 14 },
          (changes) => {
            result.push(changes);
          },
        );
        await skdb.insert("t1", [15, "foo", 46.8]);
        await handle.close();
        return result;
      },
      check: (res) => {
        expect(res).toEqual([
          [{ a: 13, b: "9", c: 42.1 }],
          [{ a: 14, b: "bar", c: 44.5 }],
        ]);
      },
    },
    {
      name: wn(
        "Concurrent non-overlapping reactive queries can co-exist",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          [
            "CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);",
            "CREATE TABLE t2 (a INTEGER, b TEXT, c FLOAT);",
          ].join("\n"),
        );
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t2", [13, "9", 42.1]);

        let result1: Array<any> = [];
        let result2: Array<any> = [];

        let handle1 = await skdb.watch(
          "SELECT * FROM t1 where a = @a;",
          { a: 13 },
          (changes) => {
            result1.push(changes);
          },
        );
        let handle2 = await skdb.watch(
          "SELECT * FROM t2 where a = @a;",
          { a: 13 },
          (changes) => {
            result2.push(changes);
          },
        );

        await skdb.exec("update t1 set b = 'foo';");
        await skdb.exec("update t2 set b = 'bar';");

        await handle1.close();
        await handle2.close();

        return [result1, result2];
      },
      check: (res) => {
        expect(res).toEqual([
          [[{ a: 13, b: "9", c: 42.1 }], [{ a: 13, b: "foo", c: 42.1 }]],
          [[{ a: 13, b: "9", c: 42.1 }], [{ a: 13, b: "bar", c: 42.1 }]],
        ]);
      },
    },
    {
      name: wn(
        "Concurrent non-overlapping (same table) reactive queries can co-exist",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [15, "9", 42.1]);

        let result1: Array<any> = [];
        let result2: Array<any> = [];

        let handle1 = await skdb.watch(
          "SELECT * FROM t1 where a < @a;",
          { a: 15 },
          (changes) => {
            result1.push(changes);
          },
        );
        let handle2 = await skdb.watch(
          "SELECT * FROM t1 where a > @a;",
          { a: 13 },
          (changes) => {
            result2.push(changes);
          },
        );

        await skdb.exec("update t1 set b = 'foo';");

        await handle1.close();
        await handle2.close();

        return [result1, result2];
      },
      check: (res) => {
        expect(res).toEqual([
          [[{ a: 13, b: "9", c: 42.1 }], [{ a: 13, b: "foo", c: 42.1 }]],
          [[{ a: 15, b: "9", c: 42.1 }], [{ a: 15, b: "foo", c: 42.1 }]],
        ]);
      },
    },
    {
      name: wn(
        "Concurrent overlapping reactive queries can co-exist",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [14, "9", 42.1]);
        await skdb.insert("t1", [15, "9", 42.1]);

        let result1: Array<any> = [];
        let result2: Array<any> = [];

        let handle1 = await skdb.watch(
          "SELECT * FROM t1 where a < @a;",
          { a: 15 },
          (changes) => {
            result1.push(changes);
          },
        );
        let handle2 = await skdb.watch(
          "SELECT * FROM t1 where a > @a;",
          { a: 13 },
          (changes) => {
            result2.push(changes);
          },
        );

        await skdb.exec("update t1 set b = 'foo';");

        await handle1.close();
        await handle2.close();

        return [result1, result2];
      },
      check: (res) => {
        expect(res).toEqual([
          [
            [
              { a: 13, b: "9", c: 42.1 },
              { a: 14, b: "9", c: 42.1 },
            ],
            [
              { a: 13, b: "foo", c: 42.1 },
              { a: 14, b: "foo", c: 42.1 },
            ],
          ],
          [
            [
              { a: 14, b: "9", c: 42.1 },
              { a: 15, b: "9", c: 42.1 },
            ],
            [
              { a: 14, b: "foo", c: 42.1 },
              { a: 15, b: "foo", c: 42.1 },
            ],
          ],
        ]);
      },
    },
  ];
};

const watchChangesTests: (asWorker: boolean) => Test[] = (
  asWorker: boolean,
) => {
  let wn = (name: string, asWorker: boolean) => {
    return n("WatchChanges: " + name, asWorker);
  };
  return [
    {
      name: wn("Test on empty table", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await handle.close();
        return result;
      },
      check: (res) => {
        let expected = [{ init: [] }];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Test reactive query updated on insert and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.insert("t1", [14, "bar", 44.5]);
        await handle.close();
        await skdb.insert("t1", [15, "foo", 46.8]);
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [{ a: 13, b: "9", c: 42.1 }],
          },
          {
            added: [{ a: 14, b: "bar", c: 44.5 }],
            deleted: [],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Test reactive query updated on update and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.exec("update t1 set b = 'foo' where a = 13");
        await handle.close();
        await skdb.exec("update t1 set b = 'bar' where a = 13");
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [{ a: 13, b: "9", c: 42.1 }],
          },
          {
            added: [{ a: 13, b: "foo", c: 42.1 }],
            deleted: [{ a: 13, b: "9", c: 42.1 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Test reactive query updated on delete and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [14, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.exec("delete from t1 where a = 13");
        await handle.close();
        await skdb.exec("delete from t1 where a = 14");
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [
              { a: 13, b: "9", c: 42.1 },
              { a: 14, b: "9", c: 42.1 },
            ],
          },
          {
            added: [],
            deleted: [{ a: 13, b: "9", c: 42.1 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn("Test reactive query is not n^2", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [14, "9", 42.1]);
        await skdb.insert("t1", [15, "9", 42.1]);
        await skdb.insert("t1", [16, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1 WHERE a > 13;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        // update all 4 rows. we're checking this doesn't result in 16
        // objects built in js.
        await skdb.exec("update t1 set b = 'foo';");
        await handle.close();
        await skdb.exec("update t1 set b = 'bar';");
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [
              { a: 14, b: "9", c: 42.1 },
              { a: 15, b: "9", c: 42.1 },
              { a: 16, b: "9", c: 42.1 },
            ],
          },
          {
            added: [
              { a: 14, b: "foo", c: 42.1 },
              { a: 15, b: "foo", c: 42.1 },
              { a: 16, b: "foo", c: 42.1 },
            ],
            deleted: [
              { a: 14, b: "9", c: 42.1 },
              { a: 15, b: "9", c: 42.1 },
              { a: 16, b: "9", c: 42.1 },
            ],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Test filtering reactive query updated on insert and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b INTEGER, c INTEGER);");
        await skdb.insert("t1", [13, 9, 42]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1 where a = 13 or a = 14;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.insert("t1", [14, 9, 44]);
        await skdb.insert("t1", [15, 9, 46]);
        await handle.close();
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [{ a: 13, b: 9, c: 42 }],
          },
          {
            added: [{ a: 14, b: 9, c: 44 }],
            deleted: [],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Test filtering reactive query updated on update and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1 where a = 13 or a = 14;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.exec("update t1 set b = 'foo' where a = 13");
        await handle.close();
        await skdb.exec("update t1 set b = 'bar' where a = 13");
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [{ a: 13, b: "9", c: 42.1 }],
          },
          {
            added: [{ a: 13, b: "foo", c: 42.1 }],
            deleted: [{ a: 13, b: "9", c: 42.1 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Test filtering reactive query updated on delete and then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [14, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1 where a = 13 or a = 14;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.exec("delete from t1 where a = 13");
        await handle.close();
        await skdb.exec("delete from t1 where a = 14");
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [
              { a: 13, b: "9", c: 42.1 },
              { a: 14, b: "9", c: 42.1 },
            ],
          },
          {
            added: [],
            deleted: [{ a: 13, b: "9", c: 42.1 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Complex reactive query updated on insert, update, delete, then closed",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          "create table if not exists todos (id integer primary key, text text, completed integer);",
        );
        await skdb.exec(
          [
            "insert into todos values (0, 'foo', 0);",
            "insert into todos values (1, 'foo', 0);",
            "insert into todos values (2, 'foo', 1);",
            "insert into todos values (3, 'foo', 0);",
          ].join("\n"),
        );
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "select completed, count(*) as n from (select * from todos where id > 0) group by completed",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.exec("insert into todos values (4, 'foo', 1);");
        await skdb.exec("update todos set text = 'baz' where id = 0;");

        await handle.close();
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [
              { completed: 0, n: 2 },
              { completed: 1, n: 1 },
            ],
          },
          {
            added: [{ completed: 1, n: 2 }],
            deleted: [{ completed: 1, n: 1 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn("Reactive queries support params", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          [
            "create table if not exists test (x integer primary key, y text, z float, w integer);",
            "insert into test values (0, 'foo', 1.2, 42);",
          ].join("\n"),
        );
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "select w from test where x = @x and y = @y and z = @zed",
          new Map<string, string | number>([
            ["x", 0],
            ["y", "foo"],
            ["zed", 1.2],
          ]),
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.exec("update test set w = 21 where y = 'foo';");
        await handle.close();
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [{ w: 42 }],
          },
          {
            added: [{ w: 21 }],
            deleted: [{ w: 42 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn("Reactive queries support object params", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          [
            "create table if not exists test (x integer primary key, y text, z float, w integer);",
            "insert into test values (0, 'foo', 1.2, 42);",
          ].join("\n"),
        );
        let result: Array<any> = [];

        let handle = await skdb.watchChanges(
          "select w from test where x = @x and y = @y and z = @zed",
          { x: 0, y: "foo", zed: 1.2 },
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.exec("update test set w = 21 where y = 'foo';");
        await handle.close();
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [{ w: 42 }],
          },
          {
            added: [{ w: 21 }],
            deleted: [{ w: 42 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "A reactive query can be updated with new spliced arguments",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1 where a = 13;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.insert("t1", [14, "bar", 44.5]);
        await handle.close();
        handle = await skdb.watchChanges(
          "SELECT * FROM t1 where a = 14;",
          {},
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.insert("t1", [15, "foo", 46.8]);
        await handle.close();
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [{ a: 13, b: "9", c: 42.1 }],
          },
          {
            init: [{ a: 14, b: "bar", c: 44.5 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn("A reactive query can be replaced with new params", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        let result: Array<any> = [];
        let handle = await skdb.watchChanges(
          "SELECT * FROM t1 where a = @a;",
          { a: 13 },
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.insert("t1", [14, "bar", 44.5]);
        await handle.close();
        handle = await skdb.watchChanges(
          "SELECT * FROM t1 where a = @a;",
          { a: 14 },
          (rows: Array<any>) => {
            result.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result.push({ added: added, deleted: deleted });
          },
        );
        await skdb.insert("t1", [15, "foo", 46.8]);
        await handle.close();
        return result;
      },
      check: (res) => {
        let expected = [
          {
            init: [{ a: 13, b: "9", c: 42.1 }],
          },
          {
            init: [{ a: 14, b: "bar", c: 44.5 }],
          },
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Concurrent non-overlapping reactive queries can co-exist",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          [
            "CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);",
            "CREATE TABLE t2 (a INTEGER, b TEXT, c FLOAT);",
          ].join("\n"),
        );
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t2", [13, "9", 42.1]);

        let result1: Array<any> = [];
        let result2: Array<any> = [];
        let handle1 = await skdb.watchChanges(
          "SELECT * FROM t1 where a = @a;",
          { a: 13 },
          (rows: Array<any>) => {
            result1.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result1.push({ added: added, deleted: deleted });
          },
        );
        let handle2 = await skdb.watchChanges(
          "SELECT * FROM t2 where a = @a;",
          { a: 13 },
          (rows: Array<any>) => {
            result2.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result2.push({ added: added, deleted: deleted });
          },
        );
        await skdb.exec("update t1 set b = 'foo';");
        await skdb.exec("update t2 set b = 'bar';");

        await handle1.close();
        await handle2.close();

        return [result1, result2];
      },
      check: (res) => {
        let expected = [
          [
            {
              init: [{ a: 13, b: "9", c: 42.1 }],
            },
            {
              added: [{ a: 13, b: "foo", c: 42.1 }],
              deleted: [{ a: 13, b: "9", c: 42.1 }],
            },
          ],
          [
            {
              init: [{ a: 13, b: "9", c: 42.1 }],
            },
            {
              added: [{ a: 13, b: "bar", c: 42.1 }],
              deleted: [{ a: 13, b: "9", c: 42.1 }],
            },
          ],
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Concurrent non-overlapping (same table) reactive queries can co-exist",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [15, "9", 42.1]);

        let result1: Array<any> = [];
        let result2: Array<any> = [];
        let handle1 = await skdb.watchChanges(
          "SELECT * FROM t1 where a < @a;",
          { a: 15 },
          (rows: Array<any>) => {
            result1.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result1.push({ added: added, deleted: deleted });
          },
        );
        let handle2 = await skdb.watchChanges(
          "SELECT * FROM t1 where a > @a;",
          { a: 13 },
          (rows: Array<any>) => {
            result2.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result2.push({ added: added, deleted: deleted });
          },
        );

        await skdb.exec("update t1 set b = 'foo';");

        await handle1.close();
        await handle2.close();

        return [result1, result2];
      },
      check: (res) => {
        let expected = [
          [
            {
              init: [{ a: 13, b: "9", c: 42.1 }],
            },
            {
              added: [{ a: 13, b: "foo", c: 42.1 }],
              deleted: [{ a: 13, b: "9", c: 42.1 }],
            },
          ],
          [
            {
              init: [{ a: 15, b: "9", c: 42.1 }],
            },
            {
              added: [{ a: 15, b: "foo", c: 42.1 }],
              deleted: [{ a: 15, b: "9", c: 42.1 }],
            },
          ],
        ];
        expect(res).toEqual(expected);
      },
    },
    {
      name: wn(
        "Concurrent overlapping reactive queries can co-exist",
        asWorker,
      ),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b TEXT, c FLOAT);");
        await skdb.insert("t1", [13, "9", 42.1]);
        await skdb.insert("t1", [14, "9", 42.1]);
        await skdb.insert("t1", [15, "9", 42.1]);

        let result1: Array<any> = [];
        let result2: Array<any> = [];

        let handle1 = await skdb.watchChanges(
          "SELECT * FROM t1 where a < @a;",
          { a: 15 },
          (rows: Array<any>) => {
            result1.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result1.push({ added: added, deleted: deleted });
          },
        );
        let handle2 = await skdb.watchChanges(
          "SELECT * FROM t1 where a > @a;",
          { a: 13 },
          (rows: Array<any>) => {
            result2.push({ init: rows });
          },
          (added: Array<any>, deleted: Array<any>) => {
            result2.push({ added: added, deleted: deleted });
          },
        );

        await skdb.exec("update t1 set b = 'foo';");

        await handle1.close();
        await handle2.close();

        return [result1, result2];
      },
      check: (res) => {
        let expected = [
          [
            {
              init: [
                { a: 13, b: "9", c: 42.1 },
                { a: 14, b: "9", c: 42.1 },
              ],
            },
            {
              added: [
                { a: 13, b: "foo", c: 42.1 },
                { a: 14, b: "foo", c: 42.1 },
              ],
              deleted: [
                { a: 13, b: "9", c: 42.1 },
                { a: 14, b: "9", c: 42.1 },
              ],
            },
          ],
          [
            {
              init: [
                { a: 14, b: "9", c: 42.1 },
                { a: 15, b: "9", c: 42.1 },
              ],
            },
            {
              added: [
                { a: 14, b: "foo", c: 42.1 },
                { a: 15, b: "foo", c: 42.1 },
              ],
              deleted: [
                { a: 14, b: "9", c: 42.1 },
                { a: 15, b: "9", c: 42.1 },
              ],
            },
          ],
        ];
        expect(res).toEqual(expected);
      },
    },
  ];
};

const dateTests = (asWorker: boolean) => {
  let dn = (name: string, asWorker: boolean) => {
    return n("Date: " + name, asWorker);
  };
  return [
    {
      name: dn("Add days", asWorker),
      fun: async (skdb: SKDB) => {
        const res = await skdb.exec(
          "select strftime('%Y-%m-%d', '2023-01-01', '+2 day');",
        );
        return res.scalarValue();
      },
      check: (res) => {
        expect(res).toEqual("2023-01-03");
      },
    },
    {
      name: dn("Add months", asWorker),
      fun: async (skdb: SKDB) => {
        const res = await skdb.exec(
          "select strftime('%Y-%m-%d', '2023-01-01', '+2 month');",
        );
        return res.scalarValue();
      },
      check: (res) => {
        expect(res).toEqual("2023-03-01");
      },
    },
    {
      name: dn("Epoch", asWorker),
      fun: async (skdb: SKDB) => {
        const res = await skdb.exec(
          "select strftime('%s', '1995-01-01 00:00:00+00');",
        );
        return res.scalarValue();
      },
      check: (res) => {
        expect(res).toEqual("788918400");
      },
    },
    {
      name: dn("Meridian hour", asWorker),
      fun: async (skdb: SKDB) => {
        const res = await skdb.exec(
          "select strftime('%r', '2023-01-01 10:30:00');",
        );
        return res.scalarValue();
      },
      check: (res) => {
        expect(res).toEqual("10:30:00 AM");
      },
    },
  ];
};

export const tests = (asWorker: boolean) => {
  let tests = [
    {
      name: n("Boolean", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a BOOLEAN, b boolean);");
        await skdb.exec("insert into t1 values(TRUE, false);");
        return await skdb.exec("select true, false, a, b from t1;");
      },
      check: (res) => {
        expect(res).toEqual([{ a: 1, b: 0, "col<0>": 1, "col<1>": 0 }]);
      },
    },
    {
      name: n("Create table if not exists", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a BOOLEAN, b boolean);");
        await skdb.exec(
          "create table if not exists t1 (a BOOLEAN, b boolean);",
        );
        return await skdb.exec("select 1;");
      },
      check: (res) => {
        expect(res).toEqual([{ "col<0>": 1 }]);
      },
    },
    {
      name: n("Primary key", asWorker),
      fun: async (skdb: SKDB) => {
        return await skdb.exec("create table t1 (a TEXT PRIMARY KEY);");
      },
      check: (res) => {
        expect(res).toEqual([]);
      },
    },
    {
      name: n("Primary key 2", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a TEXT PRIMARY KEY, b INTEGER);");
        try {
          await skdb.exec("insert into t1 (b) values (22);");
          return await skdb.exec("select b from t1;");
        } catch (e) {
          return (e as Error).message;
        }
      },
      check: (res) => {
        expect(res).toEqual([{ b: 22 }]);
      },
    },
    {
      name: n("Multiple field updates", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table widgets (id text unique, name text);");
        await skdb.exec("INSERT INTO widgets (id, name) VALUES ('a', 'gear');");
        await skdb.exec("UPDATE widgets SET id = 'c', name = 'gear2';");
        return await skdb.exec("select * from widgets;");
      },
      check: (res) => {
        expect(res).toEqual([{ id: "c", name: "gear2" }]);
      },
    },
    {
      name: n("Parse/print float", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec(
          "create table widgets (id text unique , price real not null);",
        );
        await skdb.exec("INSERT INTO widgets (id, price) values ('a', 10.0);");
        return await skdb.exec("select * from widgets");
      },
      check: (res) => {
        expect(res).toEqual([{ id: "a", price: 10 }]);
      },
    },
    {
      name: n("Reactive view if not exists", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a BOOLEAN, b boolean);");
        await skdb.exec("create reactive view v1 as select * from t1;");
        await skdb.exec(
          "create reactive view if not exists v1 as select * from t1;",
        );
        return await skdb.exec("select 1;");
      },
      check: (res) => {
        expect(res).toEqual([{ "col<0>": 1 }]);
      },
    },
    {
      name: n("View if not exists", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a BOOLEAN, b boolean);");
        await skdb.exec("create view v1 as select * from t1;");
        await skdb.exec("create view if not exists v1 as select * from t1;");
        return await skdb.exec("select 1;");
      },
      check: (res) => {
        expect(res).toEqual([{ "col<0>": 1 }]);
      },
    },
    // TODO: uncomment this once we have errors propagated back to the JS
    // NOTE: This test is currently failing because 'table `t1` does not
    // exist' is not being returned in the result (probably being
    // printed on stderr).
    // {
    //     name: 'Error memory',
    //     fun: async (skdb: SKDB) => {
    //         let res = 0;
    //         for(let i = 0; i < 10000; i++) {
    //             let queryRes = await skdb.exec('select * from t1;');
    //             if (queryRes.includes('does not exist')) {
    //                 res += 1;
    //             }
    //         }
    //         return res;
    //     },
    //     check: res => {
    //         expect(res).toEqual(10000);
    //     }
    // },
    {
      name: n("Column casting", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (aBc INTEGER)");
        await skdb.insert("t1", [11]);
        return await skdb.exec("select * from t1");
      },
      check: (res) => {
        expect(res).toEqual([{ aBc: 11 }]);
      },
    },
    {
      name: n("Limit", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (aBc INTEGER)");
        await skdb.insert("t1", [11]);
        await skdb.insert("t1", [12]);
        await skdb.insert("t1", [13]);
        return await skdb.exec("select * from t1 limit 1");
      },
      check: (res) => {
        expect(res).toEqual([{ aBc: 11 }]);
      },
    },
    {
      name: n("Params 1", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER);");
        await skdb.exec(
          "INSERT INTO t1 VALUES (@key);",
          new Map().set("key", 13),
        );
        return skdb.exec("SELECT * FROM t1;");
      },
      check: (res) => {
        expect(res).toEqual([{ a: 13 }]);
      },
    },
    {
      name: n("Params as object", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER);");
        await skdb.exec("INSERT INTO t1 VALUES (@key);", { key: 13 });
        return skdb.exec("SELECT * FROM t1;");
      },
      check: (res) => {
        expect(res).toEqual([{ a: 13 }]);
      },
    },
    {
      name: n("Params 2", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t1 (a INTEGER, b INTEGER, c INTEGER);");
        await skdb.insert("t1", [13, 9, 42]);
        return skdb.exec("SELECT * FROM t1;");
      },
      check: (res) => {
        expect(res).toEqual([{ a: 13, b: 9, c: 42 }]);
      },
    },
    {
      name: n("SKDBTable selectors", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("CREATE TABLE t (a INTEGER, b INTEGER, c INTEGER);");
        await skdb.insert("t", [1, 2, 3]);
        return skdb.exec("SELECT a + b + c AS my_sum FROM t;");
      },
      check: (res) => {
        // browser client tests clobber the prototype of the table returned by
        // skdb.exec in fun, so re-wrap if need be.
        const resTable = res instanceof SKDBTable ? res : new SKDBTable(...res);

        expect(resTable).toEqual([{ my_sum: 6 }]);
        expect(resTable.scalarValue()).toEqual(6);
        expect(resTable.onlyRow()).toEqual({ my_sum: 6 });
        expect(resTable.onlyColumn()).toEqual([6]);
        expect(resTable.column("my_sum")).toEqual([6]);
      },
    },
    {
      name: n("Schema for all", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a BOOLEAN, b boolean);");
        return await skdb.schema();
      },
      check: (res) => {
        expect(res).toMatch(/^CREATE TABLE t1/);
      },
    },
    {
      name: n("Schema for table", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a BOOLEAN, b boolean);");
        return await skdb.schema("t1");
      },
      check: (res) => {
        expect(res).toMatch(/^CREATE TABLE t1/);
      },
    },
    {
      name: n("Schema for view", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a BOOLEAN, b boolean);");
        await skdb.exec("create reactive view v1 as select * from t1;");
        return await skdb.schema("v1");
      },
      check: (res) => {
        expect(res).toMatch(/^CREATE REACTIVE VIEW v1/);
      },
    },
    {
      name: n("UTF8", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a TEXT);");
        let objects = [
          { data: "x\u2019s re" },
          { data: "y\u2013 1" },
          { data: "z\u00ae b" },
          { data: "\u00c3\u00a9al P" },
          { data: " \u2022 T" },
        ];
        for (let i in objects) {
          await skdb.exec("insert into t1 values(@data)", objects[i]);
        }
        return JSON.stringify(await skdb.exec("select * from t1"));
      },
      check: (res) => {
        expect(res).toMatch(/x\u2019s re/);
        expect(res).toMatch(/y\u2013 1/);
        expect(res).toMatch(/z\u00ae b/);
        expect(res).toMatch(/\u00c3\u00a9al P/);
        expect(res).toMatch(/ \u2022 T/);
      },
    },
    {
      name: n("JSON UTF8", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a JSON);");
        let objects = [
          { data: { field1: "x\u2019s re" } },
          { data: { field1: "y\u2013 1" } },
          { data: { field1: "z\u00ae b" } },
          { data: { field1: "\u00c3\u00a9al P" } },
          { data: { field1: " \u2022 T" } },
        ];
        for (let i in objects) {
          objects[i].data = JSON.stringify(objects[i].data);
          await skdb.exec("insert into t1 values(@data)", objects[i]);
        }
        return await skdb.exec("select * from t1");
      },
      check: (res) => {
        let all = res.map((x) => JSON.parse(x.a).field1).join("");
        expect(all).toMatch(/x\u2019s re/);
        expect(all).toMatch(/y\u2013 1/);
        expect(all).toMatch(/z\u00ae b/);
        expect(all).toMatch(/\u00c3\u00a9al P/);
        expect(all).toMatch(/ \u2022 T/);
      },
    },
    {
      name: n("insertMany unit", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a TEXT, b INTEGER);");
        await skdb.insertMany("t1", [
          { a: "foo", b: 0 },
          { a: "bar", b: 1 },
        ]);
        return await skdb.exec("select * from t1");
      },
      check: (res) => {
        let str = JSON.stringify(res);
        expect(str).toMatch(/foo/);
        expect(str).toMatch(/bar/);
      },
    },
    {
      name: n("insertMany bulk", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a TEXT, b INTEGER);");
        let values = new Array();
        for (let i = 0; i < 2100; i++) {
          values.push({ a: "foo", b: i });
        }
        await skdb.insertMany("t1", values);
        return await skdb.exec("select count(*) as c from t1");
      },
      check: (res) => {
        expect(res).toEqual([{ c: 2100 }]);
      },
    },
    {
      name: n("insertMany missing field", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a TEXT, b INTEGER);");
        try {
          return await skdb.insertMany("t1", [
            { a: "foo" },
            { a: "bar", b: 1 },
          ]);
        } catch (e) {
          return (e as Error).message;
        }
      },
      check: (res) => {
        expect(res).toMatch(/Missing/);
      },
    },
    {
      name: n("insertMany too many fields", asWorker),
      fun: async (skdb: SKDB) => {
        await skdb.exec("create table t1 (a TEXT, b INTEGER);");
        try {
          return await skdb.insertMany("t1", [
            { a: "foo", b: 1, c: 2 },
            { a: "bar", b: 1 },
          ]);
        } catch (e) {
          return (e as Error).message;
        }
      },
      check: (res) => {
        expect(res).toMatch(/not found/);
      },
    },
    {
      name: n("Test error", asWorker),
      fun: async (skdb: SKDB) => {
        try {
          return await skdb.exec("create table t1 (a TEXT, b BAD);");
        } catch (e) {
          return (e as Error).message;
        }
      },
      check: (res) => {
        expect(res).toMatch(/Construction not implemented/);
      },
    },
  ];
  return tests
    .concat(watchTests(asWorker))
    .concat(watchChangesTests(asWorker))
    .concat(dateTests(asWorker));
};
