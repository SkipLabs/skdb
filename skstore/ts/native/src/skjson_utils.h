
// skutils.h
#ifndef SK_UTILS_H
#define SK_UTILS_H

#include <node.h>

namespace skjson {

void* NodeToSKStore(v8::Isolate*, v8::Local<v8::Value>);
v8::Local<v8::Value> SKStoreToNode(v8::Isolate*, void*, bool);
void Clone(const v8::FunctionCallbackInfo<v8::Value>&);
void Get(const v8::FunctionCallbackInfo<v8::Value>&,
         std::function<v8::Local<v8::Value>(v8::Isolate*, v8::Local<v8::Object>,
                                            v8::Local<v8::Value>,
                                            v8::Local<v8::Object>)>);
void Has(const v8::FunctionCallbackInfo<v8::Value>&,
         std::function<v8::Local<v8::Value>(v8::Isolate*, v8::Local<v8::Object>,
                                            v8::Local<v8::Value>)>);
void OwnKeys(
    const v8::FunctionCallbackInfo<v8::Value>&,
    std::function<v8::Local<v8::Value>(v8::Isolate*, v8::Local<v8::Object>)>);

v8::Local<v8::Value> GetOwnProperty(v8::Isolate*, v8::Local<v8::Value>);

}  // namespace skjson

#endif  // SK_CJOBJECT_H