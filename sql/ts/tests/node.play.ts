import { test, expect } from "@playwright/test";
import { tests } from "./tests";
import { createSkdb, SKDB } from "skdb";

function run(t, asWorker: boolean) {
  test(t.name, async () => {
    let skdb = await createSkdb({ asWorker: asWorker });
    let res = await t.fun(skdb);
    t.check(res);
  });
}

tests(false).forEach((t) => run(t, false));
tests(true).forEach((t) => run(t, true));

const N = 765000; // we should be able to process this many rows without running out of address space

// this is to detect memory regression in wasm, it's not a behaviour
// test. running only in node as I saw timeout flakiness with firefox.
run(
  {
    name: "Write-csv memory regression test",
    fun: async (skdb: SKDB) => {
      test.slow();
      await skdb.exec(
        "CREATE TABLE no_pk_inserts (id INTEGER, client INTEGER, value INTEGER, skdb_access TEXT NOT NULL);",
        {},
      );

      const rows = ["^no_pk_inserts"];
      for (let i = 0; i < N; i++) {
        rows.push(`1\t${i},1,${i},read-write`);
      }
      rows.push(":10");

      (skdb as any).skdbSync.runLocal(["write-csv"], rows.join("\n") + "\n");

      return await skdb.exec("select count(*) as n from no_pk_inserts");
    },
    check: (res) => {
      expect(res).toEqual([{ n: N }]);
    },
  },
  false,
);
