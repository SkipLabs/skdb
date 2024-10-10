import type { int, ptr, Environment, Links, ToWasmManager, Utils } from "std";
import type * as Internal from "std/internal.js";
import type {
  PagedMemory,
  Page,
  Storage,
  SKDBHandle,
  Params,
  SKDBSync,
  SKDBShared,
} from "./skdb_types.js";
import { ExternalFuns, SKDBTable } from "./skdb_util.js";
import { IDBStorage } from "./skdb_storage.js";
import { SKDBImpl, SKDBSyncImpl } from "./skdb_database.js";
import type { SKJSON } from "skjson";
import type * as InternalJ from "skjson/internal.js";

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
  main: (new_args: string[], new_stdin: string) => string;
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
    main: (new_args: string[], new_stdin: string) => string,
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
  SKIP_push_field_name: (skName: ptr<Internal.String>) => void;
  SKIP_clear_object: () => void;
  SKIP_push_object_field_null: () => void;
  SKIP_push_object_field_int32: (field: int) => void;
  SKIP_push_object_field_int64: (field: ptr<Internal.String>) => void;
  SKIP_push_object_field_float: (field: ptr<Internal.String>) => void;
  SKIP_push_object_field_string: (field: ptr<Internal.String>) => void;
  SKIP_push_object_field_json: (field: ptr<InternalJ.CJSON>) => void;
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
  private dirtyPagesMap!: number[];
  private dirtyPages!: number[];

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
      const dirtyPage = this.popDirtyPage();
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

  private copyPage(start: number, end: number): Promise<ArrayBuffer> {
    return Promise.resolve(this.memory.slice(start, end));
  }

  init(fn: (page: Page) => void) {
    // Let's round up the memorySize to be pageSize aligned
    const memorySize =
      (this.persistentSize + (this.pageSize - 1)) & ~(this.pageSize - 1);
    let i: number;
    let cursor = 0;
    for (i = 0; i < memorySize / this.pageSize; i++) {
      const content = this.memory.slice(cursor, cursor + this.pageSize);
      fn({ pageid: i, content: content });
      cursor = cursor + this.pageSize;
    }
  }

  restore(pages: Page[]) {
    const memory32 = new Uint32Array(this.memory);
    for (const page of pages) {
      const pageid = page.pageid;
      if (pageid < 0) continue;
      const pageBuffer = new Uint32Array(page.content as Iterable<number>);
      const start = pageid * (this.pageSize / 4);
      for (let i = 0; i < pageBuffer.length; i++) {
        memory32[start + i] = pageBuffer[i]!;
      }
    }
  }

  async getPages() {
    const pages = this.dirtyPages;
    const copiedPages = [];
    for (const page of pages) {
      const start = page * this.pageSize;
      const end = page * this.pageSize + this.pageSize;
      const content = await this.copyPage(start, end);
      copiedPages.push({ pageid: page, content });
    }
    return copiedPages;
  }
}

class SKDBSharedImpl implements SKDBShared {
  getName = () => "SKDB";
  createSync: (dbName?: string, asWorker?: boolean) => Promise<SKDBSync>;
  notify: () => void;

  constructor(
    createSync: (dbName?: string, asWorker?: boolean) => Promise<SKDBSync>,
    notify: () => void,
  ) {
    this.createSync = createSync;
    this.notify = notify;
  }

  async create(dbName?: string) {
    const skdbSync = await this.createSync(dbName);
    return new SKDBImpl(skdbSync);
  }
}

class LinksImpl implements Links, ToWasm {
  private environment: Environment;
  private state: ExternalFuns;
  private field_names: string[];
  private objectIdx: number;
  private stream: 0 | 1 | 2;
  private object: Record<string, any>;
  private stdout_objects: [
    Record<string, any>[],
    Record<string, any>[],
    Record<string, any>[],
    [] | [{ tick: number }],
  ];
  private storage?: Storage;
  //
  private queryID: number;
  private userFuns: (() => void)[];
  private funLastTick: Map<number, number>;
  private queriesToNotify: Set<number>;
  private notifications: Set<number>[];
  private notifying: boolean;
  private freeQueryIDs: number[];
  private skjson?: SKJSON;

