#include "skjson_utils.h"

#include <functional>
#include <sstream>
#include <string>

#include "skcommon.h"
#include "skjson_array.h"
#include "skjson_object.h"

// Import from JS
extern "C" {
// object
void* SKIP_SKJSON_startCJObject();
void SKIP_SKJSON_addToCJObject(void* obj, char* name, void* value);
void* SKIP_SKJSON_endCJObject(void* obj);
// array
void* SKIP_SKJSON_startCJArray();
void SKIP_SKJSON_addToCJArray(void* arr, void* value);
void* SKIP_SKJSON_endCJArray(void* arr);
// primitives
void* SKIP_SKJSON_createCJNull();
void* SKIP_SKJSON_createCJInt(int64_t v);
void* SKIP_SKJSON_createCJFloat(double v);
void* SKIP_SKJSON_createCJString(char* str);
void* SKIP_SKJSON_createCJBool(bool v);
}

// export TO JS
extern "C" {
double SKIP_SKJSON_typeOf(void* json);
int64_t SKIP_SKJSON_asInt64(void* json);
double SKIP_SKJSON_asFloat(void* json);
double SKIP_SKJSON_asInt(void* json);
int32_t SKIP_SKJSON_asBoolean(void* json);
char* SKIP_SKJSON_asString(void* json);
//
char* SKIP_SKJSON_fieldAt(void* json, double idx);
void* SKIP_SKJSON_get(void* json, double idx);
void* SKIP_SKJSON_at(void* json, double idx);
//
double SKIP_SKJSON_objectSize(void* json);
double SKIP_SKJSON_arraySize(void* json);
}

namespace skjson {

enum Type {
  TUndefined = 0,
  TNull,
  TInt,
  TFloat,
  TBoolean,
  TString,
  TArray,
  TObject,
};

using skbinding::FromUtf8;
using skbinding::ToSKString;
using v8::Array;
using v8::BigInt;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::External;
using v8::Function;
using v8::FunctionCallback;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Int32;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Null;
using v8::Number;
using v8::Object;
using v8::Proxy;
using v8::String;
using v8::Uint32;
using v8::Undefined;
using v8::Value;

void* ObjectToSKStore(Isolate* isolate, Local<Value> value) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> obj = value->ToObject(context).ToLocalChecked();
  Local<Array> props = obj->GetOwnPropertyNames(context).ToLocalChecked();
  void* skobj = SKIP_SKJSON_startCJObject();
  int l = props->Length();
  for (int i = 0; i < l; i++) {
    Local<Value> localKey = props->Get(context, i).ToLocalChecked();
    Local<Value> localValue = obj->Get(context, localKey).ToLocalChecked();
    SKIP_SKJSON_addToCJObject(skobj, ToSKString(isolate, localKey),
                              NodeToSKStore(isolate, localValue));
  }
  return SKIP_SKJSON_endCJObject(skobj);
}

void* NodeToSKStore(Isolate* isolate, Local<Value> value) {
  if (value->IsNull() || value->IsUndefined()) {
    return SKIP_SKJSON_createCJNull();
  } else if (value->IsString()) {
    return SKIP_SKJSON_createCJString(ToSKString(isolate, value));
  } else if (value->IsNumber()) {
    double v = value.As<Number>()->Value();
    int64_t iv = (int64_t)v;
    if (v == iv) {
      return SKIP_SKJSON_createCJInt(iv);
    } else {
      return SKIP_SKJSON_createCJFloat(v);
    }
  } else if (value->IsBoolean()) {
    return SKIP_SKJSON_createCJBool(value.As<Boolean>()->Value());
  } else if (value->IsBigInt()) {
    return SKIP_SKJSON_createCJInt(value.As<BigInt>()->Int64Value());
  } else if (value->IsInt32()) {
    return SKIP_SKJSON_createCJInt((int64_t)value.As<Int32>()->Value());
  } else if (value->IsUint32()) {
    return SKIP_SKJSON_createCJInt((int64_t)value.As<Uint32>()->Value());
  } else if (value->IsArray()) {
    Local<Context> context = isolate->GetCurrentContext();
    Local<Array> arr = Local<Array>::Cast(value);
    void* skarr = SKIP_SKJSON_startCJArray();
    int l = arr->Length();
    for (int i = 0; i < l; i++) {
      Local<Value> localValue = arr->Get(context, i).ToLocalChecked();
      SKIP_SKJSON_addToCJArray(skarr, NodeToSKStore(isolate, localValue));
    }
    return SKIP_SKJSON_endCJArray(skarr);
  } else if (value->IsProxy()) {
    Local<Proxy> proxy = value.As<Proxy>();
    Local<Value> vtarget = proxy->GetTarget();
    if (vtarget->IsObject()) {
      Local<Context> context = isolate->GetCurrentContext();
      Local<Object> target = vtarget->ToObject(context).ToLocalChecked();
      Local<Value> hdl =
          target->Get(context, FromUtf8(isolate, "hdl")).ToLocalChecked();
      if (hdl->IsExternal()) {
        Local<External> external = hdl.As<External>();
        return external->Value();
      }
    }
    return ObjectToSKStore(isolate, value);
  } else if (value->IsObject()) {
    return ObjectToSKStore(isolate, value);
  } else {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid SKStore value.")));
    return nullptr;
  }
}

