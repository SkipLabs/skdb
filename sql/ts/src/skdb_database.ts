import type { Environment, FileSystem } from "#std/sk_types.js";
import type {
  SKDBMechanism,
  SKDB,
  RemoteSKDB,
  SKDBHandle,
  Params,
  SKDBSync,
  MirrorDefn,
} from "./skdb_types.js";
import { SKDBTable } from "./skdb_util.js";
import { SKDBGroupImpl } from "./skdb_group.js";
import { connect } from "./skdb_orchestration.js";

class SKDBMechanismImpl implements SKDBMechanism {
  writeCsv: (payload: string, source: string) => void;
  watermark: (replicationUid: string, table: string) => bigint;
  watchFile: (fileName: string, fn: (change: ArrayBuffer) => void) => void;
  getReplicationUid: (deviceUuid: string) => string;
  subscribe: (
    replicationUid: string,
    tables: string[],
    updateFile: string,
  ) => string;
  unsubscribe: (session: string) => void;
  diff: (
    session: string,
    watermarks: Map<string, bigint>,
  ) => ArrayBuffer | null;
  assertCanBeMirrored: (tableName: string, schema: string) => void;
  tableExists: (tableName: string) => boolean;
  exec: (query: string) => SKDBTable;
  toggleView: (tableName: string) => void;

  constructor(
    client: SKDBSyncImpl,
    fs: FileSystem,
    utf8Encode: (v: string) => Uint8Array,
  ) {
    this.tableExists = (tableName: string) =>
      client.tableSchema(tableName) != "";
    this.exec = (query: string) => client.exec(query);
    this.assertCanBeMirrored = (tableName: string, schema: string) =>
      client.assertCanBeMirrored(tableName, schema);
    this.watermark = (replicationId: string, table: string) => {
      return BigInt(
        client.runLocal(["watermark", "--source", replicationId, table], ""),
      );
    };
    this.writeCsv = (payload: string, source: string) => {
      return client.runLocal(
        ["write-csv", "--enable-rebuilds", "--source", source],
        payload + "\n",
      );
    };
    this.watchFile = (fileName: string, fn: (change: ArrayBuffer) => void) => {
      fs.watchFile(fileName, (change) => {
        if (change == "") {
          return;
        }
        fn(utf8Encode(change));
      });
    };
    this.getReplicationUid = (deviceUuid: string) => {
      return client.runLocal(["replication-id", deviceUuid], "").trim();
    };
    this.subscribe = (
      replicationUid: string,
      tables: string[],
      updateFile: string,
    ) => {
      return client
        .runLocal(
          [
            "subscribe",
            "--format=csv",
            "--updates",
            updateFile,
            "--ignore-source",
            replicationUid,
          ].concat(tables),
          "",
        )
        .trim();
    };
    this.unsubscribe = (session: string) => {
      client.runLocal(["disconnect", session], "").trim();
    };
    this.diff = (session: string, watermarks: Map<string, bigint>) => {
      const acc = {};
      for (const [table, wm] of watermarks.entries()) {
        // @ts-ignore
        acc[table] = { since: wm };
      }
      const diffSpec = JSON.stringify(acc, (_key, value) =>
        typeof value === "bigint" ? Number(value) : value,
      );
      let d = client.runLocal(["diff", "--format=csv", session], diffSpec);
      if (d.trim() == "") {
        return null;
      }
      return utf8Encode(d);
    };
    this.toggleView = (table: string) => {
      return client.runLocal(["toggle-view", table], "");
    };
  }
}

export class SKDBSyncImpl implements SKDBSync {
  private environment: Environment;
  private subscriptionCount: number = 0;
  private clientUuid: string = "";
  private accessKey?: string;
  private fs: FileSystem;

