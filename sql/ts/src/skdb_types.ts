import type { Shared } from "#std/sk_types.js";
import { SKDBTable } from "./skdb_util.js";

export interface SKDBHandle {
  runner: (fn: () => string) => SKDBTable;
  main: (new_args: Array<string>, new_stdin: string) => string;
  watch: (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => { close: () => void };
  watchChanges: (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => { close: () => void };
}

export type MirrorDefn = {
  table: string;
  expectedColumns: string;
  filterExpr?: string;
  filterParams?: Params;
};

export interface SKDBSync {
  // CLIENT
  exec: (query: string, params?: Params) => SKDBTable;
  watch: (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => { close: () => void };
  watchChanges: (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => { close: () => void };
  insert: (tableName: string, values: Array<any>) => boolean;
  insertMany: (
    tableName: string,
    valuesArray: Array<Record<string, any>>,
  ) => number | Error;

  tableSchema: (tableName: string) => string;
  viewSchema: (viewName: string) => string;
  schema: (tableName?: string) => string;
  subscribe: (viewName: string, f: (change: string) => void) => void;
  save: () => Promise<boolean>;

  // SERVER
  connect: (
    db: string,
    accessKey: string,
    privateKey: CryptoKey,
    endpoint?: string,
  ) => Promise<void>;
  mirror: (...tables: MirrorDefn[]) => Promise<void>;

  connectedRemote?: RemoteSKDB;
  createServerDatabase: (dbName: string) => Promise<ProtoResponseCreds>;
  createServerUser: () => Promise<ProtoResponseCreds>;
  serverExec: (query: string, params?: Params) => Promise<SKDBTable>;
  serverTableSchema: (tableName: string) => Promise<string>;
  serverViewSchema: (tableName: string) => Promise<string>;
  serverSchema: () => Promise<string>;
  serverClose: () => void;
}

export interface SKDB {
  exec: (query: string, params?: Params) => Promise<SKDBTable>;
  watch: (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => Promise<{ close: () => Promise<void> }>;
  watchChanges: (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => Promise<{ close: () => Promise<void> }>;

  insertMany: (
    tableName: string,
    valuesArray: Array<Record<string, any>>,
  ) => Promise<number>;

  insert: (tableName: string, valuesArray: Array<any>) => Promise<boolean>;

  connect: (
    db: string,
    accessKey: string,
    privateKey: CryptoKey,
    endpoint?: string,
  ) => Promise<void>;
  connectedRemote: () => Promise<RemoteSKDB | undefined>;
  closeConnection: () => Promise<void>;

  createGroup: () => Promise<SKDBGroup>;
  lookupGroup: (groupID: string) => Promise<SKDBGroup | undefined>;

  currentUser?: string;

  mirror: (...tables: MirrorDefn[]) => Promise<void>;

  schema: (tableName?: string) => Promise<string>;
  save: () => Promise<boolean>;
}

export interface SKDBMechanism {
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
  tableExists: (tableName: string) => boolean;
  exec: (query: string) => SKDBTable;
  assertCanBeMirrored: (table: string, schema: string) => void;
  toggleView: (tableName: string) => void;
}

export interface Storage {
  save(): Promise<boolean>;
}

export type ProtoResponseCreds = {
  type: "credentials";
  accessKey: string;
  privateKey: Uint8Array;
};

export type Params =
  | Map<string, string | number | boolean | null>
  | Record<string, string | number | boolean | null>;

export interface RemoteSKDB {
  connectedAs(): Promise<string>;

  createUser(): Promise<ProtoResponseCreds>;
  schema: () => Promise<string>;
  tableSchema: (tableName: string) => Promise<string>;
  viewSchema: (viewName: string) => Promise<string>;

  createDatabase: (dbName: string) => Promise<ProtoResponseCreds>;

  mirror: (...tables: MirrorDefn[]) => Promise<void>;
  exec: (query: string, params?: Params) => Promise<SKDBTable>;

  isConnectionHealthy: () => Promise<boolean>;
  tablesAwaitingSync: () => Promise<Set<string>>;

  onReboot: (fn: () => void) => Promise<void>;

  close(): Promise<void>;
}

export type Page = { pageid: number; content: any };

export interface PagedMemory {
  init(fn: (page: Page) => void): void;
  restore(pages: Array<Page>): void;
  clear(): void;
  update(): void;
  getPages(): Promise<Array<Page>>;
}

export interface SKDBShared extends Shared {
  create: (dbName?: string, asWorker?: boolean) => Promise<SKDB>;
  createSync: (dbName?: string, asWorker?: boolean) => Promise<SKDBSync>;
  queryResult(): Array<any>;
}

export interface SKDBGroup {
  ownerGroupID: string;
  adminGroupID: string;
  groupID: string;

  setDefaultPermission: (perm: string) => Promise<void>;
  setMemberPermission: (userID: string, perm: string) => Promise<void>;

  addAdmin: (userID: string) => Promise<void>;
  removeAdmin: (userID: string) => Promise<void>;

  addOwner: (userID: string) => Promise<void>;
  removeOwner: (userID: string) => Promise<void>;
  transferOwnership: (userID: string) => Promise<void>;

  removeMember: (userID: string) => Promise<void>;
}

export interface SKDBTransaction {
  add: (stmt: string) => SKDBTransaction;
  addParams: (params: Params) => SKDBTransaction;
  commit: (additionalParams?: Params) => Promise<SKDBTable>;
}
