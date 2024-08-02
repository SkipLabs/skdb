

#include "skjson_array.h"

#include <sstream>
#include <string>

#include "skcommon.h"
#include "skjson_utils.h"

namespace skjson {

using skbinding::AddFunction;
using skbinding::FromUtf8;
using v8::Array;
using v8::Boolean;
using v8::Context;
using v8::External;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Number;
using v8::Object;
using v8::Proxy;
using v8::String;
using v8::Uint32;
using v8::Value;

extern "C" {
double SKIP_SKJSON_arraySize(void* json);
void* SKIP_SKJSON_at(void* json, double idx);
}

Local<Value> ArrayGet(Isolate* isolate, Local<Object> target, Local<Value> prop,
                      Local<Object> handler) {
  v8::String::Utf8Value utf8Prop(isolate, prop);
  std::string strProp(*utf8Prop);
  Local<Context> context = isolate->GetCurrentContext();
  Local<External> external = target->Get(context, FromUtf8(isolate, "hdl"))
                                 .ToLocalChecked()
                                 .As<External>();
  if (strProp == "length") {
    double size = SKIP_SKJSON_arraySize(external->Value());
    return Number::New(isolate, size);
  }
  if (strProp == "clone" || strProp == "toJSON") {
    Local<FunctionTemplate> tpl =
        FunctionTemplate::New(isolate, Clone, external);
    return tpl->GetFunction(context).ToLocalChecked();
  }
  try {
    int index = std::stoi(strProp);
    void* json = external->Value();
    void* fvalue = SKIP_SKJSON_at(json, (double)index);
    return SKStoreToNode(isolate, fvalue, false);
  } catch (...) {
    return Undefined(isolate);
  }
}

Local<Value> ArrayHas(Isolate* isolate, Local<Object> target,
                      Local<Value> prop) {
  v8::String::Utf8Value utf8Prop(isolate, prop);
  std::string strProp(*utf8Prop);
  if (strProp == "clone") return Boolean::New(isolate, true);
  if (strProp == "toJSON") return Boolean::New(isolate, true);
  if (strProp == "length") return Boolean::New(isolate, true);
  return Boolean::New(isolate, false);
}

Local<Value> ArrayOwnKeys(Isolate* isolate, Local<Object> target) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<External> external = target->Get(context, FromUtf8(isolate, "hdl"))
                                 .ToLocalChecked()
                                 .As<External>();
  int size = (int)SKIP_SKJSON_arraySize(external->Value());
  Local<Array> jsArr = Array::New(isolate, (int)size);
  for (int i = 0; i < size; i++) {
    std::stringstream ss;
    ss << i;
    jsArr->Set(context, i, FromUtf8(isolate, ss.str().c_str())).FromJust();
  }
  return jsArr;
}

Local<Value> ArrayOwnPropertyDescriptor(Isolate* isolate, Local<Object> target,
                                        Local<Value> prop) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<External> external = target->Get(context, FromUtf8(isolate, "hdl"))
                                 .ToLocalChecked()
                                 .As<External>();
  v8::String::Utf8Value utf8Prop(isolate, prop);
  std::string strProp(*utf8Prop);
  try {
    int index = std::stoi(strProp);
    void* json = external->Value();
    void* fvalue = SKIP_SKJSON_at(json, (double)index);
    Local<Value> value = SKStoreToNode(isolate, fvalue, false);
    Local<Object> properties = Object::New(isolate);
    properties
        ->Set(context, FromUtf8(isolate, "configurable"),
              Boolean::New(isolate, true))
        .FromJust();
    properties
        ->Set(context, FromUtf8(isolate, "enumerable"),
              Boolean::New(isolate, true))
        .FromJust();
    properties
        ->Set(context, FromUtf8(isolate, "writable"),
              Boolean::New(isolate, false))
        .FromJust();
    properties->Set(context, FromUtf8(isolate, "value"), value).FromJust();
    return properties;
  } catch (...) {
    return Undefined(isolate);
  }
}

void CJArrayGet(const FunctionCallbackInfo<Value>& args) {
  Get(args, ArrayGet);
}

void CJArrayHas(const FunctionCallbackInfo<Value>& args) {
  Has(args, ArrayHas);
}

void CJArrayOwnKeys(const FunctionCallbackInfo<Value>& args) {
  OwnKeys(args, ArrayOwnKeys);
}

void CJArrayOwnPropertyDescriptor(const FunctionCallbackInfo<Value>& args) {
  Has(args, ArrayOwnPropertyDescriptor);
}

Local<Proxy> CJArray(Isolate* isolate, void* json) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> local_target = Object::New(isolate);
  local_target
      ->Set(context, FromUtf8(isolate, "hdl"), External::New(isolate, json))
      .FromJust();
  Local<Object> local_handler = Object::New(isolate);
  AddFunction(isolate, local_handler, "get", CJArrayGet);
  AddFunction(isolate, local_handler, "has", CJArrayHas);
  AddFunction(isolate, local_handler, "ownKeys", CJArrayOwnKeys);
  AddFunction(isolate, local_handler, "getOwnPropertyDescriptor",
              CJArrayOwnPropertyDescriptor);
  return Proxy::New(context, local_target, local_handler).ToLocalChecked();
}

}  // namespace skjson