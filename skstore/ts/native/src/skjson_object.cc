

#include "skjson_object.h"

#include <string>

#include "skcommon.h"
#include "skjson_utils.h"

namespace skjson {

using skbinding::AddFunction;
using skbinding::FromUtf8;
using v8::Boolean;
using v8::Context;
using v8::External;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Object;
using v8::Proxy;
using v8::String;
using v8::Uint32;
using v8::Value;

extern "C" {
double SKIP_SKJSON_objectSize(void* json);
char* SKIP_SKJSON_fieldAt(void* json, double idx);
void* SKIP_SKJSON_get(void* json, double idx);
}

Local<Object> CheckFields(Isolate* isolate, Local<External> external,
                          Local<Object> target) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<String> fieldsName = FromUtf8(isolate, "fields");
  void* json = external->Value();
  Local<Value> fields = target->Get(context, fieldsName).ToLocalChecked();
  if (!fields->IsObject()) {
    // create Fields
    Local<Object> fields = Object::New(isolate);
    int size = (int)SKIP_SKJSON_objectSize(json);
    for (int i = 0; i < size; i++) {
      char* field = SKIP_SKJSON_fieldAt(json, i);
      fields->Set(context, FromUtf8(isolate, field), Uint32::New(isolate, i))
          .FromJust();
    }
    target->Set(context, fieldsName, fields).FromJust();
    return fields;
  }
  return fields.As<Object>();
}

Local<Value> ObjectGet(Isolate* isolate, Local<Object> target,
                       Local<Value> prop, Local<Object> handler) {
  v8::String::Utf8Value utf8Prop(isolate, prop);
  std::string strProp(*utf8Prop);
  Local<Context> context = isolate->GetCurrentContext();
  Local<External> external = target->Get(context, FromUtf8(isolate, "hdl"))
                                 .ToLocalChecked()
                                 .As<External>();
  if (strProp == "clone" || strProp == "toJSON") {
    Local<FunctionTemplate> tpl =
        FunctionTemplate::New(isolate, Clone, external);
    return tpl->GetFunction(context).ToLocalChecked();
  }
  Local<Object> fields = CheckFields(isolate, external, target);
  Local<Value> idx = fields->Get(context, prop).ToLocalChecked();
  if (!idx->IsUint32()) {
    return Undefined(isolate);
  }
  uint32_t index = idx.As<Uint32>()->Value();
  void* json = external->Value();
  void* fvalue = SKIP_SKJSON_get(json, (double)index);
  return SKStoreToNode(isolate, fvalue, false);
}

Local<Value> ObjectHas(Isolate* isolate, Local<Object> target,
                       Local<Value> prop) {
  v8::String::Utf8Value utf8Prop(isolate, prop);
  std::string strProp(*utf8Prop);
  if (strProp == "clone") return Boolean::New(isolate, true);
  if (strProp == "toJSON") return Boolean::New(isolate, true);
  Local<Context> context = isolate->GetCurrentContext();
  Local<External> external = target->Get(context, FromUtf8(isolate, "hdl"))
                                 .ToLocalChecked()
                                 .As<External>();
  Local<Object> fields = CheckFields(isolate, external, target);
  Local<Value> idx = fields->Get(context, prop).ToLocalChecked();
  return Boolean::New(isolate, idx->IsUint32());
}

Local<Value> ObjectOwnKeys(Isolate* isolate, Local<Object> target) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<External> external = target->Get(context, FromUtf8(isolate, "hdl"))
                                 .ToLocalChecked()
                                 .As<External>();
  Local<Object> fields = CheckFields(isolate, external, target);
  return fields->GetOwnPropertyNames(context).ToLocalChecked();
}

Local<Value> ObjectOwnPropertyDescriptor(Isolate* isolate, Local<Object> target,
                                         Local<Value> prop) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<External> external = target->Get(context, FromUtf8(isolate, "hdl"))
                                 .ToLocalChecked()
                                 .As<External>();
  Local<Object> fields = CheckFields(isolate, external, target);
  Local<Value> idx = fields->Get(context, prop).ToLocalChecked();
  if (!idx->IsUint32()) {
    return Undefined(isolate);
  }
  uint32_t index = idx.As<Uint32>()->Value();
  void* json = external->Value();
  void* fvalue = SKIP_SKJSON_get(json, (double)index);
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
}

void CJObjectGet(const FunctionCallbackInfo<Value>& args) {
  Get(args, ObjectGet);
}

void CJObjectHas(const FunctionCallbackInfo<Value>& args) {
  Has(args, ObjectHas);
}

void CJObjectOwnKeys(const FunctionCallbackInfo<Value>& args) {
  OwnKeys(args, ObjectOwnKeys);
}

void CJObjectOwnPropertyDescriptor(const FunctionCallbackInfo<Value>& args) {
  Has(args, ObjectOwnPropertyDescriptor);
}

Local<Proxy> CJObject(Isolate* isolate, void* json) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> local_target = Object::New(isolate);
  local_target
      ->Set(context, FromUtf8(isolate, "hdl"), External::New(isolate, json))
      .FromJust();
  Local<Object> local_handler = Object::New(isolate);
  AddFunction(isolate, local_handler, "get", CJObjectGet);
  AddFunction(isolate, local_handler, "has", CJObjectHas);
  AddFunction(isolate, local_handler, "ownKeys", CJObjectOwnKeys);
  AddFunction(isolate, local_handler, "getOwnPropertyDescriptor",
              CJObjectOwnPropertyDescriptor);
  return Proxy::New(context, local_target, local_handler).ToLocalChecked();
}

}  // namespace skjson