// skcjobject.h
#ifndef SK_CJARRAY_H
#define SK_CJARRAY_H

#include <node.h>

namespace skjson {
v8::Local<v8::Proxy> CJArray(v8::Isolate*, void*);
}  // namespace skjson

#endif  // SK_CJARRAY_H