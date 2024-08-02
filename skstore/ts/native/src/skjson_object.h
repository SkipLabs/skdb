// skcjobject.h
#ifndef SK_CJOBJECT_H
#define SK_CJOBJECT_H

#include <node.h>

namespace skjson {
v8::Local<v8::Proxy> CJObject(v8::Isolate*, void*);
}  // namespace skjson

#endif  // SK_CJOBJECT_H