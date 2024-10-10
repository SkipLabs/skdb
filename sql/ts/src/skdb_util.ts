import type { SKDB, Params } from "./skdb_types.js";

/* ***************************************************************************/
/* The type used to represent callable external functions. */
/* ***************************************************************************/
export class SKDBCallable<_T1, _T2> {
  private id: number;

  constructor(id: number) {
    this.id = id;
  }

  getId(): number {
    return this.id;
  }
}

export class ExternalFuns {
  private externalFuns: ((obj: any) => any)[];

  constructor() {
    this.externalFuns = [];
  }

  register<T1, T2>(f: (obj: T1) => T2): SKDBCallable<T1, T2> {
    if (typeof f != "function") {
      throw new Error("Only function can be registered");
    }
    const funId = this.externalFuns.length;
    this.externalFuns.push(f);
    return new SKDBCallable(funId);
  }

  call<V>(funId: number, jso: object) {
    return this.externalFuns[funId]!(jso) as V;
  }
}

/* ***************************************************************************/
/* Class for query results, extending Array<Record<>> with some common
   selectors and utility functions for ease of use. */
/* ***************************************************************************/
export class SKDBTable extends Array<Record<string, unknown>> {
  scalarValue(): unknown {
    const row = this.firstRow();
    if (row === undefined) {
      return undefined;
    }
    const cols = Object.keys(row);
    if (cols.length < 1) {
      return undefined;
    }
    if (cols.length > 1) {
      throw new Error(
        `Can't extract scalar: query yielded ${cols.length} columns`,
      );
    }
    return row[cols[0]!];
  }

  onlyRow(): Record<string, unknown> {
    if (this.length != 1) {
      throw new Error(`Can't extract only row: got ${this.length} rows`);
    }
    return this[0]!;
  }

  firstRow(): Record<string, unknown> | undefined {
    if (this.length < 1) {
      return undefined;
    }
    return this[0];
  }

  lastRow(): Record<string, unknown> | undefined {
    if (this.length < 1) {
      return undefined;
    }
    return this[this.length - 1];
  }

  onlyColumn(): unknown[] {
    const row = this.firstRow();
    if (row === undefined) {
      return [];
    }
    const cols = Object.keys(row);
    if (cols.length < 1) {
      return []; // unlikely to have rows but no cols
    }
    if (cols.length > 1) {
      throw new Error("Too many columns");
    }
    const col = cols[0]!;
    return this.column(col);
  }

  column(col: string): unknown[] {
    return this.map((row) => {
      if (!row[col]) {
        throw new Error("Missing column: " + col);
      }
      return row[col];
    });
  }
}

/* ***************************************************************************/
/* Transaction API for programmatically constructing and executing
   transactions against an SKDB instance */
/* ***************************************************************************/

export class SKDBTransaction {
  private params: Params;
  private stmts: string[];
  private db_handle: SKDB;

  constructor(skdb: SKDB) {
    this.params = {};
    this.stmts = [];
    this.db_handle = skdb;
  }

  add(stmt: string): this {
    this.stmts.push(stmt.trim().replace(/;$/, ""));
    return this;
  }

  addParams(params: Params): this {
    Object.assign(this.params, params);
    return this;
  }

  commit(additionalParams: Params = {}): Promise<SKDBTable> {
    this.addParams(additionalParams);

    let txn = "BEGIN TRANSACTION;";
    for (const stmt of this.stmts) {
      txn = txn + "\n\t" + stmt + ";";
    }
    txn = txn + "\nCOMMIT;";

    return this.db_handle.exec(txn, this.params);
  }
}
