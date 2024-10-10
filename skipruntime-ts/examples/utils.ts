import type { TJSON, Entrypoint, Entry, JSONObject } from "@skipruntime/core";
import { SkipRESTRuntime } from "@skipruntime/core";
import { createInterface } from "readline";
import { connect, Protocol, Client } from "@skipruntime/client";

export interface ClientDefinition {
  port: number;
  scenarios: () => Step[][];
}

interface Write {
  collection: string;
  entries: Entry<TJSON, TJSON>[];
}

interface Delete {
  collection: string;
  keys: string[];
}

function toWs(entrypoint: Entrypoint) {
  if (entrypoint.secured)
    return `wss://${entrypoint.host}:${entrypoint.port.toString()}`;
  return `ws://${entrypoint.host}:${entrypoint.port.toString()}`;
}

class SkipHttpAccessV1 {
  private runtimes: Record<number, SkipRESTRuntime>;
  private client?: Client;
  private defaultPort: number;

  constructor(
    ports: number[] = [3587],
    private creds: Protocol.Creds,
  ) {
    let defaultPort = ports[0];
    if (defaultPort == undefined) {
      throw new Error("At least one port is required.");
    }
    this.defaultPort = defaultPort;
    this.runtimes = {};
    for (const port of ports) {
      this.runtimes[port] = new SkipRESTRuntime({ host: "localhost", port });
    }
  }

  close() {
    if (this.client) this.client.close();
  }

  async writeMany(data: Write[], port?: number) {
    const runtime = this.runtimes[port ?? this.defaultPort];
    if (runtime == undefined) {
      throw new Error("Invalid port " + port);
    }
    const promises = data.map((w) => {
      runtime.patch(w.collection, w.entries);
    });
    if (promises.length == 1) {
      return promises[0];
    }
    return Promise.allSettled(promises);
  }

  async deteleMany(data: Delete[], port?: number) {
    const runtime = this.runtimes[port ?? this.defaultPort];
    if (runtime == undefined) {
      throw new Error("Invalid port " + port);
    }
    const promises: Promise<void>[] = [];
    for (const x of data) {
      for (const key of x.keys) {
        promises.push(runtime.deleteKey(x.collection, key));
      }
    }
    if (promises.length == 1) {
      return promises[0];
    }
    return Promise.allSettled(promises);
  }

  async request(
    resource: string,
    params: Record<string, string>,
    port?: number,
  ) {
    const publicKey = new Uint8Array(
      await Protocol.exportKey(this.creds.publicKey),
    );
    const runtime = this.runtimes[port ?? this.defaultPort];
    if (runtime == undefined) {
      throw new Error("Invalid port " + port);
    }
    const reactive = await runtime.head(resource, params, publicKey);
    if (!this.client) {
      this.client = await connect(
        toWs({ host: "localhost", port: port ?? this.defaultPort }),
        this.creds,
      );
    }
    this.client.subscribe(
      reactive.collection,
      reactive.watermark,
      (updates: [string, TJSON[]][], isInit: boolean) => {
        console.log("Update", Object.fromEntries(updates), isInit);
      },
    );
  }
}

interface RequestQuery {
  type: "request";
  payload: JSONObject;
}
interface WriteQuery {
  type: "write";
  payload: Write[];
}
interface DeleteQuery {
  type: "delete";
  payload: Delete[];
}

