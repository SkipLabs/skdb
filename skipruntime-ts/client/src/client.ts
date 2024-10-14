import type {
  JSONObject,
  TJSON,
  Entry,
  ProtoPing,
  ProtoPong,
  ProtoAuth,
  ProtoGoAway,
  ProtoRequestTail,
  ProtoRequestTailBatch,
  ProtoAbortTail,
  ProtoData,
  Creds,
} from "./protocol.js";

export type {
  JSONObject,
  TJSON,
  Entry,
  ProtoPing,
  ProtoPong,
  ProtoAuth,
  ProtoGoAway,
  ProtoRequestTail,
  ProtoRequestTailBatch,
  ProtoAbortTail,
  ProtoData,
  Creds,
};

import WebSocket from "ws";

import * as Protocol from "./protocol.js";

export { Protocol };

const protoVersion = 1;
// FIXME
const npmVersion = "";

async function createWs(uri: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(uri);
    socket.binaryType = "arraybuffer";
    socket.onclose = (_event: any) => {
      reject(new Error("Socket closed before open"));
    };
    socket.onerror = (_event: any) => {
      reject(new Error("Socket error"));
    };
    socket.onmessage = (_event: any) => {
      reject(new Error("Socket messaged before open"));
    };
    socket.onopen = (_event: any) => {
      resolve(socket);
    };
  });
}

class ResilientWebSocket {
  private uri: string;
  private socket?: WebSocket;

  onmessage?: (data: ArrayBuffer) => void;
  shouldReconnect?: () => boolean;
  onreconnect?: () => void;

  constructor(uri: string) {
    this.uri = uri;
  }

  async connect(): Promise<void> {
    await this.replaceWs();
  }

  send(msg: ArrayBuffer) {
    if (this.socket) {
      this.socket.send(msg);
    }
  }

  close() {
    // FIXME: Race condition if already reconnecting.
    this.socket?.close();
  }

  private async replaceWs(): Promise<void> {
    this.socket = undefined;
    const maybeReplaceWs = () => {
      if (this.shouldReconnect?.()) {
        void this.replaceWs().then(this.onreconnect);
      }
    };
    for (;;) {
      try {
        const socket = await createWs(this.uri);
        socket.onclose = (_event) => {
          maybeReplaceWs();
        };
        socket.onmessage = (event) => {
          if (this.onmessage) {
            if (!(event.data instanceof ArrayBuffer)) {
              throw new Error("Received unexpected text data");
            }
            this.onmessage(event.data);
          }
        };

        this.socket = socket;
        return;
      } catch (error) {
        console.error(error);
        const backoffMs = 500 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
}

async function authMsg(creds: Creds): Promise<ProtoAuth> {
  const nonce = new Uint8Array(8);
  crypto.getRandomValues(nonce);
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const signature = await Protocol.sign(creds.privateKey, nonce, timestamp);
  const clientVersion = "js-" + npmVersion;

  return {
    type: "auth",
    protoVersion,
    pubkey: await Protocol.exportKey(creds.publicKey),
    nonce,
    timestamp,
    signature,
    clientVersion,
  };
}

class Subscription {
  constructor(
    public callback: (updates: Entry<string, TJSON>[], isInit: boolean) => void,
    public watermark: bigint,
  ) {}
}

export class Client {
  private creds: Creds;
  private socket: ResilientWebSocket;
  private subscriptions = new Map<string, Subscription>();
  private closed: boolean = false;
  private permanentFailureReason?: string;
  private healthChecks: ((isOk: boolean) => void)[] = [];

  private constructor(creds: Creds, socket: ResilientWebSocket) {
    this.creds = creds;
    this.socket = socket;
  }

  static async connect(uri: string, creds: Creds): Promise<Client> {
    // FIXME: Periodic ping.
    const socket = new ResilientWebSocket(uri);
    const client = new Client(creds, socket);
    socket.onmessage = (data) => {
      client.onmessage(data);
    };
    socket.shouldReconnect = () => client.shouldReconnect();
    socket.onreconnect = () => {
      client.onreconnect();
    };
    await socket.connect();
    // Initial auth.
    const protoAuth = await authMsg(creds);
    const message = Protocol.encodeMsg(protoAuth);
    socket.send(message);

    return client;
  }

  subscribe(
    collection: string,
    watermark: bigint,
    cb: (updates: Entry<string, TJSON>[], isInit: boolean) => void,
  ): {
    close: () => void;
  } {
    const sub = new Subscription(cb, watermark);
    this.subscriptions.set(collection, sub);
    this.socket.send(
      Protocol.encodeMsg({
        type: "tail",
        since: sub.watermark,
        collection,
      }),
    );

    return {
      close: () => {
        this.unsubscribe(collection);
      },
    };
  }

  unsubscribe(collection: string) {
    this.subscriptions.delete(collection);
    this.socket.send(
      Protocol.encodeMsg({
        type: "aborttail",
        collection,
      }),
    );
  }

  close() {
    this.closed = true;
    this.socket.close();
  }

  private onmessage(bytes: ArrayBuffer) {
    const msg = Protocol.decodeMsg(bytes);
    switch (msg.type) {
      case "goaway": {
        // FIXME: Do not set for non-permanent failure reasons.
        this.permanentFailureReason = msg.msg;
        return;
      }
      case "ping": {
        this.socket.send(
          Protocol.encodeMsg({
            type: "pong",
          }),
        );
        return;
      }
      case "pong": {
        for (const resolve of this.healthChecks) {
          resolve(true);
        }
        this.healthChecks = [];
        return;
      }
      case "data": {
        const payload = JSON.parse(msg.payload) as Entry<string, TJSON>[];
        const sub = this.subscriptions.get(msg.collection);
        // NOTE: Black holing data for unsubscribed collections.
        if (sub) {
          sub.callback(payload, msg.isInit);
          sub.watermark = msg.tick;
        }
        return;
      }
      default:
        console.log(
          `Dropping unexpected message from server (type = ${msg.type})`,
        );
    }
  }

  private shouldReconnect(): boolean {
    if (this.permanentFailureReason) {
      throw new Error(this.permanentFailureReason);
    }

    return !this.closed;
  }

  private onreconnect() {
    void authMsg(this.creds)
      .then(Protocol.encodeMsg)
      .then((msg) => {
        this.socket.send(msg);
        this.resumeTailSessions();
      });
  }

  private resumeTailSessions() {
    // TODO: Send a single tailBatch message instead.
    for (const [collection, sub] of this.subscriptions) {
      this.socket.send(
        Protocol.encodeMsg({
          type: "tail",
          since: sub.watermark,
          collection,
        }),
      );
    }
  }

  // FIXME: Make private and use for keeping connection alive.
  public async pingSocket(): Promise<boolean> {
    const pingTimeoutMs = 10000;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, pingTimeoutMs);
      this.healthChecks.push((isOk) => {
        clearTimeout(timeout);
        resolve(isOk);
      });
    });
  }
}

/**
 * Connects to a remote Skip reactive service.
 * @param uri Remote reactive service url.
 * @param creds Credentials, generated with `generateCredentials()`.
 * @returns Client
 */
export async function connect(uri: string, creds: Creds): Promise<Client> {
  return Client.connect(uri, creds);
}
