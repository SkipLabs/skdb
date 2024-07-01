import type { TJSON, SKStore, MirrorSchema, Table, JSONObject } from "skstore";
import { createSKStore } from "skstore";
import { Server, type ServerOptions } from "socket.io";
import { createInterface } from "readline";
import { Command } from "commander";

export interface ReactiveStorage {
  initReactiveFlow: (store: SKStore, ...tables: any[]) => void;
  schema: () => MirrorSchema[];
}

type Step = string;

class Session {
  scenario: Step[];
  perform: (l: Step) => void;
  error: (e: string) => void;
  current = 0;
  on = false;

  constructor(
    scenario: Step[],
    perform: (l: Step) => void,
    error: (e: string) => void,
  ) {
    this.scenario = scenario;
    this.perform = perform;
    this.error = error;
  }

  next(): boolean {
    if (this.current >= this.scenario.length) {
      this.error("The scenario as no more entries.");
      return false;
    }
    const line = this.scenario[this.current++];
    console.log(line);
    this.perform(line);
    return this.current < this.scenario.length;
  }

  play(): void {
    this.on = this.current < this.scenario.length;
    while (this.on) {
      this.on = this.next();
    }
  }

  pause(): void {
    this.on = false;
  }

  reset(): void {
    this.on = false;
    this.current = 0;
  }
}

class Player {
  scenarios: Step[][];
  running?: Session;
  perform: (l: Step) => void;
  error: (e: string) => void;

  constructor(
    scenarios: Step[][],
    perform: (l: Step) => void,
    error: (e: string) => void,
  ) {
    this.scenarios = scenarios;
    this.perform = perform;
    this.error = error;
  }

  start(idx: number) {
    const scenario = this.scenarios[idx - 1];
    if (!scenario) {
      this.error(`The scenario ${idx} does not exist`);
      return false;
    } else {
      this.running = new Session(scenario, this.perform, this.error);
      return true;
    }
  }

  play(idx?: number) {
    let run = true;
    if (idx ?? 0 > 0) {
      run = this.start(idx!);
    }
    if (run) {
      if (this.running) {
        this.running.play();
      } else {
        this.error(`No current scenario session`);
      }
    }
  }

  step(idx?: number) {
    const running = this.running;
    if (!running) {
      this.error(`No current scenario session`);
      return;
    }
    let steps = Math.min(idx ?? 1, 1);
    while (steps > 0) {
      if (!running.next()) {
        break;
      }
      steps--;
    }
  }

  reset() {
    const running = this.running;
    if (running) running.reset();
  }

  stop() {
    this.running = undefined;
  }

  online(line: string) {
    if (line.trim().length == 0 && this.running) {
      this.step();
      return;
    }
    const patterns: [RegExp, (...args: string[]) => any][] = [
      [/^start ([a-z_0-9]+)$/g, (str: string) => this.start(parseInt(str))],
      [/^reset$/g, () => this.reset()],
      [/^step ([a-z_0-9]+)$/g, (str: string) => this.step(parseInt(str))],
      [/^step$/g, () => this.step()],
      [/^play ([a-z_0-9]+)$/g, (str: string) => this.play(parseInt(str))],
      [/^play$/g, () => this.play()],
      [/^stop$/g, () => this.stop()],
    ];
    let done = false;
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const matches = [...line.matchAll(pattern[0])];
      if (matches.length > 0) {
        done = true;
        const args = matches[0].map((v) => v.toString());
        args.shift();
        pattern[1].apply(null, args);
      }
    }
    if (!done) this.perform(line);
  }

  toCommands() {
    [
      ["start", (id: string) => this.start(parseInt(id))],
      ["reset", () => this.reset()],
      ["step", (str?: string) => this.step(str ? parseInt(str) : undefined)],
      ["play", (str?: string) => this.play(str ? parseInt(str) : undefined)],
      ["stop", () => this.stop()],
    ];
  }
}

interface ReactiveService {
  run: (...tables: any[]) => void;
}

class SKDBWatcher {
  private watches: Map<string, () => void>;
  private tables: Map<string, Table<TJSON[]>>;
  private error: (msg: string) => void;

  constructor(
    error: (msg: string) => void,
    tables: Map<string, Table<TJSON[]>>,
  ) {
    this.error = error;
    this.watches = new Map();
    this.tables = tables;
  }

