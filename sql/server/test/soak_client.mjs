import {
  createSkdb,
  SKDBTable,
} from "../../../build/package/skdb/dist/skdb.mjs";
import { webcrypto as crypto } from "node:crypto";
import assert from "node:assert/strict";

const tables = [
  {table: "no_pk_inserts", expectedColumns: "*"},
  {table: "pk_inserts", expectedColumns: "*"},
  {table: "no_pk_single_row", expectedColumns: "*"},
  {table: "pk_single_row", expectedColumns: "*"},
  {table: "pk_privacy_ro", expectedColumns: "*"},
  {table: "pk_privacy_rw", expectedColumns: "*"},
  {table: "checkpoints", expectedColumns: "*"},
];

const filtered_tables = ["no_pk_filtered", "pk_filtered"];

let pause_modifying = false;

const setup = async function (client) {
  const skdb = await createSkdb({ asWorker: false });
  const b64key = "test";
  const keyData = Uint8Array.from(atob(b64key), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const user = `test_user${client}`;
  await skdb.connect("soak", user, key, "ws://localhost:" + (port ?? 3586));

  const mirrorDefs = [
    ...tables,
    // clients are 1 indexed. this gives us some stuff no clients care
    // about (0), stuff we care about ($client), stuff we both care
    // about (3)
    ...filtered_tables.map((t) => ({
      table: t,
      expectedColumns: "*",
      filterExpr: `value % 4 IN (${client}, 3)`,
    })),
  ];

  await skdb.mirror(...mirrorDefs);

  return skdb;
};

const modify_rows = async function (client, skdb, i) {
  while (pause_modifying) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const avgWriteMs = 500;

  const check_every = 30;

  const privacy =
    i % (check_every * 2) < check_every ? "read-write" : skdb.currentUser;

  const regular_action = async () => {
    // monotonic inserts - should be no conflict here. just check that
    // replication works well in the happy case and we don't lose or
    // dup anything in the chaos
    await skdb.exec(
      `INSERT INTO no_pk_inserts VALUES(${i}, ${client}, ${i}, 'read-write');`,
    );
    await skdb.exec(
      `INSERT INTO pk_inserts VALUES(${
        i * 2 + (client - 1)
      }, ${client}, ${i}, 'read-write');`,
    );

    // monotonic inserts with filtering. same as above but with a
    // filter that ensures there are rows neither client cares about,
    // both care about, and only we care about.
    await skdb.exec(
      `INSERT INTO no_pk_filtered VALUES(${i}, ${client}, ${i}, 'read-write');`,
    );
    await skdb.exec(
      `INSERT INTO pk_filtered VALUES(${
        i * 2 + (client - 1)
      }, ${client}, ${i}, 'read-write');`,
    );

    // conflict:
    // fight over single row
    await skdb.exec(
      `BEGIN TRANSACTION;
       INSERT INTO pk_single_row_hist SELECT datetime(), client, value FROM pk_single_row;
       UPDATE pk_single_row SET client = ${client}, value = ${i} WHERE id = 0;
       COMMIT;`,
    );
    // for no pk we have a very trivial conflict resolution - I win.
    await skdb.exec(
      `BEGIN TRANSACTION;
       INSERT INTO no_pk_single_row_hist SELECT datetime(), client, value FROM no_pk_single_row;
       DELETE FROM no_pk_single_row WHERE id = 0;
       INSERT INTO no_pk_single_row VALUES (0,${client},${i}, 'read-write');
       COMMIT;`,
    );

    // privacy updates.
    await skdb.exec(
      `INSERT OR REPLACE INTO pk_privacy_ro VALUES(${client}, '${privacy}');`,
    );

    await skdb.exec(
      `INSERT OR REPLACE INTO pk_privacy_rw VALUES(${client}, ${client}, '${privacy}');`,
    );
    await skdb.exec(`UPDATE pk_privacy_rw SET updater = ${client};`);

    // avoid stack overflow by using event loop
    setTimeout(() => modify_rows(client, skdb, i + 1), 0);
  };

  const checkpoint_action = async () => {
    await skdb.exec(
      `BEGIN TRANSACTION;
       INSERT INTO no_pk_inserts VALUES(${i}, ${client}, ${i}, 'read-write');
       INSERT INTO pk_inserts VALUES(${
         i * 2 + (client - 1)
       }, ${client}, ${i}, 'read-write');
       INSERT INTO no_pk_filtered VALUES(${i}, ${client}, ${i}, 'read-write');
       INSERT INTO pk_filtered VALUES(${
         i * 2 + (client - 1)
       }, ${client}, ${i}, 'read-write');
       INSERT INTO pk_single_row_hist SELECT datetime(), client, value FROM pk_single_row;
       UPDATE pk_single_row SET client = ${client}, value = ${i} WHERE id = 0;
       INSERT INTO no_pk_single_row_hist SELECT datetime(), client, value FROM no_pk_single_row;
       DELETE FROM no_pk_single_row WHERE id = 0;
       INSERT INTO no_pk_single_row VALUES (0,${client},${i}, 'read-write');
       UPDATE pk_privacy_ro SET skdb_access = '${privacy}' WHERE client = ${client};
       UPDATE pk_privacy_rw SET skdb_access = '${privacy}' WHERE client = ${client};
       UPDATE pk_privacy_rw SET updater = ${client};
       INSERT INTO checkpoints VALUES (id(), ${i}, ${client}, 'read-write');
       COMMIT;
    `,
    );

    setTimeout(() => modify_rows(client, skdb, i + 1), 0);
  };

  if (i > 0 && i % check_every === 0) {
    setTimeout(checkpoint_action, Math.random() * avgWriteMs * 2);
  } else {
    setTimeout(regular_action, Math.random() * avgWriteMs * 2);
  }
};

const table_is_rebuilding = function(skdb, table) {
  // we're about to do some serious encapsulation violation
  const replicationId = skdb.skdbSync.connectedRemote.replicationUid;
  const watermark = skdb.skdbSync.watermark(replicationId, table);
  return watermark === BigInt(0);
};

const table_rebuilding_state = new Map();
const check_expectation = async function (
  skdb,
  check_query,
  params,
  expected,
  table,
) {
  const results = await skdb.exec(check_query, params);

  const rebuilding = table_is_rebuilding(skdb, table);
  const wasRebuliding = table_rebuilding_state.get(table) ?? false;
  table_rebuilding_state.set(table, rebuilding);
  if (rebuilding && wasRebuliding) {
    // we've been rebuilding for two checkpoints in a row. that is
    // (almost?) certainly a bad state that isn't healing
    throw new Error(`${table} is still rebuilding`);
  }
  if (rebuilding) {
    // it doesn't make sense to check expectation on a table that is
    // being rebuilt and we know is in a partial state.
    return;
  }

  try {
    assert.deepStrictEqual(
      results,
      expected,
      `${table} failed expectation check`,
    );
  } catch (ex) {
    const results = await skdb.exec(`select * from ${table}`);
    console.log(`${table} failed expectation check, select *:`);
    console.table(results);
    throw ex;
  }
};

const expectation_check_watermarks = new Map();

const check_expectations = async function (skdb, client, latest_id, this_client) {
  pause_modifying = true;
  const prevCheckPointWatermark = expectation_check_watermarks.get(client) ?? 0;
  expectation_check_watermarks.set(
    client,
    Math.max(latest_id, prevCheckPointWatermark)
  );

  const params = { client, latest_id };

  await skdb.exec(`
INSERT INTO pk_single_row_hist SELECT datetime(), client, value FROM pk_single_row;
INSERT INTO no_pk_single_row_hist SELECT datetime(), client, value FROM no_pk_single_row;`,
  );

  console.log("Running expectation checks for checkpoint", params);

  check_expectation(
    skdb,
    `select sum(value) as total, count(*) as n, max(id) as last_id
     from no_pk_inserts
     where client = @client and id <= @latest_id`,
    params,
    new SKDBTable({
      total: (latest_id * (latest_id + 1)) / 2,
      n: latest_id + 1,
      last_id: latest_id,
    }),
    "no_pk_inserts",
  );

  check_expectation(
    skdb,
    `select sum(value) as total, count(*) as n, max(value) as last_id
     from pk_inserts
     where client = @client and id <= @latest_id * 2 + (@client - 1)`,
    params,
    new SKDBTable({
      total: (latest_id * (latest_id + 1)) / 2,
      n: latest_id + 1,
      last_id: latest_id,
    }),
    "pk_inserts",
  );

  // must check the bound and not equality as the checkpoint could
  // arrive as part of catching up.
  check_expectation(
    skdb,
    `select client, max(value) >= @latest_id as test
     from no_pk_single_row_hist
     where client = @client`,
    params,
    new SKDBTable({
      client: client,
      test: 1,
    }),
    "no_pk_single_row",
  );

  // we should see either a result as large as the client just wrote
  // or a larger client value (which due to how concurrency is
  // resolved is allowed to win)
  if (this_client < client) {
    check_expectation(
      skdb,
      `select max(value) >= @latest_id as test
      from pk_single_row_hist
      where client = @client`,
      params,
      new SKDBTable({
        test: 1,
      }),
      "pk_single_row",
    );
  }

  check_expectation(
    skdb,
    `select count(*) as n
     from no_pk_filtered
     where client = @client and id <= @latest_id`,
    params,
    new SKDBTable({
      n: latest_id / 2,
    }),
    "no_pk_filtered",
  );

  check_expectation(
    skdb,
    `select count(*) as n
     from pk_filtered
     where client = @client and id <= @latest_id * 2 + (@client - 1)`,
    params,
    new SKDBTable({
      n: latest_id / 2,
    }),
    "pk_filtered",
  );

  // this check will not necessarily hold true if this checkpoint is a
  // replay. it can replay independently of the pk_privacy_ro table.
  if (prevCheckPointWatermark < latest_id) {
    check_expectation(
      skdb,
      `select count(*) as n
     from pk_privacy_ro
     where client = @client`,
      params,
      new SKDBTable({
        n: latest_id % 60 < 30 ? 1 : 0,
      }),
      "pk_privacy_ro",
    );
  }

  // this check will not necessarily hold true if this checkpoint is a
  // replay. it can replay independently of the pk_privacy_rw table.
  if (prevCheckPointWatermark < latest_id) {
    // cannot just look at count here as we may have updated the row and
    // so it will not be removed.
    check_expectation(
      skdb,
      `select NOT (@latest_id % 60 < 30 AND count(*) <> 1) as test
     from pk_privacy_rw
     where client = @client`,
      params,
      new SKDBTable({
        test: 1,
      }),
      "pk_privacy_rw",
    );
  }

  pause_modifying = false;
};

const client = process.argv[2];
const port = process.argv[3];

setup(client, port)
  .then(async (skdb) => {
    process.on("SIGUSR1", async () => {
      console.log(`Dumping state in response to SIGUSR1.`);

      console.log(
        "> no_pk_inserts - these are the rows that do not have two entries:",
      );
      console.log(
        await skdb.exec(
          "select * from no_pk_inserts where id in (select id from (select id, count(*) as n from no_pk_inserts group by id) where n <> 2);",
        ),
      );
      console.log("> no_pk_inserts - most recent 20:");
      console.log(
        await skdb.exec(
          "select * from no_pk_inserts order by id desc limit 20;",
        ),
      );
      console.log("> pk_inserts - these rows do not have 1 entry:");
      console.log(
        await skdb.exec(
          "select * from pk_inserts where id in (select id from (select id, count(*) as n from pk_inserts group by id) where n <> 1);",
        ),
      );
      console.log("> pk_inserts - most recent 20:");
      console.log(
        await skdb.exec("select * from pk_inserts order by id desc limit 20;"),
      );

      console.log("> no_pk_single_row - select * limit 20:");
      console.log(await skdb.exec("select * from no_pk_single_row limit 20"));
      console.log("> pk_single_row - select *:");
      console.log(await skdb.exec("select * from pk_single_row"));

      console.log("> no_pk_filtered - most recent 20:");
      console.log(
        await skdb.exec(
          "select * from no_pk_filtered order by id desc limit 20;",
        ),
      );
      console.log("> pk_filtered - most recent 20:");
      console.log(
        await skdb.exec("select * from pk_filtered order by id desc limit 20;"),
      );

      console.log("> pk_privacy_ro - select *:");
      console.log(await skdb.exec("select * from pk_privacy_ro;"));

      console.log("> pk_privacy_rw - select *:");
      console.log(await skdb.exec("select * from pk_privacy_rw;"));
    });

    await skdb.exec(`
CREATE TABLE no_pk_single_row_hist (
  t TEXT DEFAULT CURRENT_TIMESTAMP,
  client INTEGER,
  value INTEGER
);`);

    await skdb.exec(`
CREATE TABLE pk_single_row_hist (
  t TEXT DEFAULT CURRENT_TIMESTAMP,
  client INTEGER,
  value INTEGER
);` );

    // check expectations on receiving a checkpoint
    await skdb.watch(
      `SELECT client, max(latest_id) as latest_id
     FROM checkpoints
     WHERE client != @client
     GROUP BY client`,
      { client: parseInt(client) },
      async (rows) => {
        if (rows.length < 1) {
          return;
        }
        const checkpoint_client = rows[0].client;
        const latest_id = rows[0].latest_id;
        const this_client = client;
        check_expectations(skdb, checkpoint_client, latest_id, this_client);
      },
    );

    modify_rows(client, skdb, 0);
  })
  .catch((exn) => console.error(exn));
