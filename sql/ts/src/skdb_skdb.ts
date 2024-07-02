// sknpm: Cannot be multiline for package sources
// prettier-ignore
import type { int, ptr, Environment, Links, ToWasmManager, Utils, Shared } from "#std/sk_types.js";
import type {
  PagedMemory,
  Page,
  Storage,
  SKDBHandle,
  Params,
  SKDBSync,
} from "./skdb_types.js";
import { ExternalFuns, SKDBTable } from "./skdb_util.js";
import { IDBStorage } from "./skdb_storage.js";
import { SKDBImpl, SKDBSyncImpl } from "./skdb_database.js";

interface Exported {
  sk_pop_dirty_page: () => number;
  SKIP_get_version: () => number;
  skip_main: () => void;
  //
  SKIP_reactive_query: (
    queryID: number,
    query: number,
    encoded_params: number,
  ) => void;
  SKIP_reactive_query_changes: (
    queryID: number,
    query: number,
    encoded_params: number,
  ) => void;
  SKIP_reactive_print_result: (queryID: number) => void;
  SKIP_delete_reactive_query: (queryID: number) => void;
  getVersion: () => number;
}

class SKDBHandleImpl implements SKDBHandle {
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

  constructor(
    main: (new_args: Array<string>, new_stdin: string) => string,
    runner: (fn: () => string) => SKDBTable,
    watch: (
      query: string,
      params: Params,
      onChange: (rows: SKDBTable) => void,
    ) => { close: () => void },
    watchChanges: (
      query: string,
      params: Params,
      init: (rows: SKDBTable) => void,
      update: (added: SKDBTable, removed: SKDBTable) => void,
    ) => { close: () => void },
  ) {
    this.runner = runner;
    this.main = main;
    this.watch = watch;
    this.watchChanges = watchChanges;
  }

  init() {
    this.main([], "");
  }
}

interface ToWasm {
  SKIP_last_tick: (queryID: int) => int;
  SKIP_switch_to: (stream: int) => void;
  SKIP_clear_field_names: () => void;
  SKIP_push_field_name: (skName: ptr) => void;
  SKIP_clear_object: () => void;
  SKIP_push_object_field_null: () => void;
  SKIP_push_object_field_int32: (field: int) => void;
  SKIP_push_object_field_int64: (field: ptr) => void;
  SKIP_push_object_field_float: (field: ptr) => void;
  SKIP_push_object_field_string: (field: ptr) => void;
  SKIP_push_object: () => void;
  SKIP_js_mark_query: (queryID: int) => void;
  SKIP_js_delete_fun: (queryID: int) => void;
}

class SKDBMemory implements PagedMemory {
  memory: ArrayBuffer;
  persistentSize: number;
  nbrInitPages: number;
  pageSize: number;
  popDirtyPage: () => number;
  private dirtyPagesMap!: Array<number>;
  private dirtyPages!: Array<number>;

  constructor(
    memory: ArrayBuffer,
    persistentSize: number,
    popDirtyPage: () => number,
    pageBitSize: number = 20,
  ) {
    this.memory = memory;
    this.persistentSize = persistentSize;
    this.pageSize = 1 << pageBitSize;
    this.nbrInitPages = persistentSize / this.pageSize + 1;
    this.popDirtyPage = popDirtyPage;
  }

  clear = () => {
    this.dirtyPagesMap = [];
    this.dirtyPages = [];
  };

  update = () => {
    while (true) {
      let dirtyPage = this.popDirtyPage();
      if (dirtyPage == -1) break;
      if (dirtyPage >= this.nbrInitPages) {
        if (this.dirtyPagesMap[dirtyPage] != dirtyPage) {
          this.dirtyPagesMap[dirtyPage] = dirtyPage;
          this.dirtyPages.push(dirtyPage);
        }
      }
    }

    for (let dirtyPage = 0; dirtyPage < this.nbrInitPages; dirtyPage++) {
      if (this.dirtyPagesMap[dirtyPage] != dirtyPage) {
        this.dirtyPagesMap[dirtyPage] = dirtyPage;
        this.dirtyPages.push(dirtyPage);
      }
    }
  };

