import type { int, Wrk } from "./sk_types.js";

interface Payload {}

export class Wrappable {
  wrappedId?: int;
}

class UnmanagedMessage extends Error {
  constructor(msg?: string) {
    super(msg);
  }
}

export class Function implements Payload {
  fn: string;
  parameters: Array<any>;
  wrap?: { wrap: boolean; autoremove: boolean };

  constructor(
    fn: string,
    parameters: Array<any>,
    wrap?: { wrap: boolean; autoremove: boolean },
  ) {
    this.fn = fn;
    this.parameters = parameters;
    this.wrap = wrap;
  }

  static as(obj: object) {
    if (!("fn" in obj) || !("parameters" in obj)) return null;
    let wrap =
      "wrap" in obj
        ? (obj.wrap! as { wrap: boolean; autoremove: boolean })
        : undefined;
    let fn = new Function(
      obj.fn! as string,
      obj.parameters! as Array<any>,
      wrap,
    );
    return fn;
  }

  static isValid(obj: object) {
    return "fn" in obj && "parameters" in obj;
  }
}

export class Caller implements Payload {
  wrapped: number;
  fn: string;
  parameters: Array<any>;
  remove: boolean;

  constructor(
    wrapped: number,
    fn: string,
    parameters: Array<any>,
    remove: boolean = false,
  ) {
    this.wrapped = wrapped;
    this.fn = fn;
    this.parameters = parameters;
    this.remove = remove;
  }

  static convert(obj: object) {
    if (
      !("wrapped" in obj) ||
      !("fn" in obj) ||
      !("parameters" in obj) ||
      !("remove" in obj)
    )
      return null;
    let fn = new Caller(
      obj.wrapped! as number,
      obj.fn! as string,
      obj.parameters! as Array<any>,
      obj.remove! as boolean,
    );
    return fn;
  }

  static isValid(obj: object) {
    return "fn" in obj && "parameters" in obj;
  }
}

export class Return implements Payload {
  success: boolean;
  value: any;

  constructor(success: boolean, value: any) {
    this.success = success;
    this.value = value;
  }

  static as(obj: object) {
    if (!("success" in obj) || !("value" in obj)) return null;
    return new Return(obj.success! as boolean, obj.value!);
  }
}

export class MessageId {
  source: number;
  id: number;

  constructor(source: number, id: number) {
    this.source = source;
    this.id = id;
  }

  static as(obj: object) {
    if (!("source" in obj) || !("id" in obj)) return null;
    return new MessageId(obj.source! as number, obj.id! as number);
  }
}

export class Wrapped {
  wrapped: number;

  constructor(wrapped: number) {
    this.wrapped = wrapped;
  }

  static as(obj: object) {
    if (!("wrapped" in obj)) return null;
    return new Wrapped(obj.wrapped! as number);
  }
}

function asKey(messageId: MessageId) {
  return "" + messageId.source + ":" + messageId.id;
}

export class Sender {
  close: () => void;
  send: <T>() => Promise<T>;

  constructor(close: () => void, send: <T>() => Promise<T>) {
    this.close = close;
    this.send = send;
  }
}

export class Message {
  id: MessageId;
  payload: Payload;

  constructor(id: MessageId, payload: Payload) {
    this.id = id;
    this.payload = payload;
  }

  static asFunction(obj: object) {
    if (!("id" in obj) || !("payload" in obj)) return null;
    let messageId = MessageId.as(obj.id!);
    let payload = Function.as(obj.payload!);
    if (messageId && payload) {
      return new Message(messageId, payload);
    }
    return null;
  }

  static asCaller(obj: object) {
    if (!("id" in obj) || !("payload" in obj)) return null;
    let messageId = MessageId.as(obj.id!);
    let payload = Caller.convert(obj.payload!);
    if (messageId && payload) {
      return new Message(messageId, payload);
    }
    return null;
  }

  static asReturn(obj: object) {
    if (!("id" in obj) || !("payload" in obj)) return null;
    let messageId = MessageId.as(obj.id!);
    let payload = Return.as(obj.payload!);
    if (messageId && payload) {
      return new Message(messageId, payload);
    }
    return null;
  }
}

var sourcesLastId = 0;

export class PromiseWorker {
  private lastId: number;
  private source: number;
  private worker: Wrk;
  private callbacks: Map<string, (...args: any[]) => any>;
  private subscriptions: Map<string, (...args: any[]) => void>;

  post: (fn: Function) => Sender;
  onMessage: (message: MessageEvent) => void;

