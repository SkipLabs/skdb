import type { Wrk } from "#std/sk_types.js";
import { PromiseWorker, Function, Caller } from "#std/sk_worker.js";
import type {
  SKDB,
  ProtoResponseCreds,
  Params,
  RemoteSKDB,
  MirrorDefn,
} from "./skdb_types.js";
import { SKDBTable } from "./skdb_util.js";
import { SKDBGroupImpl } from "./skdb_group.js";

class WrappedRemote implements RemoteSKDB {
  private worker: PromiseWorker;
  private wrapped: number;

  constructor(worker: PromiseWorker, wrapped: number) {
    this.worker = worker;
    this.wrapped = wrapped;
  }

  createDatabase(dbName: string) {
    return this.worker
      .post(new Caller(this.wrapped, "createDatabase", [dbName]))
      .send();
  }

  createUser() {
    return this.worker.post(new Caller(this.wrapped, "createUser", [])).send();
  }

  schema() {
    return this.worker.post(new Caller(this.wrapped, "schema", [])).send();
  }

  tableSchema(tableName: string) {
    return this.worker
      .post(new Caller(this.wrapped, "tableSchema", [tableName]))
      .send();
  }

  notifyConnectedAs(userName: string, replicationId: string) {
    return this.worker
      .post(new Caller(this.wrapped, "notifyConnectedAs", [userName, replicationId]))
      .send();
  }

  viewSchema(viewName: string) {
    return this.worker
      .post(new Caller(this.wrapped, "viewSchema", [viewName]))
      .send();
  }

  mirror(...tables: MirrorDefn[]) {
    return this.worker.post(new Caller(this.wrapped, "mirror", tables)).send();
  }

  exec(query: string, params?: Params) {
    return this.worker
      .post(new Caller(this.wrapped, "exec", [query, params]))
      .send()
      .then((rows) => new SKDBTable(...rows));
  }

  close() {
    return this.worker.post(new Caller(this.wrapped, "close", [], true)).send();
  }

  isConnectionHealthy() {
    return this.worker
      .post(new Caller(this.wrapped, "isConnectionHealthy", []))
      .send();
  }

  tablesAwaitingSync() {
    return this.worker
      .post(new Caller(this.wrapped, "tablesAwaitingSync", []))
      .send();
  }

  onReboot(fn: () => void): Promise<void> {
    return this.worker.post(new Caller(this.wrapped, "onReboot", [fn])).send();
  }

  connectedAs(): Promise<string> {
    return this.worker.post(new Caller(this.wrapped, "connectedAs", [])).send();
  }
}

export class SKDBWorker implements SKDB {
  private worker: PromiseWorker;

  constructor(worker: Wrk) {
    this.worker = new PromiseWorker(worker);
  }

  create = async (dbName?: string): Promise<void> => {
    return this.worker.post(new Function("create", [dbName])).send();
  };

  exec = async (query: string, params: Params = new Map()) => {
    const rows = await this.worker
      .post(new Function("exec", [query, params]))
      .send();
    return new SKDBTable(...rows);
  };

  watch = async (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => {
    let provider = this.worker.post(
      new Function("watch", [query, params, onChange], {
        wrap: true,
        autoremove: true,
      }),
    );
    return provider.send().then((wrapped) => {
      let close = () =>
        this.worker
          .post(new Caller(wrapped.wrapped, "close", []))
          .send()
          .then(provider.close);
      return { close: close };
    });
  };

  watchChanges = async (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => {
    let provider = this.worker.post(
      new Function("watchChanges", [query, params, init, update], {
        wrap: true,
        autoremove: true,
      }),
    );
    return provider.send().then((wrapped) => {
      let close = () =>
        this.worker
          .post(new Caller(wrapped.wrapped, "close", []))
          .send()
          .then(provider.close);
      return { close: close };
    });
  };

  tableSchema = async (tableName: string) => {
    return this.worker
      .post(new Function("tableSchema", [tableName]))
      .send() as Promise<string>;
  };

  notifyConnectedAs = async (userName: string, replicationId: string) => {
    return this.worker
      .post(new Function("notifyConnectedAs", [userName, replicationId]))
      .send() as Promise<void>;
  };

  viewSchema = async (viewName: string) => {
    return this.worker
      .post(new Function("viewSchema", [viewName]))
      .send() as Promise<string>;
  };

  schema = async (tableName?: string) => {
    return this.worker
      .post(new Function("schema", [tableName]))
      .send() as Promise<string>;
  };

  insert = async (tableName: string, values: Array<any>) => {
    return this.worker
      .post(new Function("insert", [tableName, values]))
      .send() as Promise<boolean>;
  };

  insertMany = async (
    tableName: string,
    valuesArray: Array<Record<string, any>>,
  ) => {
    let result = await this.worker
      .post(new Function("insertMany", [tableName, valuesArray]))
      .send();
    if (result instanceof Error) {
      throw result;
    }
    return result as Promise<number>;
  };

  save = async () => {
    return this.worker
      .post(new Function("save", []))
      .send() as Promise<boolean>;
  };

  createServerDatabase = async (dbName: string) => {
    return this.worker
      .post(new Function("createServerDatabase", [dbName]))
      .send() as Promise<ProtoResponseCreds>;
  };

  createServerUser = async () => {
    return this.worker
      .post(new Function("createServerUser", []))
      .send() as Promise<ProtoResponseCreds>;
  };

  mirror = async (...tables: MirrorDefn[]) => {
    return this.worker.post(new Function("mirror", tables)).send();
  };

  closeConnection = async () => {
    return this.worker.post(new Function("closeConnection", [])).send();
  };

  currentUser?: string;

  connect = async (
    db: string,
    accessKey: string,
    privateKey: CryptoKey,
    endpoint?: string,
  ) => {
    this.currentUser = accessKey;
    return this.worker
      .post(new Function("connect", [db, accessKey, privateKey, endpoint]))
      .send();
  };

  connectedRemote = async () => {
    return this.worker
      .post(
        new Function("connectedRemote", [], { wrap: true, autoremove: false }),
      )
      .send()
      .then((wrapped) => new WrappedRemote(this.worker, wrapped.wrapped));
  };

  getUser = async () => {
    return this.worker.post(new Function("getUser", [])).send();
  };

  // @ts-ignore
  createGroup = async () => {
    return SKDBGroupImpl.create(this);
  };

  lookupGroup = async (groupID: string) => {
    return SKDBGroupImpl.lookup(this, groupID);
  };
}