  private async copyPage(start: number, end: number): Promise<ArrayBuffer> {
    return this.memory.slice(start, end);
  }

  init(fn: (page: Page) => void) {
    // Let's round up the memorySize to be pageSize aligned
    let memorySize =
      (this.persistentSize + (this.pageSize - 1)) & ~(this.pageSize - 1);
    let i: number;
    let cursor = 0;
    for (i = 0; i < memorySize / this.pageSize; i++) {
      const content = this.memory.slice(cursor, cursor + this.pageSize);
      fn({ pageid: i, content: content });
      cursor = cursor + this.pageSize;
    }
  }

  restore(pages: Array<Page>) {
    let memory32 = new Uint32Array(this.memory);
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      let page = pages[pageIdx]!;
      const pageid = page.pageid;
      if (pageid < 0) continue;
      let pageBuffer = new Uint32Array(page.content);
      const start = pageid * (this.pageSize / 4);
      for (let i = 0; i < pageBuffer.length; i++) {
        memory32[start + i] = pageBuffer[i]!;
      }
    }
  }

  async getPages() {
    let pages = this.dirtyPages;
    let copiedPages = new Array();
    for (let j = 0; j < pages.length; j++) {
      let page = pages[j]!;
      let start = page * this.pageSize;
      let end = page * this.pageSize + this.pageSize;
      let content = await this.copyPage(start, end);
      copiedPages.push({ pageid: page, content });
    }
    return copiedPages;
  }
}

class SKDBShared implements Shared {
  getName = () => "SKDB";
  createSync: (dbName?: string, asWorker?: boolean) => Promise<SKDBSync>;
  constructor(
    createSync: (dbName?: string, asWorker?: boolean) => Promise<SKDBSync>,
  ) {
    this.createSync = createSync;
  }

  async create(dbName?: string, asWorker?: boolean) {
    let skdbSync = await this.createSync(dbName);
    return new SKDBImpl(skdbSync);
  }
}

class LinksImpl implements Links, ToWasm {
  private environment: Environment;
  private state: ExternalFuns;
  private field_names: Array<string>;
  private objectIdx: number;
  private stream: number;
  private object: { [k: string]: any };
  private stdout_objects: Array<Array<any>>;
  private storage?: Storage;
  //
  private queryID: number;
  private userFuns: Array<() => void>;
  private funLastTick: Map<number, number>;
  private queriesToNotify: Set<number>;
  private notifications: Array<Set<number>>;
  private notifying: boolean;
  private freeQueryIDs: Array<number>;

  SKIP_last_tick!: (queryID: int) => int;
  SKIP_switch_to!: (stream: int) => void;
  SKIP_call_external_fun!: (funId: int, skParam: ptr) => ptr;
  SKIP_clear_field_names!: () => void;
  SKIP_push_field_name!: (skName: ptr) => void;
  SKIP_clear_object!: () => void;
  SKIP_push_object_field_null!: () => void;
  SKIP_push_object_field_int32!: (field: int) => void;
  SKIP_push_object_field_int64!: (field: ptr) => void;
  SKIP_push_object_field_float!: (field: ptr) => void;
  SKIP_push_object_field_string!: (field: ptr) => void;
  SKIP_push_object!: () => void;
  SKIP_js_mark_query!: (queryID: int) => void;
  SKIP_js_delete_fun!: (queryID: int) => void;
  // Utils
  notifyAllJS!: () => void;
  checkNotifications!: () => void;

  constructor(environment: Environment) {
    this.environment = environment;
    this.state = new ExternalFuns();
    this.field_names = new Array();
    this.queryID = 0;
    this.userFuns = new Array();
    this.freeQueryIDs = new Array();
    this.funLastTick = new Map();
    this.queriesToNotify = new Set();
    this.notifications = [];
    this.notifying = false;
    this.objectIdx = 0;
    this.object = {};
    this.stream = 0;
    this.stdout_objects = [[], [], [], []];
  }

