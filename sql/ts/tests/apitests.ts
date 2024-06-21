import { expect } from "@playwright/test";
import { createSkdb, SKDB, Params, SKDBTable } from "skdb";

type dbs = {
  root: SKDB;
  user: SKDB;
  user2: SKDB;
};

function getErrorMessage(error: any) {
  if (typeof error == "string") {
    return error.trim();
  } else {
    try {
      return JSON.parse((error as Error).message).trim();
    } catch (e) {
      if (e instanceof SyntaxError) {
        return (error as Error).message.trim();
      }
      throw e;
    }
  }
}

async function getCredsFromDevServer(
  host: string,
  port: number,
  database: string,
) {
  const creds = new Map();
  try {
    const resp = await fetch(`http://${host}:${port}/dbs/${database}/users`);
    const data = await resp.text();
    const users = data
      .split("\n")
      .filter((line) => line.trim() != "")
      .map((line) => JSON.parse(line));
    for (const user of users) {
      creds.set(user.accessKey, user.privateKey);
    }
  } catch (ex: any) {
    throw new Error("Could not fetch from the dev server, is it running?");
  }

  return creds;
}

export async function setup(
  port: number,
  crypto,
  asWorker: boolean,
  suffix: string = "",
) {
  const host = "ws://localhost:" + port;
  const dbName = "test" + suffix;

  const testRootCreds = await getCredsFromDevServer("localhost", port, dbName);

  const rootSkdb = await createSkdb({
    asWorker: asWorker,
    disableWarnings: true,
  });
  {
    const keyBytes = Uint8Array.from(atob(testRootCreds.get("root")), (c) =>
      c.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    await rootSkdb.connect(dbName, "root", key, host);
  }

  const rootRemote = await rootSkdb.connectedRemote();
  const testUserCreds = await rootRemote!.createUser();

  const userSkdb = await createSkdb({
    asWorker: asWorker,
    disableWarnings: true,
  });
  {
    const keyData = testUserCreds.privateKey;
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    await userSkdb.connect(dbName, testUserCreds.accessKey, key, host);
  }

  const testUserCreds2 = await rootRemote.createUser();

  const userSkdb2 = await createSkdb({
    asWorker: asWorker,
    disableWarnings: true,
  });
  {
    const keyData2 = testUserCreds2.privateKey;
    const key2 = await crypto.subtle.importKey(
      "raw",
      keyData2,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    await userSkdb2.connect(dbName, testUserCreds2.accessKey, key2, host);
  }

  return { root: rootSkdb, user: userSkdb, user2: userSkdb2 };
}

async function testQueriesAgainstTheServer(skdb: SKDB) {
  const remote = (await skdb.connectedRemote())!;

  const tableCreate = await remote.exec(
    "CREATE TABLE test_pk (x INTEGER PRIMARY KEY, y INTEGER, skdb_access TEXT);",
    new Map(),
  );
  expect(tableCreate).toEqual([]);

  await remote.exec(
    "CREATE TABLE test_pk_string (x INTEGER PRIMARY KEY, y TEXT, skdb_access TEXT);",
    new Map(),
  );

  const viewCreate = await remote.exec(
    "CREATE REACTIVE VIEW view_pk AS SELECT x, y * 3 AS y, 'read-write' as skdb_access FROM test_pk;",
    {},
  );
  expect(viewCreate).toEqual([]);

  const tableInsert = await remote.exec(
    "INSERT INTO test_pk VALUES (42,21,'read-write');",
    {},
  );
  expect(tableInsert).toEqual([]);

  const tableInsertWithParam = await remote.exec(
    "INSERT INTO test_pk VALUES (@x,@y,'read-write');",
    new Map().set("x", 43).set("y", 22),
  );
  expect(tableInsertWithParam).toEqual([]);
  const tableInsertWithOParam = await remote.exec(
    "INSERT INTO test_pk VALUES (@x,@y,'read-write');",
    { x: 44, y: 23 },
  );
  expect(tableInsertWithOParam).toEqual([]);

  const tableSelect = await remote.exec("SELECT x,y FROM test_pk;", {});
  expect(tableSelect).toEqual([
    { x: 42, y: 21 },
    { x: 43, y: 22 },
    { x: 44, y: 23 },
  ]);

  const viewSelect = await remote.exec("SELECT x,y FROM view_pk;", {});
  expect(viewSelect).toEqual([
    { x: 42, y: 63 },
    { x: 43, y: 66 },
    { x: 44, y: 69 },
  ]);

  try {
    await remote.exec("bad query", {});
  } catch (error) {
    const lines = getErrorMessage(error).split("\n");
    expect(lines[lines.length - 1]).toEqual(
      "Unexpected token IDENTIFIER: expected STATEMENT",
    );
  }

  const rows = await remote.exec("SELECT x,y FROM test_pk WHERE x=@x;", {
    x: 42,
  });
  expect(rows).toEqual([{ x: 42, y: 21 }]);
  await remote.exec("delete from test_pk where x in (44);", {});
  try {
    await remote.exec("bad query", {});
  } catch (error) {
    const lines = getErrorMessage(error).split("\n");
    expect(lines[lines.length - 1]).toEqual(
      "Unexpected token IDENTIFIER: expected STATEMENT",
    );
  }
}

async function testSchemaQueries(skdb: SKDB) {
  const remote = (await skdb.connectedRemote())!;
  const expected = "CREATE TABLE test_pk (";
  const schema = await remote.schema();
  const contains = schema.includes(expected);
  expect(contains ? expected : schema).toEqual(expected);

  // valid views/tables
  const viewExpected = "CREATE REACTIVE VIEW skdb_groups_users";
  const viewSchema = await remote.viewSchema("skdb_groups_users");
  const viewContains = viewSchema.includes(viewExpected);
  expect(viewContains ? viewExpected : viewSchema).toEqual(viewExpected);

  const tableExpected = "CREATE TABLE skdb_users";
  const tableSchema = await remote.tableSchema("skdb_users");
  const tableContains = tableSchema.includes(tableExpected);
  expect(tableContains ? tableExpected : tableSchema).toEqual(tableExpected);

  const viewTableExpected =
    /CREATE TABLE view_pk \(\n  x INTEGER,\n  y INTEGER,\n  skdb_access TEXT\n\);/;
  const viewTableSchema = await remote.tableSchema("view_pk");
  const viewTableContains = viewTableSchema.match(viewTableExpected);
  expect(viewTableContains ? viewTableExpected : viewTableSchema).toEqual(
    viewTableExpected,
  );

  // invalid views/tables
  const emptyView = await remote.viewSchema("nope");
  expect(emptyView).toEqual("");

  const emptyTable = await remote.tableSchema("nope");
  expect(emptyTable).toEqual("");
}

async function testMirroring(root: SKDB, skdb1: SKDB, skdb2: SKDB) {
  const test_pk = {
    table: "test_pk",
    expectedColumns: "(x INTEGER PRIMARY KEY, y INTEGER, skdb_access TEXT)",
    filterExpr: "x < @thresh",
    filterParams: { thresh: 43 },
  };
  const view_pk = {
    table: "view_pk",
    expectedColumns: "(x INTEGER, y INTEGER, skdb_access TEXT)",
  };
  await skdb1.mirror(test_pk, view_pk);

  const testPkRows = await skdb1.exec("SELECT x,y FROM test_pk");
  expect(testPkRows).toEqual([{ x: 42, y: 21 }]);

  const viewPkRows = await skdb1.exec("SELECT x,y FROM view_pk");
  expect(viewPkRows).toEqual([
    { x: 42, y: 63 },
    { x: 43, y: 66 },
  ]);

  // mirror already mirrored table is idempotent
  await skdb1.mirror(test_pk, view_pk);
  const testPkRows2 = await skdb1.exec("SELECT x,y FROM test_pk");
  expect(testPkRows2).toEqual([{ x: 42, y: 21 }]);

  // mirroring clients can specify alternate schemas
  const test_pk_subset_schema = {
    table: "test_pk",
    expectedColumns: "(skdb_access TEXT, x INTEGER PRIMARY KEY)",
  };
  await skdb2.mirror(test_pk_subset_schema);
  const testPkRows_skdb2 = await skdb2.exec("SELECT * FROM test_pk");
  expect(testPkRows_skdb2).toEqual([
    { skdb_access: "read-write", x: 42 },
    { skdb_access: "read-write", x: 43 },
  ]);
  // with invalid schemas erroring
  const rootRemote = await root.connectedRemote();
  await rootRemote!.exec(
    "CREATE TABLE invalid_expect_cols (i INTEGER, skdb_access TEXT NOT NULL);",
  );
  await expect(
    async () =>
      await user1.mirror({
        table: "invalid_expect_cols",
        expectedColumns: "(i INTEGER, skdb_access TEXT)",
      }),
  ).rejects.toThrow();
}

function waitSynch(
  skdb: SKDB,
  query: string,
  check: (v: any) => boolean,
  query_params: Params = new Map(),
  server: boolean = false,
  max: number = 10,
) {
  let count = 0;
  const test = (resolve, reject) => {
    const cb = (value) => {
      if (check(value) || count == max) {
        resolve(value);
      } else {
        count++;
        setTimeout(() => test(resolve, reject), 200);
      }
    };
    if (server) {
      skdb
        .connectedRemote()
        .then((remote) => remote!.exec(query, query_params))
        .then(cb)
        .catch(reject);
    } else {
      skdb.exec(query, query_params).then(cb).catch(reject);
    }
  };
  return new Promise(test);
}

async function testServerTail(root: SKDB, user: SKDB) {
  const remote = (await root.connectedRemote())!;
  try {
    await remote.exec(
      "insert into view_pk values (87,88,'read-write');",
      new Map(),
    );
    throw new Error("Shall throw exception.");
  } catch (exn) {
    expect(getErrorMessage(exn)).toEqual(
      "insert into view_pk values (87,88,'read-write');\n^\n|\n ----- ERROR\nError: line 1, character 0:\nCannot write in view: view_pk",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const vres = await user.exec(
    "select count(*) as cnt from view_pk where x = 87 and y = 88",
  );
  expect(vres).toEqual([{ cnt: 0 }]);

  await remote.exec(
    "insert into test_pk values (87,88,'read-write');",
    new Map(),
  );
  const res = await waitSynch(
    user,
    "select count(*) as cnt from test_pk where x = 87 and y = 88",
    (tail) => tail.scalarValue() === 1,
  );
  expect(res).toEqual([{ cnt: 1 }]);

  const resv = await waitSynch(
    user,
    "select count(*) as cnt from view_pk where x = 87 and y = 264",
    (tail) => tail.scalarValue() === 1,
  );
  expect(resv).toEqual([{ cnt: 1 }]);
}

async function testClientTail(root: SKDB, user: SKDB) {
  const remote = await root.connectedRemote();
  try {
    await user.exec("insert into view_pk values (97,98,'read-write');");
    throw new Error("Shall throw exception.");
  } catch (exn: any) {
    // The following error message is duplicated due to how the wasm runtime
    // translates `exit()` syscalls into exceptions.
    expect(getErrorMessage(exn)).toEqual(
      "insert into view_pk values (97,98,'read-write');\n^\n|\n ----- ERROR\nError: line 1, character 0:\nCannot write in view: view_pk",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const vres = await remote!.exec(
    "select count(*) as cnt from test_pk where x = 97 and y = 98",
    new Map(),
  );
  expect(vres).toEqual([{ cnt: 0 }]);

  await user.exec("insert into test_pk values (97,98,'read-write');");
  const res = await waitSynch(
    root,
    "select count(*) as cnt from test_pk where x = 97 and y = 98",
    (tail) => tail.scalarValue() === 1,
    new Map(),
    true,
  );
  expect(res).toEqual([{ cnt: 1 }]);
  const resv = await waitSynch(
    root,
    "select count(*) as cnt from view_pk where x = 97 and y = 294",
    (tail) => tail.scalarValue() === 1,
    new Map(),
    true,
  );
  expect(resv).toEqual([{ cnt: 1 }]);

  await user.mirror({
    table: "test_pk_string",
    expectedColumns: "(x INTEGER PRIMARY KEY, y TEXT, skdb_access TEXT)",
  });

  // chars outside of ascii replicate and can be queried
  {
    const str = "hello, world!\u2122";
    await user.exec(
      "insert into test_pk_string values (0,@str,'read-write');",
      { str },
    );
    const res = await waitSynch(
      root,
      "select y from test_pk_string where x = 0 and y = @str",
      (tail) => tail.scalarValue() === str,
      { str },
      true,
    );
    expect(res).toEqual([{ y: str }]);

    // sanity check that the result we get back in to a json object is
    // also correctly formed
    const rows = await user.exec("SELECT y FROM test_pk_string WHERE x = 0");
    expect(rows).toEqual([{ y: str }]);
  }

  // newlines don't break anything, adding...
  {
    const str = "hello, world!\r\n";
    await user.exec(
      "insert into test_pk_string values (1,@str,'read-write');",
      { str },
    );
    const res = await waitSynch(
      root,
      "select count(*) as cnt from test_pk_string where x = 1 and y = @str",
      (tail) => tail.scalarValue() === 1,
      { str },
      true,
    );
    expect(res).toEqual([{ cnt: 1 }]);

    // sanity check that the result we get back in to a json object is
    // also correctly formed
    const rows = await user.exec("SELECT y FROM test_pk_string WHERE x = 1");
    expect(rows).toEqual([{ y: str }]);
  }

  // ...or removing
  {
    await user.exec("delete from test_pk_string where x = 1;", {});
    const res = await waitSynch(
      root,
      "select count(*) as cnt from test_pk_string where x = 1",
      (tail) => tail.scalarValue() === 0,
      {},
      true,
    );
    expect(res).toEqual([{ cnt: 0 }]);
  }

  // quotes don't break anything, adding...
  {
    const str = "he\"llo\", 'world'!";
    await user.exec(
      "insert into test_pk_string values (1,@str,'read-write');",
      { str },
    );
    const res = await waitSynch(
      root,
      "select count(*) as cnt from test_pk_string where x = 1 and y = @str",
      (tail) => tail.scalarValue() === 1,
      { str },
      true,
    );
    expect(res).toEqual([{ cnt: 1 }]);

    // sanity check that the result we get back in to a json object is
    // also correctly formed
    const rows = await user.exec("SELECT y FROM test_pk_string WHERE x = 1");
    expect(rows).toEqual([{ y: str }]);
  }

  // ...or removing
  {
    await user.exec("delete from test_pk_string where x = 1;", {});
    const res = await waitSynch(
      root,
      "select count(*) as cnt from test_pk_string where x = 1",
      (tail) => tail.scalarValue() === 0,
      {},
      true,
    );
    expect(res).toEqual([{ cnt: 0 }]);
  }
}

async function testLargeMirror(root: SKDB, user: SKDB) {
  const rootRemote = await root.connectedRemote();
  await rootRemote!.exec("CREATE TABLE large (t INTEGER, skdb_access TEXT);");
  await rootRemote!.exec(
    "CREATE TABLE large_copy (t INTEGER, skdb_access TEXT);",
  );

  const test_pk = {
    table: "test_pk",
    expectedColumns: "(x INTEGER PRIMARY KEY, y INTEGER, skdb_access TEXT)",
  };
  const view_pk = {
    table: "view_pk",
    expectedColumns: "(x INTEGER, y INTEGER, skdb_access TEXT)",
  };
  const large = {
    table: "large",
    expectedColumns: "(t INTEGER, skdb_access TEXT)",
  };
  const large_copy = {
    table: "large_copy",
    expectedColumns: "*", // just to test the *, would be better to be explicit
  };

  await user.mirror(test_pk, view_pk, large);

  const N = 10000;

  for (let i = 0; i < N; i++) {
    await user.exec("INSERT INTO large VALUES (@i, 'read-write');", { i });
  }

  const userRemote = await user.connectedRemote();
  while (true) {
    const awaitingSync = await userRemote.tablesAwaitingSync();
    if (awaitingSync.size < 1) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await rootRemote!.exec("insert into large_copy select * from large", {});

  const cnt = await rootRemote!.exec(
    "select count(*) as n from large_copy",
    {},
  );
  expect(cnt).toEqual([{ n: N }]);

  await user.mirror(test_pk, view_pk, large, large_copy);

  const localCnt = await user.exec("select count(*) as n from large", {});
  expect(localCnt).toEqual([{ n: N }]);

  const localCntCopy = await user.exec(
    "select count(*) as n from large_copy",
    {},
  );
  expect(localCntCopy).toEqual([{ n: N }]);
}

async function testMirrorWithAuthor(root: SKDB, user1: SKDB, user2: SKDB) {
  const rootRemote = await root.connectedRemote();
  await rootRemote!.exec(
    "CREATE TABLE sync (i INTEGER, skdb_access TEXT NOT NULL, skdb_author TEXT NOT NULL);",
  );
  await rootRemote!.exec(
    "CREATE TABLE syncpk (i INTEGER PRIMARY KEY, skdb_access TEXT NOT NULL, skdb_author TEXT NOT NULL);",
  );

  const syncDef = {
    table: "sync",
    expectedColumns: "*",
  };
  const syncPkDef = {
    table: "syncpk",
    expectedColumns: "*",
  };
  const test_pk = {
    table: "test_pk",
    expectedColumns: "(x INTEGER PRIMARY KEY, y INTEGER, skdb_access TEXT)",
  };
  const test_pk_subset_schema = {
    table: "test_pk",
    expectedColumns: "(skdb_access TEXT, x INTEGER PRIMARY KEY)",
  };
  const view_pk = {
    table: "view_pk",
    expectedColumns: "(x INTEGER, y INTEGER, skdb_access TEXT)",
  };

  // important for the test that we really do have different users
  expect(user1.currentUser).not.toEqual(user2.currentUser);

  await user1.mirror(test_pk, view_pk, syncDef, syncPkDef);
  const whoami = user1.currentUser;
  await user1.exec("INSERT INTO sync VALUES (0, 'read-write', @whoami);", {
    whoami,
  });
  await user1.exec("INSERT INTO syncpk VALUES (0, 'read-write', @whoami);", {
    whoami,
  });
  await user2.mirror(test_pk_subset_schema, view_pk, syncDef, syncPkDef);
  expect(await user2.exec("SELECT * FROM sync")).toEqual([
    { i: 0, skdb_access: "read-write", skdb_author: whoami },
  ]);
  expect(await user2.exec("SELECT * FROM syncpk")).toEqual([
    { i: 0, skdb_access: "read-write", skdb_author: whoami },
  ]);
}

async function testConstraints(root: SKDB, user1: SKDB) {
  const rootRemote = await root.connectedRemote();
  await rootRemote!.exec(
    "CREATE TABLE has_constraint (i INTEGER, skdb_access TEXT NOT NULL);",
  );
  await rootRemote!.exec(
    "CREATE REACTIVE VIEW pos AS SELECT CHECK(i > 0) FROM has_constraint;",
  );

  const constraint = {
    table: "has_constraint",
    expectedColumns: "(i INTEGER, skdb_access TEXT NOT NULL)",
  };

  await user1.mirror(constraint);

  // mirror works and is in good known state
  await user1.exec("INSERT INTO has_constraint VALUES (1, 'read-write');");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const nRows = await user1.exec(
    "select count(*) from has_constraint__skdb_mirror_feedback",
  );
  expect(nRows.scalarValue()).toEqual(0);

  // mirror fails due to constraint violation
  await user1.exec("INSERT INTO has_constraint VALUES (-1, 'read-write');");
  const res = await waitSynch(
    user1,
    "select * from has_constraint__skdb_mirror_feedback",
    (rows) => rows.length > 0,
  );
  expect(res).toEqual([{ i: -1, skdb_access: "read-write" }]);

  // mirror fails whole txn due to constraint violation
  await user1.exec(`BEGIN TRANSACTION;
INSERT INTO
  has_constraint
VALUES
  (55, 'read-write');
INSERT INTO
  has_constraint
VALUES
  (-1, 'read-write');
INSERT INTO
  has_constraint
VALUES
  (35, 'read-write');
COMMIT;
`);
  {
    const res: SKDBTable = await waitSynch(
      user1,
      "select i from has_constraint__skdb_mirror_feedback order by i",
      (rows) => rows.length > 1,
    );
    expect(res).toEqual([{ i: -1 }, { i: -1 }, { i: 35 }, { i: 55 }]);
  }

  // mirror still works after failures
  {
    await user1.exec("INSERT INTO has_constraint VALUES (2, 'read-write');");
    const res: SKDBTable = await waitSynch(
      root,
      "select count(*) from has_constraint where i = 2",
      (rows) => rows.length > 0,
      {},
      true,
    );
    expect(res.scalarValue()).toEqual(1);
  }
}

async function testReboot(root: SKDB, user: SKDB, user2: SKDB) {
  const test_pk = {
    table: "test_pk",
    expectedColumns: "(x INTEGER PRIMARY KEY, y INTEGER, skdb_access TEXT)",
  };
  const test_pk_subset_schema = {
    table: "test_pk",
    expectedColumns: "(skdb_access TEXT, x INTEGER PRIMARY KEY)",
  };
  await user.mirror(test_pk);
  await user2.mirror(test_pk_subset_schema);
  const remote = await user.connectedRemote();
  let user_rebooted = false;
  remote!.onReboot(() => (user_rebooted = true));
  const remote2 = await user2.connectedRemote();
  let user2_rebooted = false;
  remote2!.onReboot(() => (user2_rebooted = true));
  const rremote = await root.connectedRemote();
  await rremote!.exec("DROP TABLE test_pk;");
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(user_rebooted).toEqual(true);
  expect(user2_rebooted).toEqual(true);
}

async function testJSPrivacy(skdb: SKDB, skdb2: SKDB) {
  const test_pk = {
    table: "test_pk",
    expectedColumns: "(x INTEGER PRIMARY KEY, y INTEGER, skdb_access TEXT)",
  };
  const test_pk_subset_schema = {
    table: "test_pk",
    expectedColumns: "(skdb_access TEXT, x INTEGER PRIMARY KEY)",
  };
  const view_pk = {
    table: "view_pk",
    expectedColumns: "(x INTEGER, y INTEGER, skdb_access TEXT)",
  };
  await skdb.mirror(test_pk, view_pk);
  await skdb2.mirror(test_pk_subset_schema, view_pk);
  await skdb.exec(
    "INSERT INTO skdb_groups VALUES ('my_group', @uid, @uid, @uid, 'read-write');",
    { uid: skdb.currentUser },
  );
  await skdb.exec(
    "INSERT INTO skdb_group_permissions VALUES ('my_group', @uid, skdb_permission('rw'), @uid);",
    { uid: skdb.currentUser },
  );

  await skdb.exec("INSERT INTO test_pk VALUES (37, 42, 'my_group');");

  expect(
    await waitSynch(
      skdb,
      "SELECT * FROM test_pk WHERE skdb_access='my_group';",
      (rows) => rows.length == 1,
    ),
  ).toHaveLength(1);

  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM test_pk WHERE skdb_access='my_group';",
      (rows) => rows.length == 0,
    ),
  ).toHaveLength(0);

  await expect(
    async () =>
      await skdb2.exec("INSERT INTO test_pk VALUES ('my_group', 47);"),
  ).rejects.toThrow();

  await skdb.exec(
    "INSERT INTO skdb_group_permissions VALUES ('my_group', @uid, skdb_permission('rw'), 'read-write');",
    { uid: skdb2.currentUser },
  );

  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM skdb_group_permissions WHERE groupID='my_group'",
      (rows) => rows.length == 1,
    ),
  ).toHaveLength(1);
  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM test_pk WHERE skdb_access='my_group';",
      (rows) => rows.length == 1,
    ),
  ).toEqual([
    {
      skdb_access: "my_group",
      x: 37,
    },
  ]);

  await skdb2.exec("INSERT INTO test_pk VALUES ('my_group', 52);");

  expect(
    await waitSynch(
      skdb,
      "SELECT * FROM test_pk WHERE skdb_access='my_group';",
      (rows) => rows.length == 2,
    ),
  ).toHaveLength(2);
  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM test_pk WHERE skdb_access='my_group';",
      (rows) => rows.length == 2,
    ),
  ).toHaveLength(2);
}