Local<Value> SKStoreToNode(Isolate* isolate, void* json, bool clone) {
  if (json == nullptr) return Null(isolate);
  int type = SKIP_SKJSON_typeOf(json);
  switch (type) {
    case TNull:
      return Null(isolate);
    case TInt: {
      double iValue = SKIP_SKJSON_asInt(json);
      return Number::New(isolate, iValue);
    }
    case TFloat: {
      double dValue = SKIP_SKJSON_asFloat(json);
      return Number::New(isolate, dValue);
    }
    case TBoolean: {
      bool bValue = SKIP_SKJSON_asBoolean(json);
      return Boolean::New(isolate, bValue);
    }
    case TString: {
      char* sValue = SKIP_SKJSON_asString(json);
      return FromUtf8(isolate, sValue);
    }
    case TArray:
      if (clone) {
        Local<Context> context = isolate->GetCurrentContext();
        int size = (int)SKIP_SKJSON_arraySize(json);
        Local<Array> jsArr = Array::New(isolate, (int)size);
        for (int i = 0; i < size; i++) {
          void* field = SKIP_SKJSON_at(json, i);
          jsArr->Set(context, i, SKStoreToNode(isolate, field, true))
              .FromJust();
        }
        return jsArr;
      }
      return CJArray(isolate, json);
    case TObject:
      if (clone) {
        Local<Context> context = isolate->GetCurrentContext();
        int size = (int)SKIP_SKJSON_objectSize(json);
        Local<Object> jsObj = Object::New(isolate);
        for (int i = 0; i < size; i++) {
          char* field = SKIP_SKJSON_fieldAt(json, i);
          void* fvalue = SKIP_SKJSON_get(json, i);
          jsObj
              ->Set(context, FromUtf8(isolate, field),
                    SKStoreToNode(isolate, fvalue, true))
              .FromJust();
        }
        return jsObj;
      }
      return CJObject(isolate, json);
    case TUndefined:
    default:
      return Undefined(isolate);
  }
}

void Clone(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<External> external = args.Data().As<External>();
  Local<Value> value = SKStoreToNode(isolate, external->Value(), true);
  args.GetReturnValue().Set(value);
}

void Get(const FunctionCallbackInfo<Value>& args,
         std::function<Local<Value>(Isolate*, Local<Object>, Local<Value>,
                                    Local<Object>)>
             getValue) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 3) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Wrong number of arguments")));
    return;
  }
  if (!args[0]->IsObject() || !args[1]->IsString() || !args[2]->IsObject()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Wrong arguments")));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> local_target = args[0]->ToObject(context).ToLocalChecked();
  Local<Object> local_handler = args[2]->ToObject(context).ToLocalChecked();
  Local<Value> return_ =
      getValue(isolate, local_target, args[1], local_handler);
  args.GetReturnValue().Set(return_);
}

void Has(const FunctionCallbackInfo<Value>& args,
         std::function<Local<Value>(Isolate*, Local<Object>, Local<Value>)>
             hasValue) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Wrong number of arguments")));
    return;
  }
  if (!args[0]->IsObject() || !args[1]->IsString()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Wrong arguments")));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> local_target = args[0]->ToObject(context).ToLocalChecked();
  Local<Value> return_ = hasValue(isolate, local_target, args[1]);
  args.GetReturnValue().Set(return_);
}

void OwnKeys(const v8::FunctionCallbackInfo<v8::Value>& args,
             std::function<v8::Local<v8::Value>(v8::Isolate*,
                                                v8::Local<v8::Value> ownKeys)>
                 ownKeys) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Wrong number of arguments")));
    return;
  }
  if (!args[0]->IsObject()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Wrong arguments")));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> local_target = args[0]->ToObject(context).ToLocalChecked();
  Local<Value> return_ = ownKeys(isolate, local_target);
  args.GetReturnValue().Set(return_);
}

Local<Value> GetOwnProperty(Isolate* isolate, Local<Value> value) {
  Local<Context> context = isolate->GetCurrentContext();
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

}  // namespace skjson