  watch(name: string, onChange: (rows: JSONObject[]) => void) {
    if (this.watches.has(name)) {
      this.watches.get(name)!();
    }
    if (!this.tables.has(name)) {
      this.error(`Unable to find ${name} table.`);
      return;
    }
    this.watches.set(name, this.tables.get(name)!.watch(onChange).close);
  }

  watchChanges(
    name: string,
    init: (rows: JSONObject[]) => void,
    update: (added: JSONObject[], removed: JSONObject[]) => void,
  ) {
    if (this.watches.has(name)) {
      this.watches.get(name)!();
    }
    if (!this.tables.has(name)) {
      this.error(`Unable to find ${name} table.`);
      return;
    }
    this.watches.set(
      name,
      this.tables.get(name)!.watchChanges(init, update).close,
    );
  }

  close(name: string) {
    if (this.watches.has(name)) {
      this.watches.get(name)!();
      this.watches.delete(name);
    }
  }
}

export class SocketServerService implements ReactiveService {
  options?: Partial<ServerOptions>;
  port: number;

  constructor(port: number = 3000, options?: Partial<ServerOptions>) {
    this.port = port;
    this.options = options;
  }

  run = (...tables: any[]) => {
    const tablesByName: Map<string, Table<TJSON[]>> = new Map();
    tables.forEach((table) => {
      tablesByName.set(table.getName(), table);
    });
    const io = new Server(this.options);
    io.on("connection", (socket) => {
      const watcher = new SKDBWatcher(console.error, tablesByName);
      const error = (msg: string) => socket.emit("error", msg);
      socket.on("insert", (name: string, values: string) => {
        const table = tablesByName.get(name);
        if (!table) {
          error(`Unable to find ${name} table.`);
          return;
        }
        table.insert(JSON.parse(values));
      });
      socket.on("delete", (name: string, where: string) => {
        const table = tablesByName.get(name);
        if (!table) {
          error(`Unable to find ${name} table.`);
          return;
        }
        table.deleteWhere(JSON.parse(where));
      });
      socket.on("update", (name: string, params: string) => {
        const table = tablesByName.get(name);
        if (!table) {
          error(`Unable to find ${name} table.`);
          return;
        }
        const jsParams = JSON.parse(params);
        table.updateWhere(jsParams.where, jsParams.update);
      });
      socket.on("watch", (name: string) => {
        watcher.watch(name, (rows) => {
          socket.emit("watch", name, JSON.stringify(rows));
        });
      });
      socket.on("watch-changes", (name: string) => {
        watcher.watchChanges(
          name,
          (rows) => {
            socket.emit("watch-init", name, JSON.stringify(rows));
          },
          (added, removed) => {
            socket.emit(
              "watch-update",
              name,
              JSON.stringify({ added, removed }),
            );
          },
        );
      });
      socket.on("close", watcher.close);
      socket.on("exit", () => socket.disconnect(true));
    });
    io.listen(this.port);
  };
}

export interface WatchListener {
  error: (message: any) => void;
  table: (table: JSONObject[]) => void;
  update?: (name: string, table: JSONObject[]) => void;
  changeInit?: (name: string, table: JSONObject[]) => void;
  changeUpdate?: (
    name: string,
    added: JSONObject[],
    removed: JSONObject[],
  ) => void;
}

export class IOInputService implements ReactiveService {
  scenarios: Step[][];
  listener: WatchListener;

  constructor(scenarios: Step[][], listener: WatchListener = new JSONLogger()) {
    this.scenarios = scenarios;
    this.listener = listener;
  }