async function testJSGroups(skdb1: SKDB, skdb2: SKDB) {
  const test_pk = {
    table: "test_pk",
    expectedColumns: "(x INTEGER PRIMARY KEY, y INTEGER, skdb_access TEXT)",
  };
  const test_pk_subset_schema = {
    table: "test_pk",
    expectedColumns: "(skdb_access TEXT, x INTEGER PRIMARY KEY)",
  };
  const view_pk = {
    table: "view_pk",
    expectedColumns: "(x INTEGER, y INTEGER, skdb_access TEXT)",
  };
  await skdb1.mirror(test_pk, view_pk);
  await skdb2.mirror(test_pk_subset_schema, view_pk);
  const user1 = skdb1.currentUser!;
  const user2 = skdb2.currentUser!;
  const group = await skdb1.createGroup();

  // user1 can see their own permissions on group, user2 is none the wiser

  const user1_visible_permissions = await waitSynch(
    skdb1,
    "SELECT * FROM skdb_group_permissions WHERE groupID IN (@groupID, @adminID, @ownerID)",
    (perms) => perms.length == 3,
    {
      groupID: group.groupID,
      adminID: group.adminGroupID,
      ownerID: group.ownerGroupID,
    },
  );
  expect(user1_visible_permissions).toHaveLength(3);

  const user2_visible_permissions = await waitSynch(
    skdb2,
    "SELECT * FROM skdb_group_permissions WHERE groupID IN (@groupID, @adminID, @ownerID)",
    (perms) => perms.length == 0,
    {
      groupID: group.groupID,
      adminID: group.adminGroupID,
      ownerID: group.ownerGroupID,
    },
  );
  expect(user2_visible_permissions).toHaveLength(0);

  // user1 can insert, user2 can not

  await skdb1.exec("INSERT INTO test_pk VALUES (1001, 1, @gid)", {
    gid: group.groupID,
  });

  await expect(
    async () =>
      await skdb2.exec("INSERT INTO test_pk VALUES (@gid, 1002)", {
        gid: group.groupID,
      }),
  ).rejects.toThrow();

  // user1 can read, user2 can not

  expect(
    await waitSynch(
      skdb1,
      "SELECT * FROM test_pk WHERE x = 1001;",
      (tail) => tail.length == 1,
    ),
  ).toHaveLength(1);
  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM test_pk WHERE x = 1001;",
      (tail) => tail.length == 0,
    ),
  ).toHaveLength(0);

  // user1 can grant read+write permissions to user2,
  // after which user2 can insert & read
  await group.setMemberPermission(user2, "rw");

  await new Promise((r) => setTimeout(r, 100));
  await skdb1.exec("INSERT INTO test_pk VALUES (1003, 3, @gid)", {
    gid: group.groupID,
  });
  await new Promise((r) => setTimeout(r, 100));
  await skdb2.exec("INSERT INTO test_pk VALUES (@gid, 1004)", {
    gid: group.groupID,
  });
  await new Promise((r) => setTimeout(r, 100));
  expect(
    await waitSynch(
      skdb1,
      "SELECT * FROM test_pk WHERE x > 1000;",
      (tail) => tail.length == 3,
    ),
  ).toHaveLength(3);
  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM test_pk WHERE x > 1000;",
      (tail) => tail.length == 3,
    ),
  ).toHaveLength(3);

  // user1 can grant admin permissions to user2, after which user2 can change member permissions

  await group.addAdmin(user2);
  await new Promise((r) => setTimeout(r, 100));

  const group_as_user2 = await skdb2.lookupGroup(group.groupID);

  await group_as_user2.setMemberPermission(user1, "rw");

  // user1 can still take admin actions as owner after removing themself as an admin

  await group.removeAdmin(user1);
  await new Promise((r) => setTimeout(r, 100));
  expect(
    await waitSynch(
      skdb1,
      "SELECT * FROM skdb_group_permissions WHERE groupID=@adminGroupID;",
      (admins) => admins.length == 1,
      { adminGroupID: group.adminGroupID },
    ),
  ).toHaveLength(1);

  // user1 can transfer ownership to user2, after which user1 can't delete the group but user2 can
  await group.transferOwnership(user2);

  await skdb1.exec(
    "DELETE FROM skdb_groups WHERE groupID=@groupID;", //rejected by server
    {
      groupID: group.groupID,
    },
  );

  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM skdb_groups WHERE groupID=@groupID",
      (groups) => groups.length == 1,
      { groupID: group.groupID },
    ),
  ).toHaveLength(1);
  await skdb2.exec("DELETE FROM skdb_groups WHERE groupID=@groupID;", {
    groupID: group.groupID,
  });
  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM skdb_groups WHERE groupID=@groupID",
      (groups) => groups.length == 0,
      { groupID: group.groupID },
    ),
  ).toHaveLength(0);
}

