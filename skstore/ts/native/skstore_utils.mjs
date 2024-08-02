export class Sum {
  constructor() {
    this.default = 0;
  }
  accumulate(acc, value) {
    return acc + value;
  }
  dismiss(acc, value) {
    return acc - value;
  }
}
export class Min {
  constructor() {
    this.default = null;
  }
  accumulate(acc, value) {
    return acc === null ? value : Math.min(acc, value);
  }
  dismiss(acc, value) {
    return value > acc ? acc : null;
  }
}
export class Max {
  constructor() {
    this.default = null;
  }
  accumulate(acc, value) {
    return acc === null ? value : Math.max(acc, value);
  }
  dismiss(acc, value) {
    return value < acc ? acc : null;
  }
}
export function equals(x, y) {
  // if they have the same strict value or identity then they are equal
  if (x === y) return true;
  // if they are not strictly equal, they both need to be Objects
  if (!(x instanceof Object) || !(y instanceof Object)) return false;
  // they must have the exact same prototype chain, the closest we can do is
  // test there constructor.
  if (x.constructor !== y.constructor) return false;
  for (var p in x) {
    if (!x.hasOwnProperty(p)) continue;
    if (!y.hasOwnProperty(p)) return false;
    if (!equals(x[p], y[p])) return false;
  }
  for (p in y) if (y.hasOwnProperty(p) && !x.hasOwnProperty(p)) return false;
  return true;
}