  save!: () => Promise<boolean>;
  runLocal!: (new_args: Array<string>, new_stdin: string) => string;
  watch!: (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => { close: () => void };
  watchChanges!: (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => { close: () => void };

  private runner!: (fn: () => string) => SKDBTable;

  connectedRemote?: RemoteSKDB;

  private constructor(environment: Environment) {
    this.environment = environment;
    this.fs = environment.fs();
  }

  static create(
    handle: SKDBHandle,
    env: Environment,
    save: () => Promise<boolean>,
  ): SKDBSync {
    let client = new SKDBSyncImpl(env);
    client.save = save;
    client.runLocal = handle.main;
    client.clientUuid = env.crypto().randomUUID();
    client.runner = handle.runner;
    client.watch = handle.watch;
    client.watchChanges = handle.watchChanges;
    return client;
  }

  async connect(
    db: string,
    accessKey: string,
    privateKey: CryptoKey,
    endpoint?: string,
  ): Promise<void> {
    if (!endpoint) {
      endpoint = "wss://api.skiplabs.io";
    }

    const creds = {
      accessKey: accessKey,
      privateKey: privateKey,
      deviceUuid: this.clientUuid,
    };

    this.accessKey = accessKey;

    const mechanism = new SKDBMechanismImpl(this, this.fs, this.environment.encodeUTF8);

    this.connectedRemote = await connect(
      this.environment,
      mechanism,
      endpoint,
      db,
      creds,
    );

    // Setting up local privacy checks
    await this.mirror(
      {
        table: "skdb_user_permissions",
        expectedColumns:
          "(userID TEXT PRIMARY KEY, permissions INTEGER NOT NULL, skdb_access TEXT NOT NULL)",
      },
      {
        table: "skdb_group_permissions",
        expectedColumns:
          "(groupID TEXT NOT NULL, userID TEXT, permissions INTEGER NOT NULL, skdb_access TEXT NOT NULL)",
      },
      {
        table: "skdb_groups",
        expectedColumns:
          "(groupID TEXT PRIMARY KEY, skdb_author TEXT, adminID TEXT NOT NULL, skdb_access TEXT NOT NULL)",
      },
    );
    this.exec(
      "CREATE UNIQUE INDEX skdb_permissions_group_user ON skdb_group_permissions(groupID, userID);",
    );

    this.notifyConnectedAs(accessKey, mechanism.getReplicationUid(this.clientUuid));
  }

  getUser(): string | undefined {
    return this.accessKey;
  }

  watermark(replicationId: string, table: string): bigint {
    return BigInt(
      this.runLocal(["watermark", "--source", replicationId, table], ""),
    );
  }

  subscribe = (viewName: string, f: (change: string) => void) => {
    const fileName = "/subscriptions/sub" + this.subscriptionCount;
    this.fs.watchFile(fileName, f);
    this.subscriptionCount++;
    this.runLocal(
      ["subscribe", viewName, "--format=csv", "--updates", fileName],
      "",
    );
  };

  addParams = (
    args: Array<string>,
    params: Params,
    stdin: string,
  ): [Array<string>, string] => {
    if (params instanceof Map) {
      params = Object.fromEntries(params);
    }
    let args1 = ["--expect-query-params"].concat(args);
    let stdin1 = JSON.stringify(params) + "\n" + stdin;
    return [args1, stdin1];
  };

  exec = (stdin: string, params: Params = new Map()) => {
    return this.runner(() => {
      let [args1, stdin1] = this.addParams(["--format=js"], params, stdin);
      return this.runLocal(args1, stdin1);
    });
  };

  tableSchema = (tableName: string) => {
    return this.runLocal(["dump-table", tableName], "");
  };

  notifyConnectedAs = (userName: string, replicationId: string) => {
    return this.runLocal(
      [
        "connected-as",
        "--userId", userName,
        "--replicationId", replicationId
      ], "");
  };

  viewSchema = (viewName: string) => {
    return this.runLocal(["dump-view", viewName], "");
  };

  schema = (tableName?: string) => {
    if (tableName === undefined) {
      const tables = this.runLocal(["dump-tables"], "");
      const views = this.runLocal(["dump-views"], "");
      return tables + views;
    }

    const viewSchema = this.viewSchema(tableName);
    if (viewSchema.trim() != "") {
      return viewSchema;
    }

    return this.tableSchema(tableName);
  };

  insert = (tableName: string, values: Array<any>) => {
    let params = new Map();
    let keys = values.map((val, i) => {
      let key = "@key" + i;
      params.set(key, val);
      return key;
    });
    let stdin =
      "insert into " + tableName + " values (" + keys.join(", ") + ");";
    let [args1, stdin1] = this.addParams([], params, stdin);
    return this.runLocal(args1, stdin1) == "";
  };

  insertMany = (tableName: string, valuesArray: Array<Record<string, any>>) => {
    let params = new Map();
    let valueIndex = 0;
    let keyNbr = 0;

    let colTypes = this.tableSchema(tableName)
      .replace(/.*\(/, "")
      .replace(");", "")
      .replace(/\n/g, "")
      .replace(/[ ]+/g, " ")
      .split(",");

    let colNames = colTypes.map((col) => col.split(" ")[1]);

    let colIndex = new Map();
    for (let i in colNames) {
      colIndex.set(colNames[i], i);
    }

    while (valueIndex < valuesArray.length) {
      let buffer = new Array();
      buffer.push("insert into " + tableName + " values ");
      for (let roundIdx = 0; roundIdx < 1000; roundIdx++) {
        if (valueIndex >= valuesArray.length) break;
        let values = new Array();
        let valuesSize = 0;
        let obj = valuesArray[valueIndex];
        for (let fieldName in obj) {
          if (!colIndex.has(fieldName)) {
            return new Error("Field not found: " + fieldName);
          }
          values[colIndex.get(fieldName)] = obj[fieldName];
          valuesSize++;
        }
        if (valuesSize < colTypes.length) {
          let error;
          colIndex.forEach((_, fieldName) => {
            if (!obj.hasOwnProperty(fieldName)) {
              error = new Error("Missing field: " + fieldName);
            }
          });
          throw error;
        }
        let keys = values.map((val, _) => {
          let key = "@key" + keyNbr;
          keyNbr++;
          params.set(key, val);
          return key;
        });
        if (roundIdx != 0) buffer.push(",");
        buffer.push("(" + keys.join(", ") + ")");
        valueIndex++;
      }
      buffer.push(";");
      let [args1, stdin1] = this.addParams([], params, buffer.join(""));
      let stderr = this.runLocal(args1, stdin1);
      if (stderr != "") {
        throw Error(stderr);
      }
    }
    return valueIndex;
  };

  assertCanBeMirrored(tableName: string, schema: string): void {
    const error = this.runLocal(["can-mirror", tableName, schema], "");
    if (error === "") {
      return;
    }
    throw new Error(error);
  }
  async mirror(...tables: MirrorDefn[]) {
    const is_mirror_def_of = (table: any) => (mirror_def: any) =>
      mirror_def.table === table;
    // order matters. we want to mirror up group permission changes
    // before group changes to handle cyclic dependencies
    for (const metatable of [
      {
        table: "skdb_user_permissions",
        expectedColumns:
          "(userID TEXT PRIMARY KEY, permissions INTEGER NOT NULL, skdb_access TEXT NOT NULL)",
      },
      {
        table: "skdb_group_permissions",
        expectedColumns:
          "(groupID TEXT NOT NULL, userID TEXT, permissions INTEGER NOT NULL, skdb_access TEXT NOT NULL)",
      },
      {
        table: "skdb_groups",
        expectedColumns:
          "(groupID TEXT PRIMARY KEY, skdb_author TEXT, adminID TEXT NOT NULL, skdb_access TEXT NOT NULL)",
      },
    ]) {
      if (!tables.some(is_mirror_def_of(metatable.table)))
        tables.push(metatable);
    }
    return this.connectedRemote!.mirror(...tables);
  }

  async serverExec(query: string, params?: Params): Promise<SKDBTable> {
    return this.connectedRemote!.exec(query, params);
  }

  async serverTableSchema(tableName: string) {
    return this.connectedRemote!.tableSchema(tableName);
  }

  async serverViewSchema(tableName: string) {
    return this.connectedRemote!.viewSchema(tableName);
  }

  async serverSchema() {
    return this.connectedRemote!.schema();
  }

  createServerDatabase = (dbName: string) =>
    this.connectedRemote!.createDatabase(dbName);
  createServerUser = () => this.connectedRemote!.createUser();
  serverClose = () => this.connectedRemote!.close();
}

export class SKDBImpl implements SKDB {
  private skdbSync: SKDBSync;

  constructor(skdbSync: SKDBSync) {
    this.skdbSync = skdbSync;
  }

  currentUser?: string;

  async connect(
    db: string,
    accessKey: string,
    privateKey: CryptoKey,
    endpoint?: string,
  ): Promise<void> {
    this.currentUser = accessKey;
    return this.skdbSync.connect(db, accessKey, privateKey, endpoint);
  }

  connectedRemote = async () => {
    return this.skdbSync.connectedRemote;
  };

  subscribe = async (viewName: string, f: (change: string) => void) => {
    return this.skdbSync.subscribe(viewName, f);
  };

  exec = async (stdin: string, params: Params = new Map()) => {
    const rows = await this.skdbSync.exec(stdin, params);
    return new SKDBTable(...rows);
  };

  async watch(
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) {
    let closable = this.skdbSync.watch(query, params, onChange);
    return Promise.resolve({ close: () => Promise.resolve(closable.close()) });
  }

  async watchChanges(
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) {
    let closable = this.skdbSync.watchChanges(query, params, init, update);
    return Promise.resolve({ close: () => Promise.resolve(closable.close()) });
  }

  tableSchema = async (tableName: string) => {
    return this.skdbSync.tableSchema(tableName);
  };

  viewSchema = async (viewName: string) => {
    return this.skdbSync.viewSchema(viewName);
  };

  schema = async (tableName?: string) => {
    return this.skdbSync.schema(tableName);
  };

  async insert(tableName: string, values: Array<any>) {
    return this.skdbSync.insert(tableName, values);
  }

  async insertMany(tableName: string, valuesArray: Array<Record<string, any>>) {
    let result = this.skdbSync.insertMany(tableName, valuesArray);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  async mirror(...tables: MirrorDefn[]) {
    return this.skdbSync.mirror(...tables);
  }

  async closeConnection() {
    return this.skdbSync.serverClose();
  }

  async save() {
    return this.skdbSync.save();
  }

  // @ts-ignore
  async createGroup() {
    return SKDBGroupImpl.create(this);
  }

  async lookupGroup(groupID: string) {
    return SKDBGroupImpl.lookup(this, groupID);
  }
}
