import type { Entry, ExternalSupplier, TJSON } from "./skipruntime_api.js";
import { fetchJSON } from "./skipruntime_rest.js";

export interface ExternalResource {
  open(
    params: Record<string, string | number>,
    cb: (updates: Entry<TJSON, TJSON>[], isInit: boolean) => void,
    reactiveAuth?: Uint8Array,
  ): void;

  close(
    params: Record<string, string | number>,
    reactiveAuth?: Uint8Array,
  ): void;
}

export class ExternalService implements ExternalSupplier {
  constructor(private resources: Record<string, ExternalResource>) {}

  link(
    resourceName: string,
    params: Record<string, string | number>,
    cb: (updates: Entry<TJSON, TJSON>[], isInit: boolean) => void,
    reactiveAuth?: Uint8Array,
  ): void {
    const resource = this.resources[resourceName] as
      | ExternalResource
      | undefined;
    if (!resource) {
      throw new Error(`Unkonwn resource named '${resourceName}'`);
    }
    resource.open(params, cb, reactiveAuth);
  }

  close(
    resourceName: string,
    params: Record<string, string>,
    reactiveAuth?: Uint8Array,
  ) {
    const resource = this.resources[resourceName] as
      | ExternalResource
      | undefined;
    if (!resource) {
      throw new Error(`Unkonwn resource named '${resourceName}'`);
    }
    resource.close(params, reactiveAuth);
  }

  shutdown(): void {
    return;
  }
}

type Timemout = number | object;

export class TimeCollection implements ExternalResource {
  private intervals = new Map<string, Record<string, Timemout>>();

  open(
    params: Record<string, string | number>,
    cb: (updates: Entry<TJSON, TJSON>[], isInit: boolean) => void,
    reactiveAuth?: Uint8Array,
  ) {
    const time = new Date().getTime();
    const values: Entry<string, number>[] = [];
    for (const name of Object.keys(params)) {
      values.push([name, [time]]);
    }
    cb(values, true);
    const id = toId(params, reactiveAuth);
    const intervals: Record<string, Timemout> = {};
    for (const [name, duration] of Object.entries(params)) {
      const ms = Number(duration);
      if (ms > 0) {
        intervals[name] = setInterval(() => {
          const newvalue: Entry<TJSON, TJSON> = [name, [new Date().getTime()]];
          cb([newvalue], false);
        }, ms);
      }
    }
    this.intervals.set(id, intervals);
  }

  close(
    params: Record<string, string | number>,
    reactiveAuth?: Uint8Array,
  ): void {
    const intervals = this.intervals.get(toId(params, reactiveAuth));
    if (intervals != null) {
      for (const interval of Object.values(intervals)) {
        clearInterval(interval as number);
      }
    }
  }
}

export class Polled<S extends TJSON, K extends TJSON, V extends TJSON>
  implements ExternalResource
{
  private intervals = new Map<string, number | object>();

  constructor(
    private uri: string,
    private duration: number,
    private conv: (data: S) => Entry<K, V>[],
  ) {}

  open(
    params: Record<string, string | number>,
    cb: (updates: Entry<TJSON, TJSON>[], isInit: boolean) => void,
    reactiveAuth?: Uint8Array,
  ): void {
    this.close(params, reactiveAuth);
    const querieParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      querieParams[key] = value.toString();
    }
    const strParams = new URLSearchParams(querieParams).toString();
    const uri = `${this.uri}?${strParams}`;
    const call = () => {
      fetchJSON(uri, "GET", {})
        .then((r) => {
          cb(this.conv(r[0] as S), true);
        })
        .catch((e: unknown) => console.error(e));
    };
    call();
    this.intervals.set(
      toId(params, reactiveAuth),
      setInterval(call, this.duration),
    );
  }

  close(
    params: Record<string, string | number>,
    reactiveAuth?: Uint8Array,
  ): void {
    const interval = this.intervals.get(toId(params, reactiveAuth));
    if (interval) {
      clearInterval(interval as number);
    }
  }
}

function toId(
  params: Record<string, string | number>,
  reactiveAuth?: Uint8Array,
): string {
  const strparams: string[] = [];
  for (const key of Object.keys(params).sort()) {
    strparams.push(`${key}:${params[key]!.toString()}`);
  }
  const hex = reactiveAuth ? Buffer.from(reactiveAuth).toString("hex") : "";
  return `[${strparams.join(",")}]${hex}`;
}