  constructor(worker: Wrk) {
    this.lastId = 0;
    this.worker = worker;
    this.source = ++sourcesLastId;
    this.callbacks = new Map();
    this.subscriptions = new Map();
    let self = this;
    this.post = (fn: Function | Caller) => {
      let messageId = new MessageId(this.source, ++this.lastId);
      let subscribed = new Set<string>();
      const parameters = fn.parameters.map((p) => {
        if (typeof p == "function") {
          let subscriptionId = new MessageId(this.source, ++this.lastId);
          let wfn = (result: Return) => void p.apply(null, result.value);
          let key = asKey(subscriptionId);
          this.subscriptions.set(key, wfn);
          subscribed.add(key);
          return subscriptionId;
        } else {
          return p;
        }
      });
      fn.parameters = parameters;
      return new Sender(
        () => {
          subscribed.forEach((key) => this.subscriptions.delete(key));
        },
        () =>
          new Promise(function (resolve, reject) {
            self.callbacks.set(asKey(messageId), (result: Return) => {
              if (result.success) {
                resolve(result.value);
              } else if (result.value instanceof Error) {
                reject(result.value);
              } else {
                reject(new Error(JSON.stringify(result.value)));
              }
            });
            let message = new Message(messageId, fn);
            self.worker.postMessage(message);
          }),
      );
    };
    this.onMessage = (message: MessageEvent) => {
      let data = Message.asReturn(message.data ?? message);
      if (!data) {
        throw new UnmanagedMessage(JSON.stringify(message));
      } else {
        let result = data.payload as Return;
        let callback = this.callbacks.get(asKey(data.id));
        if (callback) {
          this.callbacks.delete(asKey(data.id));
          callback(data.payload);
          return;
        }
        let subscription = this.subscriptions.get(asKey(data.id));
        if (subscription) {
          subscription(data.payload);
          return;
        }
        if (result.value instanceof Error) {
          throw result.value;
        } else
          throw new Error("Return with no callback" + JSON.stringify(data));
      }
    };
    this.worker.onMessage(this.onMessage);
  }
}

function apply<R>(
  post: (message: any) => void,
  id: MessageId,
  caller: any,
  fn: (...args: any) => Promise<R>,
  parameters: any[],
  conv: (res: any) => any = (v) => v,
): void {
  try {
    const promise = fn.apply(caller, parameters);
    promise
      .then((result: any) => {
        post(new Message(id, new Return(true, conv(result))));
      })
      .catch((e: any) => {
        // Firefox don't transmit Worker message if an object of type Error is in the message.
        post(
          new Message(
            id,
            new Return(false, e instanceof Error ? e.message : e),
          ),
        );
      });
  } catch (e: unknown) {
    post(
      new Message(id, new Return(false, e instanceof Error ? e.message : e)),
    );
  }
}

var runner: object;
var wrappedId = 0;
var wrapped = new Map<number, { value: any; autoremove: boolean }>();

export interface Creator<T> {
  getName: () => string;
  getType: () => string;
  create: (...args: any[]) => Promise<T>;
}

export const onWorkerMessage = <T>(
  message: MessageEvent,
  post: (message: any) => void,
  creator: Creator<T>,
) => {
  let data = Message.asCaller(message);
  if (!data) {
    data = Message.asFunction(message);
    if (!data) {
      post("Invalid worker message");
    } else {
      let fun = data.payload as Function;
      let parameters = fun.parameters.map((p) => {
        const subscription = typeof p == "object" ? MessageId.as(p) : null;
        if (subscription) {
          return (...args: any[]) => {
            post(new Message(subscription, new Return(true, args)));
          };
        } else {
          return p;
        }
      });
      if (fun.fn == creator.getName()) {
        if (runner) {
          post(
            new Message(
              data.id,
              new Return(false, creator.getType() + " already created"),
            ),
          );
        } else {
          apply(
            post,
            data!.id,
            creator,
            creator.create,
            parameters,
            (created) => {
              runner = created as object;
              return null;
            },
          );
        }
      } else if (!runner) {
        post(
          new Message(data.id, new Return(false, "Database must be created")),
        );
      } else {
        //@ts-ignore
        let fn = runner[fun.fn];
        if (typeof fn !== "function") {
          post(
            new Message(
              data.id,
              new Return(false, "Invalid database function " + fun.fn),
            ),
          );
        } else {
          apply(post, data!.id, runner, fn, parameters, (result: any) => {
            if (fun.wrap && fun.wrap.wrap) {
              let wId = wrappedId++;
              wrapped.set(wId, {
                value: result,
                autoremove: fun.wrap.autoremove,
              });
              if (result instanceof Wrappable) {
                result.wrappedId = wId;
              }
              result = new Wrapped(wId);
            }
            return result;
          });
        }
      }
    }
  } else {
    let caller = data.payload as Caller;
    let parameters = caller.parameters.map((p) => {
      const subscription = typeof p == "object" ? MessageId.as(p) : null;
      if (subscription) {
        return (...args: any[]) => {
          post(new Message(subscription, new Return(true, args)));
        };
      } else {
        return p;
      }
    });
    let obj = wrapped.get(caller.wrapped);
    let fni =
      caller.fn == ""
        ? { fn: obj?.value, obj: null }
        : { fn: obj?.value[caller.fn], obj: obj?.value };
    if (typeof fni.fn !== "function") {
      post(
        new Message(
          data.id,
          new Return(false, "Invalid function " + caller.fn),
        ),
      );
    } else {
      apply(post, data!.id, fni.obj, fni.fn, parameters);
    }
    if (obj?.autoremove || caller.remove) {
      wrapped.delete(caller.wrapped);
    }
  }
};