  complete = (utils: Utils, exports: object) => {
    let exported = exports as Exported;
    this.notifyAllJS = () => {
      if (this.queriesToNotify.size > 0) {
        this.notifications.push(this.queriesToNotify);
        this.queriesToNotify = new Set();
        this.checkNotifications();
      }
    };
    this.checkNotifications = () => {
      if (!this.notifying) {
        this.notifying = true;
        try {
          while (this.notifications.length > 0) {
            const toNotify = this.notifications.shift();
            if (toNotify) {
              toNotify.forEach((value) => {
                utils.runCheckError(() =>
                  exported.SKIP_reactive_print_result(value),
                );
                this.userFuns[value]!();
              });
            }
          }
        } catch (exn) {
          throw exn;
        } finally {
          this.notifying = false;
        }
      }
    };
    this.SKIP_call_external_fun = (funId: int, skParam: ptr) => {
      let res = this.state.call(funId, JSON.parse(utils.importString(skParam)));
      let strRes = JSON.stringify(res === undefined ? null : res);
      return utils.exportString(strRes);
    };
    this.SKIP_last_tick = (queryID: int) => {
      return this.funLastTick.get(queryID) ?? 0;
    };
    this.SKIP_switch_to = (stream: int) => {
      this.stream = stream;
    };
    this.SKIP_clear_field_names = () => {
      this.field_names = new Array();
    };
    this.SKIP_push_field_name = (skName: ptr) => {
      this.field_names.push(utils.importString(skName));
    };
    this.SKIP_clear_object = () => {
      this.objectIdx = 0;
      this.object = {};
    };
    this.SKIP_push_object_field_null = () => {
      let field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = null;
      this.objectIdx++;
    };
    this.SKIP_push_object_field_int32 = (n: int) => {
      let field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = n;
      this.objectIdx++;
    };
    this.SKIP_push_object_field_int64 = (skV: ptr) => {
      let field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = parseInt(utils.importString(skV), 10);
      this.objectIdx++;
    };
    this.SKIP_push_object_field_float = (skV: ptr) => {
      let field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = parseFloat(utils.importString(skV));
      this.objectIdx++;
    };
    this.SKIP_push_object_field_string = (skV: ptr) => {
      let field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = utils.importString(skV);
      this.objectIdx++;
    };
    this.SKIP_push_object = () => {
      let objects = this.stdout_objects[this.stream];
      if (!objects) {
        this.stdout_objects[this.stream] = new Array();
      }
      this.stdout_objects[this.stream].push(this.object);
    };
    this.SKIP_js_mark_query = (queryID: int) => {
      this.queriesToNotify.add(queryID);
    };
    this.SKIP_js_delete_fun = (queryID: int) => {
      this.funLastTick.set(queryID, 0);
      this.freeQueryIDs.push(queryID);
    };
    let runner = (fn: () => string) => {
      this.stdout_objects = [[], [], [], []];
      this.stream = 0;
      let stdout = fn();
      if (stdout == "") {
        let result = this.stdout_objects[0];
        this.stdout_objects = [[], [], [], []];
        return new SKDBTable(...result);
      }
      throw new Error(stdout);
    };
    let main = (new_args: Array<string>, new_stdin: string) => {
      let res = utils.main(new_args, new_stdin);
      this.notifyAllJS();
      return res;
    };
    let manageWatch = (
      query: string,
      params: Params,
      reactive_query: (
        queryID: number,
        query: number,
        encoded_params: number,
      ) => void,
      queryFun: (queryID: int, init: boolean) => void,
    ) => {
      if (params instanceof Map) {
        params = Object.fromEntries(params);
      }
      this.stdout_objects = [[], [], [], []];
      this.stream = 0;
      const freeQueryID = this.freeQueryIDs.pop();
      const queryID = freeQueryID === undefined ? this.queryID++ : freeQueryID;
      this.funLastTick.set(queryID, 0);
      let userFun = () => queryFun(queryID, false);
      this.userFuns[queryID] = userFun;
      utils.runWithGc(() => {
        utils.runCheckError(() => {
          reactive_query(
            queryID,
            utils.exportString(query),
            utils.exportString(JSON.stringify(params)),
          );
        });
      });
      queryFun(queryID, true);
      return {
        close: () => {
          this.userFuns[queryID] = () => {};
          utils.runCheckError(() =>
            exported.SKIP_delete_reactive_query(queryID),
          );
        },
      };
    };

    let watch = (
      query: string,
      params: Params,
      onChange: (rows: SKDBTable) => void,
    ) => {
      return manageWatch(
        query,
        params,
        exported.SKIP_reactive_query,
        (_queryID) => {
          onChange(new SKDBTable(...this.stdout_objects[0]));
          this.stdout_objects = [[], [], [], []];
        },
      );
    };
    let watchChanges = (
      query: string,
      params: Params,
      init: (rows: SKDBTable) => void,
      update: (added: SKDBTable, removed: SKDBTable) => void,
    ) => {
      return manageWatch(
        query,
        params,
        exported.SKIP_reactive_query_changes,
        (queryID, first) => {
          const rows = new SKDBTable(...this.stdout_objects[0]);
          const added = new SKDBTable(...this.stdout_objects[1]);
          const removed = new SKDBTable(...this.stdout_objects[2]);
          const tick = this.stdout_objects[3][0].tick;
          if (added.length > 0 || removed.length > 0) {
            update(added, removed);
          } else if (rows.length || first) {
            init(rows);
          }
          this.funLastTick.set(queryID, tick);
          this.stdout_objects = [[], [], [], []];
        },
      );
    };
    let handle = new SKDBHandleImpl(main, runner, watch, watchChanges);
    let createSync = async (dbName?: string) => {
      let save: () => Promise<boolean> = async () => true;
      let storeName = dbName ? "SKDBStore" : null;
      if (storeName != null) {
        let memory = new SKDBMemory(
          utils.getMemoryBuffer(),
          utils.getPersistentSize(),
          exported.sk_pop_dirty_page,
        );
        this.storage = await IDBStorage.create(
          dbName!,
          storeName,
          exported.getVersion(),
          memory,
        );
        save = this.storage!.save;
      }
      handle.init();
      return SKDBSyncImpl.create(handle, this.environment, save);
    };
    this.environment.shared.set("SKDB", new SKDBShared(createSync));
  };
}