  SKIP_last_tick!: (queryID: int) => int;
  SKIP_switch_to!: (stream: int) => void;
  SKIP_call_external_fun!: (
    funId: int,
    skParam: ptr<Internal.String>,
  ) => ptr<Internal.String>;
  SKIP_clear_field_names!: () => void;
  SKIP_push_field_name!: (skName: ptr<Internal.String>) => void;
  SKIP_clear_object!: () => void;
  SKIP_push_object_field_null!: () => void;
  SKIP_push_object_field_int32!: (field: int) => void;
  SKIP_push_object_field_int64!: (field: ptr<Internal.String>) => void;
  SKIP_push_object_field_float!: (field: ptr<Internal.String>) => void;
  SKIP_push_object_field_string!: (field: ptr<Internal.String>) => void;
  SKIP_push_object_field_json!: (field: ptr<InternalJ.CJSON>) => void;
  SKIP_push_object!: () => void;
  SKIP_js_mark_query!: (queryID: int) => void;
  SKIP_js_delete_fun!: (queryID: int) => void;
  // Utils
  notifyAllJS!: () => void;
  checkNotifications!: () => void;

  constructor(environment: Environment) {
    this.environment = environment;
    this.state = new ExternalFuns();
    this.field_names = [];
    this.queryID = 0;
    this.userFuns = [];
    this.freeQueryIDs = [];
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
    const exported = exports as Exported;
    const skjson = () => {
      if (this.skjson == undefined) {
        this.skjson = this.environment.shared.get("SKJSON")! as SKJSON;
      }
      return this.skjson;
    };
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
                utils.runCheckError(() => {
                  exported.SKIP_reactive_print_result(value);
                });
                this.userFuns[value]!();
              });
            }
          }
        } finally {
          this.notifying = false;
        }
      }
    };
    this.SKIP_call_external_fun = (
      funId: int,
      skParam: ptr<Internal.String>,
    ) => {
      const res = this.state.call(
        funId,
        JSON.parse(utils.importString(skParam)) as object,
      );
      const strRes = JSON.stringify(res === undefined ? null : res);
      return utils.exportString(strRes);
    };
    this.SKIP_last_tick = (queryID: int) => {
      return this.funLastTick.get(queryID) ?? 0;
    };
    this.SKIP_switch_to = (stream: int) => {
      this.stream = stream as 0 | 1 | 2;
    };
    this.SKIP_clear_field_names = () => {
      this.field_names = [];
    };
    this.SKIP_push_field_name = (skName: ptr<Internal.String>) => {
      this.field_names.push(utils.importString(skName));
    };
    this.SKIP_clear_object = () => {
      this.objectIdx = 0;
      this.object = {};
    };
    this.SKIP_push_object_field_null = () => {
      const field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = null;
      this.objectIdx++;
    };
    this.SKIP_push_object_field_int32 = (n: int) => {
      const field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = n;
      this.objectIdx++;
    };
    this.SKIP_push_object_field_int64 = (skV: ptr<Internal.String>) => {
      const field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = parseInt(utils.importString(skV), 10);
      this.objectIdx++;
    };
    this.SKIP_push_object_field_float = (skV: ptr<Internal.String>) => {
      const field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = parseFloat(utils.importString(skV));
      this.objectIdx++;
    };
    this.SKIP_push_object_field_string = (skV: ptr<Internal.String>) => {
      const field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = utils.importString(skV);
      this.objectIdx++;
    };
    this.SKIP_push_object_field_json = (skV: ptr<InternalJ.CJSON>) => {
      const jsu = skjson();
      const field_name: string = this.field_names[this.objectIdx]!;
      this.object[field_name] = jsu.importJSON(skV, true);
      this.objectIdx++;
    };
    this.SKIP_push_object = () => {
      const objects = this.stdout_objects[this.stream];
      if (!objects) {
        this.stdout_objects[this.stream] = [];
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
    const runner = (fn: () => string) => {
      this.stdout_objects = [[], [], [], []];
      this.stream = 0;
      const stdout = fn();
      if (stdout == "") {
        const result = this.stdout_objects[0];
        this.stdout_objects = [[], [], [], []];
        return new SKDBTable(...result);
      }
      throw new Error(stdout);
    };
    const main = (new_args: string[], new_stdin: string) => {
      const res = utils.main(new_args, new_stdin);
      this.notifyAllJS();
      return res;
    };
    const manageWatch = (
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
      const queryID = freeQueryID ?? this.queryID++;
      this.funLastTick.set(queryID, 0);
      const userFun = () => {
        queryFun(queryID, false);
      };
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
          this.userFuns[queryID] = () => {
            return;
          };
          utils.runCheckError(() => {
            exported.SKIP_delete_reactive_query(queryID);
          });
        },
      };
    };

    const watch = (
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
    const watchChanges = (
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
          const tick = this.stdout_objects[3][0]?.tick;
          if (added.length > 0 || removed.length > 0) {
            update(added, removed);
          } else if (rows.length || first) {
            init(rows);
          }
          this.funLastTick.set(queryID, tick ?? 0);
          this.stdout_objects = [[], [], [], []];
        },
      );
    };
    const handle = new SKDBHandleImpl(main, runner, watch, watchChanges);
    const createSync = async (dbName?: string) => {
      let save: () => Promise<boolean> = () => Promise.resolve(true);
      const storeName = dbName ? "SKDBStore" : null;
      if (storeName != null) {
        const memory = new SKDBMemory(
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
        save = () => {
          return this.storage!.save();
        };
      }
      handle.init();
      return SKDBSyncImpl.create(handle, this.environment, save);
    };
    this.environment.shared.set(
      "SKDB",
      new SKDBSharedImpl(createSync, this.notifyAllJS),
    );
  };
}

