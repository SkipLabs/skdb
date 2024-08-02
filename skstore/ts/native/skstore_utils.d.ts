import type { Accumulator, Opt } from "./skstore_api.js";
export declare class Sum implements Accumulator<number, number> {
  default: number;
  accumulate(acc: number, value: number): number;
  dismiss(acc: number, value: number): Opt<number>;
}
export declare class Min implements Accumulator<number, number> {
  default: null;
  accumulate(acc: Opt<number>, value: number): number;
  dismiss(acc: number, value: number): Opt<number>;
}
export declare class Max implements Accumulator<number, number> {
  default: null;
  accumulate(acc: Opt<number>, value: number): number;
  dismiss(acc: number, value: number): Opt<number>;
}
export declare function equals(x: any, y: any): boolean;