class Manager implements ToWasmManager {
  private environment: Environment;

  constructor(environment: Environment) {
    this.environment = environment;
  }

  prepare = (wasm: object) => {
    let toWasm = wasm as ToWasm;
    let links = new LinksImpl(this.environment);
    toWasm.SKIP_clear_field_names = () => links.SKIP_clear_field_names();
    toWasm.SKIP_push_field_name = (skName: ptr) =>
      links.SKIP_push_field_name(skName);
    toWasm.SKIP_clear_object = () => links.SKIP_clear_object();
    toWasm.SKIP_last_tick = (queryID: int) => links.SKIP_last_tick(queryID);
    toWasm.SKIP_switch_to = (stream: int) => links.SKIP_switch_to(stream);
    toWasm.SKIP_push_object_field_null = () =>
      links.SKIP_push_object_field_null();
    toWasm.SKIP_push_object_field_int32 = (field: int) =>
      links.SKIP_push_object_field_int32(field);
    toWasm.SKIP_push_object_field_int64 = (field: ptr) =>
      links.SKIP_push_object_field_int64(field);
    toWasm.SKIP_push_object_field_float = (field: ptr) =>
      links.SKIP_push_object_field_float(field);
    toWasm.SKIP_push_object_field_string = (field: ptr) =>
      links.SKIP_push_object_field_string(field);
    toWasm.SKIP_push_object = () => links.SKIP_push_object();
    toWasm.SKIP_js_mark_query = (id: int) => links.SKIP_js_mark_query(id);
    toWasm.SKIP_js_delete_fun = (id: int) => links.SKIP_js_delete_fun(id);
    return links;
  };
}

/** @sk init */
export function init(env?: Environment) {
  return Promise.resolve(new Manager(env!));
}