class Manager implements ToWasmManager {
  private environment: Environment;

  constructor(environment: Environment) {
    this.environment = environment;
  }

  prepare = (wasm: object) => {
    const toWasm = wasm as ToWasm;
    const links = new LinksImpl(this.environment);
    toWasm.SKIP_clear_field_names = () => {
      links.SKIP_clear_field_names();
    };
    toWasm.SKIP_push_field_name = (skName: ptr<Internal.String>) => {
      links.SKIP_push_field_name(skName);
    };
    toWasm.SKIP_clear_object = () => {
      links.SKIP_clear_object();
    };
    toWasm.SKIP_last_tick = (queryID: int) => links.SKIP_last_tick(queryID);
    toWasm.SKIP_switch_to = (stream: int) => {
      links.SKIP_switch_to(stream);
    };
    toWasm.SKIP_push_object_field_null = () => {
      links.SKIP_push_object_field_null();
    };
    toWasm.SKIP_push_object_field_int32 = (field: int) => {
      links.SKIP_push_object_field_int32(field);
    };
    toWasm.SKIP_push_object_field_int64 = (field: ptr<Internal.String>) => {
      links.SKIP_push_object_field_int64(field);
    };
    toWasm.SKIP_push_object_field_float = (field: ptr<Internal.String>) => {
      links.SKIP_push_object_field_float(field);
    };
    toWasm.SKIP_push_object_field_string = (field: ptr<Internal.String>) => {
      links.SKIP_push_object_field_string(field);
    };
    toWasm.SKIP_push_object_field_json = (field: ptr<InternalJ.CJSON>) => {
      links.SKIP_push_object_field_json(field);
    };
    toWasm.SKIP_push_object = () => {
      links.SKIP_push_object();
    };
    toWasm.SKIP_js_mark_query = (id: int) => {
      links.SKIP_js_mark_query(id);
    };
    toWasm.SKIP_js_delete_fun = (id: int) => {
      links.SKIP_js_delete_fun(id);
    };
    return links;
  };
}

/* @sk init */
export function init(env?: Environment) {
  return Promise.resolve(new Manager(env!));
}
