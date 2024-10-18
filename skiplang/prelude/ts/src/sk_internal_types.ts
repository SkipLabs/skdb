declare const opaque: unique symbol;
export type Opaque<Value, Tag> = Value & { [opaque]: Tag };

declare const t: unique symbol;
export type T<V> = { [t]: V };

declare const _Raw: unique symbol;
export type Raw = T<typeof _Raw>;

declare const _Void: unique symbol;
export type Void = T<typeof _Void>;

declare const _Byte: unique symbol;
export type Byte = T<typeof _Byte>;

declare const _Uint32: unique symbol;
export type UInt32 = T<typeof _Uint32>;

declare const _Float: unique symbol;
export type Float = T<typeof _Float>;

declare const _String: unique symbol;
export type String = T<typeof _String>;

declare const _Exception: unique symbol;
export type Exception = T<typeof _Exception>;

declare const _Obstack: unique symbol;
export type Obstack = T<typeof _Obstack>;

declare const p: unique symbol;

declare const _Array: unique symbol;
export type Array<Ty extends T<any>> = T<typeof _Array> & {
  [p]: (_: Ty) => Ty;
};

declare const _Vector: unique symbol;
export type Vector<Ty extends T<any>> = T<typeof _Vector> & {
  [p]: (_: Ty) => Ty;
};

declare const _Pair: unique symbol;
export type Pair<Ty1 extends T<any>, Ty2 extends T<any>> = T<typeof _Pair> & {
  [p]: [Ty1, Ty2];
};

declare const _Function: unique symbol;
export type Function<Ty1 extends T<any>, Ty2 extends T<any>> = T<
  typeof _Function
> & {
  [p]: (_: Ty1) => Ty2;
};