export type Step = RequestQuery | WriteQuery | DeleteQuery;

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
    const step = this.scenario[this.current++]!; // checked by preceding if
    console.log(">>", step.type, JSON.stringify(step.payload));
    this.perform(step);
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
  running?: Session;

  constructor(
    private scenarios: Step[][],
    private perform: (l: string) => void,
    private send: (l: Step) => void,
    private error: (e: string) => void,
  ) {}

  start(idx: number) {
    const aidx = idx - 1;
    if (aidx < 0 || aidx >= this.scenarios.length) {
      this.error(`The scenario ${idx.toString()} does not exist`);
      return false;
    } else {
      const scenario = this.scenarios[aidx]!; // checked by enclosing if
      this.running = new Session(scenario, this.send, this.error);
      return true;
    }
  }

  play(idx?: number) {
    let run = true;
    if (idx !== undefined) {
      run = this.start(idx);
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
    const patterns: [RegExp, (...args: string[]) => unknown][] = [
      [
        /^start ([a-z_0-9]+)$/g,
        (str: string) => {
          this.start(parseInt(str));
        },
      ],
      [
        /^reset$/g,
        () => {
          this.reset();
        },
      ],
      [
        /^step ([a-z_0-9]+)$/g,
        (str: string) => {
          this.step(parseInt(str));
        },
      ],
      [
        /^step$/g,
        () => {
          this.step();
        },
      ],
      [
        /^play ([a-z_0-9]+)$/g,
        (str: string) => {
          this.play(parseInt(str));
        },
      ],
      [
        /^play$/g,
        () => {
          this.play();
        },
      ],
      [
        /^stop$/g,
        () => {
          this.stop();
        },
      ],
    ];
    let done = false;
    for (const pattern of patterns) {
      const matches = [...line.matchAll(pattern[0])];
      if (matches.length > 0) {
        done = true;
        const args = matches[0]!.map((v) => v.toString()); // each match is nonempty
        args.shift();
        pattern[1].apply(null, args);
      }
    }
    if (!done) this.perform(line);
  }
}
/**
 * Run the client with specified scenarios
 * @param scenarios The scenarios
 * @param ports  The ports
 */
export async function run(scenarios: Step[][], ports: number[] = [3587]) {
  const creds = await Protocol.generateCredentials();
  const access = new SkipHttpAccessV1(ports, creds);
  const online = (line: string) => {
    if (line == "exit") {
      access.close();
      return;
    }
    try {
      const patterns: [RegExp, (...args: string[]) => void][] = [
        [
          /^request (.*)$/g,
          (query: string) => {
            const jsquery = JSON.parse(query) as {
              resource: string;
              params?: Record<string, string>;
              port: number;
            };
            access
              .request(jsquery.resource, jsquery.params ?? {}, jsquery.port)
              .then(console.log)
              .catch((e: unknown) => {
                console.error(e);
              });
          },
        ],
        [
          /^write (.*)$/g,
          (query: string) => {
            const jsquery = JSON.parse(query) as Write[];
            access
              .writeMany(jsquery)
              .then(console.log)
              .catch((e: unknown) => {
                console.error(e);
              });
          },
        ],
        [
          /^delete (.*)$/g,
          (query: string) => {
            const jsquery = JSON.parse(query) as Delete[];
            access
              .deteleMany(jsquery)
              .then(console.log)
              .catch((e: unknown) => {
                console.error(e);
              });
          },
        ],
      ];
      let done = false;
      for (const pattern of patterns) {
        const matches = [...line.matchAll(pattern[0])];
        if (matches.length > 0) {
          done = true;
          const args = matches[0]!.map((v) => v.toString()); // each match is nonempty
          args.shift();
          pattern[1].apply(null, args);
        }
      }
      if (!done) {
        console.error(`Unknow command line '${line}'`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : JSON.stringify(e);
      console.error(message);
    }
  };
  const player = new Player(
    scenarios,
    online,
    (step) => {
      if (step.type == "request") {
        const jsquery = step.payload as {
          resource: string;
          params?: Record<string, string>;
          port?: number;
        };
        access
          .request(jsquery.resource, jsquery.params ?? {}, jsquery.port)
          .then(console.log)
          .catch((e: unknown) => {
            console.error(e);
          });
      } else if (step.type == "write") {
        access
          .writeMany(step.payload)
          .then(console.log)
          .catch((e: unknown) => {
            console.error(e);
          });
      } else {
        access
          .deteleMany(step.payload)
          .then(console.log)
          .catch((e: unknown) => {
            console.error(e);
          });
      }
    },
    console.error,
  );
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });
  rl.prompt();
  rl.on("line", (line: string) => {
    if (line == "exit") {
      player.online(line);
      process.exit(0);
    } else {
      player.online(line);
      rl.prompt();
    }
  });
}