async function testSchemaChanges(root: SKDB, skdb1: SKDB, skdb2: SKDB) {
  const tt_extended = {
    table: "tt",
    expectedColumns:
      "(data TEXT, id INTEGER PRIMARY KEY, skdb_access TEXT, more_data TEXT)",
  };
  const tt_extracted = {
    table: "tt",
    expectedColumns:
      "(id INTEGER PRIMARY KEY, skdb_access TEXT, more_data TEXT)",
  };
  const tt_data = {
    table: "tt_data",
    expectedColumns:
      "(id INTEGER, data TEXT, skdb_access TEXT, skdb_original INTEGER)",
  };

  const rootRemote = await root.connectedRemote();
  await rootRemote!.exec(
    "CREATE TABLE tt (data TEXT, id INTEGER PRIMARY KEY, skdb_access TEXT);",
  );
  await rootRemote!.exec("ALTER TABLE tt ADD COLUMN more_data TEXT;");
  await rootRemote!.exec(`
  BEGIN TRANSACTION;
    CREATE TABLE tt_data as SELECT id, data, skdb_access, true AS skdb_original FROM tt;
    ALTER TABLE tt DROP COLUMN data;
  COMMIT;`);

  await skdb1.mirror(tt_extended);

  await skdb1.exec(
    "INSERT INTO tt (data, id, skdb_access, more_data) VALUES ('one', 1, 'read-write', 'a'), ('two', 2, 'read-write', 'b');",
  );

  await skdb2.mirror(tt_extracted, tt_data);

  await skdb2.exec(
    "INSERT INTO tt (id, skdb_access, more_data) VALUES (3, 'read-write', 'c');",
  );
  await skdb2.exec(
    "INSERT INTO tt_data (id, data, skdb_access, skdb_original) VALUES (3, 'three', 'read-write', true), (3, 'III', 'read-write', false);",
  );

  await skdb1.exec(
    "INSERT INTO tt (data, id, skdb_access, more_data) VALUES ('four', 4, 'read-write', 'd');",
  );

  await skdb2.exec(
    "INSERT INTO tt (id, skdb_access, more_data) VALUES (5, 'read-write', 'e');",
  );
  await skdb2.exec(
    "INSERT INTO tt_data (id, data, skdb_access, skdb_original) VALUES (5, 'five', 'read-write', true), (5, 'V', 'read-write', false);",
  );

  // skdb1 (on pre-extraction schema) should see tt:
  // 'one',   1, 'read-write', 'a'
  // 'two',   2, 'read-write', 'b'
  // 'three', 3, 'read-write', 'c'
  // 'four',  4, 'read-write', 'd'
  // 'five',  5, 'read-write', 'e'

  // skdb2 (on post-extraction schema) should see tt:
  // 1, 'read-write', 'a'
  // 2, 'read-write', 'b'
  // 3, 'read-write', 'c'
  // 4, 'read-write', 'd'
  // 5, 'read-write', 'e'
  // along with tt_data
  // 1, 'one',   'read-write', 1
  // 2, 'two',   'read-write', 1
  // 3, 'three', 'read-write', 1
  // 3, 'III',   'read-write', 0
  // 4, 'four',  'read-write', 1
  // 5, 'five',  'read-write', 1
  // 3, 'V',     'read-write', 0

  expect(
    await waitSynch(skdb1, "SELECT * FROM tt;", (rows) => rows.length == 5),
  ).toHaveLength(5);

  expect(
    await waitSynch(skdb2, "SELECT * FROM tt;", (rows) => rows.length == 5),
  ).toHaveLength(5);

  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM tt_data;",
      (rows) => rows.length == 7,
    ),
  ).toHaveLength(7);

  // Delete should also propagate to extracted-column tables and legacy view
  await skdb1.exec("DELETE FROM tt where id=1;");

  expect(
    await waitSynch(skdb1, "SELECT * FROM tt;", (rows) => rows.length == 4),
  ).toHaveLength(4);

  expect(
    await waitSynch(skdb2, "SELECT * FROM tt;", (rows) => rows.length == 4),
  ).toHaveLength(4);

  expect(
    await waitSynch(
      skdb2,
      "SELECT * FROM tt_data;",
      (rows) => rows.length == 6,
    ),
  ).toHaveLength(6);
}

export const apitests = (asWorker) => {
  return [
    {
      name: asWorker ? "API in Worker" : "API",
      fun: async (dbs: dbs) => {
        await testQueriesAgainstTheServer(dbs.root);

        await testSchemaQueries(dbs.user);

        await testMirroring(dbs.root, dbs.user, dbs.user2);

        //Privacy
        await testJSPrivacy(dbs.user, dbs.user2);
        await testJSGroups(dbs.user, dbs.user2);

        // Server Tail
        await testServerTail(dbs.root, dbs.user);
        await testClientTail(dbs.root, dbs.user);

        await testLargeMirror(dbs.root, dbs.user);

        await testMirrorWithAuthor(dbs.root, dbs.user, dbs.user2);

        await testConstraints(dbs.root, dbs.user);

        await testSchemaChanges(dbs.root, dbs.user, dbs.user2);

        // must come last: puts replication in to a permanent state of failure
        await testReboot(dbs.root, dbs.user, dbs.user2);

        dbs.root.closeConnection();
        dbs.user.closeConnection();
        dbs.user2.closeConnection();
        return "";
      },
      check: (res) => {
        expect(res).toEqual("");
      },
    },
  ];
};
