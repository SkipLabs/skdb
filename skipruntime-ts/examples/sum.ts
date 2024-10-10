import type {
  Context,
  EagerCollection,
  NonEmptyIterator,
  SkipService,
  Resource,
} from "@skipruntime/core";

import { ValuesMapper } from "@skipruntime/core";

import { runService } from "@skipruntime/server";

class Plus extends ValuesMapper<string, number, number> {
  mapValues(values: NonEmptyIterator<number>): Iterable<number> {
    return [values.toArray().reduce((p, c) => p + c, 0)];
  }
}

class Minus extends ValuesMapper<string, number, number> {
  mapValues(values: NonEmptyIterator<number>): Iterable<number> {
    const acc = (p: number | null, c: number) => {
      return p !== null ? p - c : c;
    };
    return [values.toArray().reduce(acc, null) ?? 0];
  }
}

class Add implements Resource {
  reactiveCompute(
    _context: Context,
    cs: {
      input1: EagerCollection<string, number>;
      input2: EagerCollection<string, number>;
    },
  ): EagerCollection<string, number> {
    return cs.input1.merge(cs.input2).map(Plus);
  }
}

class Sub implements Resource {
  reactiveCompute(
    _context: Context,
    cs: {
      input1: EagerCollection<string, number>;
      input2: EagerCollection<string, number>;
    },
  ): EagerCollection<string, number> {
    return cs.input1.merge(cs.input2).map(Minus);
  }
}

class Service implements SkipService {
  inputCollections = { input1: [], input2: [] };
  resources = { add: Add, sub: Sub };

  reactiveCompute(
    _context: Context,
    inputCollections: Record<string, EagerCollection<string, number>>,
  ) {
    return inputCollections;
  }
}

const closable = await runService(new Service(), 3587);

function shutdown() {
  closable.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
