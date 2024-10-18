import type { T } from "std/internal.js";
export type * from "std/internal.js";

declare const _CJNull: unique symbol;
export type CJNull = CJSON<typeof _CJNull>;

declare const _CJBool: unique symbol;
export type CJBool = CJSON<typeof _CJBool>;

declare const _CJInt: unique symbol;
export type CJInt = CJSON<typeof _CJInt>;

declare const _CJFloat: unique symbol;
export type CJFloat = CJSON<typeof _CJFloat>;

declare const _CJString: unique symbol;
export type CJString = CJSON<typeof _CJString>;

declare const _CJArray: unique symbol;
export type CJArray<Sub extends CJSON = CJSON> = CJSON<typeof _CJArray, Sub>;

declare const _CJObject: unique symbol;
export type CJObject = CJSON<typeof _CJObject>;

declare const _CJSON: unique symbol;
export type CJSON<Sub = any, Sub2 = any> = T<typeof _CJSON> & {
  sub: Sub;
  sub2: Sub2;
};