  run = (...tables: any[]) => {
    const tablesByName: Map<string, Table<TJSON[]>> = new Map();
    tables.forEach((table) => {
      tablesByName.set(table.getName(), table);
    });
    const watcher = new SKDBWatcher(this.listener.error, tablesByName);
    const online = (line: string) => {
      const matches = [
        ...line.matchAll(/^(watch|watch-changes) ([a-z_0-9\-]+)$/g),
      ];
      if (matches.length > 0) {
        const match = matches[0];
        const name = match[2];
        if (match[1] == "watch") {
          const update = this.listener.update;
          if (!update) {
            this.listener.error("No update function supplies.");
          } else {
            watcher.watch(name, (rows) => update(name, rows));
          }
        } else {
          const changeInit = this.listener.changeInit;
          const changeUpdate = this.listener.changeUpdate;
          if (!changeInit || !changeUpdate) {
            this.listener.error("No update changes function supplies.");
          } else {
            watcher.watchChanges(
              name,
              (rows) => changeInit(name, rows),
              (added, removed) => changeUpdate(name, added, removed),
            );
          }
        }
      } else if (line.startsWith("close ")) {
        const name = line.substring(6).trim();
        watcher.close(name);
      } else {
        const error = this.listener.error;
        try {
          const patterns: [RegExp, (...args: string[]) => any][] = [
            [
              /^insert ([a-z_0-9]+) (.*)$/g,
              (name: string, values: string) => {
                const table = tablesByName.get(name);
                if (!table) {
                  error(`Unable to find ${name} table.`);
                  return;
                }
                table.insert(JSON.parse(values));
              },
            ],
            [
              /^delete ([a-z_0-9]+) (.*)$/g,
              (name: string, where: string) => {
                const table = tablesByName.get(name);
                if (!table) {
                  error(`Unable to find ${name} table.`);
                  return;
                }
                table.deleteWhere(JSON.parse(where));
              },
            ],
            [
              /^select ([a-z_0-9]+) (.*)$/g,
              (name: string, where: string) => {
                const table = tablesByName.get(name);
                if (!table) {
                  error(`Unable to find ${name} table.`);
                  return;
                }
                const jsdata = JSON.parse(where);
                const result = table.select(jsdata.where, jsdata.colmuns);
                this.listener.table(result);
              },
            ],
            [
              /^update ([a-z_0-9]+) (.*)$/g,
              (name: string, params: string) => {
                const table = tablesByName.get(name);
                if (!table) {
                  error(`Unable to find ${name} table.`);
                  return;
                }
                const jsParams = JSON.parse(params);
                table.updateWhere(jsParams.where, jsParams.update);
              },
            ],
          ];
          let done = false;
          for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const matches = [...line.matchAll(pattern[0])];
            if (matches.length > 0) {
              done = true;
              const args = matches[0].map((v) => v.toString());
              args.shift();
              pattern[1].apply(null, args);
            }
          }
          if (!done) {
            error(`Unknow command line '${line}'`);
          }
        } catch (e: any) {
          const message = e instanceof Error ? e.message : JSON.stringify(e);
          this.listener.error(message);
        }
      }
    };
    const player = new Player(this.scenarios, online, this.listener.error);
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "> ",
    });
    rl.prompt();
    rl.on("line", (line) => {
      if (line == "exit") {
        process.exit(0);
      } else {
        player.online(line);
        rl.prompt();
      }
    });
  };
}

export class NoopService implements ReactiveService {
  run = (...tables: any[]) => {};
}

export class JSONLogger implements WatchListener {
  error = console.error;
  table = console.table;
  update = (name: string, table: JSONObject[]) => {
    console.log(JSON.stringify(["watch", name, table]));
  };
  changeInit = (name: string, table: JSONObject[]) => {
    console.log(JSON.stringify(["watch-init", name, table]));
  };
  changeUpdate = (name: string, added: JSONObject[], removed: JSONObject[]) => {
    console.log(JSON.stringify(["watch-update", name, added, removed]));
  };
}

export async function start(
  service: ReactiveService,
  storage: ReactiveStorage,
  connect: boolean = true,
) {
  try {
    const tables = await createSKStore(
      storage.initReactiveFlow,
      storage.schema(),
      connect,
    );
    service.run(...tables);
  } catch (e) {
    throw e;
  }
}

export async function main(
  storage: ReactiveStorage,
  connect: boolean = true,
  scenarios: Step[][] = [],
) {
  const program = new Command();
  program
    .version("0.0.1")
    .description("Example launcher")
    .option(
      "-m,  --mode <io|socket|noop>",
      "Launch mode (default: noop)",
      "noop",
    )
    .option(
      "-p, --port <port>",
      "Port number in socket server mode (default: 3000)",
      "3000",
    )
    .parse(process.argv);
  const options = program.opts();
  try {
    switch (options.mode) {
      case "io":
        await start(new IOInputService(scenarios), storage, connect);
        break;
      case "socket":
        await start(
          new SocketServerService(parseInt(options.port)),
          storage,
          connect,
        );
        break;
      case "noop":
      default:
        await start(new NoopService(), storage, connect);
        break;
    }
  } catch (e) {
    throw e;
  }
}
