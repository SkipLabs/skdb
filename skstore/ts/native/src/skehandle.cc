// skehandle.cc
#include "skehandle.h"

#include <iostream>
#include <map>

#include "skcommon.h"
#include "skiterator.h"
#include "skjson_utils.h"
#include "skthandle.h"

#define CJSON void*
#define SKCONTEXT void*
#define SKHANDLE void*
#define SKWRITER void*
#define SKITERATOR void*

// Runtime
extern "C" {
char* sk_string_create(const char* buffer, uint32_t size);
}

extern "C" {
// Handle
char* SKIP_SKStore_map(SKCONTEXT ctx, char* eagerHdl, char* name,
                       uint32_t fnHdl);
char* SKIP_SKStore_mapReduce(SKCONTEXT ctx, char* eagerHdl, char* name,
                             uint32_t fnPtr, uint32_t accumulator,
                             CJSON accInit);
CJSON SKIP_SKStore_get(SKCONTEXT ctx, char* handle, CJSON key);
CJSON SKIP_SKStore_maybeGet(SKCONTEXT ctx, char* handle, CJSON key);
double SKIP_SKStore_size(SKCONTEXT ctx, char* eagerHdl);
void SKIP_SKStore_toSkdb(SKCONTEXT ctx, char* eagerHdl, char* table,
                         uint32_t fnHdl);
char* SKIP_SKStore_nameForMeta(char* script, int64_t line, int64_t column);
// Writer
void SKIP_SKStore_writerSet(SKWRITER writer, CJSON key, CJSON value);
char* SKIP_SKStore_ksuid();
}

namespace skstore {

using skbinding::CallGlobalStaticMethod;
using skbinding::CreateHandle;
using skbinding::FromUtf8;
using skbinding::GetContext;
using skbinding::GetHandle;
using skbinding::InitClass;
using skbinding::Metadata;
using skbinding::NewClass;
using skbinding::RestoreContext;
using skbinding::SKTryCatch;
using skbinding::SwitchContext;
using v8::Array;
using v8::Context;
using v8::Exception;
using v8::External;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Number;
using v8::Object;
using v8::ObjectTemplate;
using v8::Persistent;
using v8::String;
using v8::TryCatch;
using v8::Value;

static Persistent<Function> kEHandleConstructor;

EHandle::EHandle(const std::string& id) : m_id(id) {}

EHandle::~EHandle() {}

const char* EHandle::getName() {
  return this->m_id.c_str();
}

void EHandle::Prototype(Local<FunctionTemplate> tpl) {
  NODE_SET_PROTOTYPE_METHOD(tpl, "get", Get);
  NODE_SET_PROTOTYPE_METHOD(tpl, "maybeGet", MaybeGet);
  NODE_SET_PROTOTYPE_METHOD(tpl, "size", Size);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map1", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map2", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map3", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map4", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map5", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map6", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map7", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map8", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "map9", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapN", Map);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce1", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce2", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce3", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce4", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce5", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce6", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce7", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce8", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduce9", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapReduceN", MapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo1", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo2", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo3", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo4", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo5", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo6", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo7", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo8", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapTo9", MapTo);
  NODE_SET_PROTOTYPE_METHOD(tpl, "mapToN", MapTo);
}

void EHandle::Init(Local<Object> exports) {
  InitClass(exports, "EHandle", New, Prototype, &kEHandleConstructor);
}

bool IsString(Local<Value> value) {
  return value->IsString();
}

void EHandle::CreateAndWrap(Isolate* isolate, Local<Value> value,
                            Local<Object> toWrap) {
  v8::String::Utf8Value handleId(isolate, value);
  std::string strHandleId(*handleId);
  EHandle* obj = new EHandle(strHandleId);
  obj->Wrap(toWrap);
}

void EHandle::New(const FunctionCallbackInfo<Value>& args) {
  NewClass(args, IsString, CreateAndWrap);
}

void EHandle::Get(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx == nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called outside of a SKStore function.")));
    return;
  }
  if (args.Length() != 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter")));
    return;
  };
  EHandle* eHandle = ObjectWrap::Unwrap<EHandle>(args.Holder());
  void* skKey = skjson::NodeToSKStore(isolate, args[0]);
  char* skHandle =
      sk_string_create(eHandle->m_id.c_str(), eHandle->m_id.size());
  void* skResult = SKIP_SKStore_get(ctx, skHandle, skKey);
  args.GetReturnValue().Set(skjson::SKStoreToNode(isolate, skResult, false));
}

void EHandle::MaybeGet(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx == nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called outside of a SKStore function.")));
    return;
  }
  if (args.Length() != 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter")));
    return;
  };
  EHandle* eHandle = ObjectWrap::Unwrap<EHandle>(args.Holder());
  void* skKey = skjson::NodeToSKStore(isolate, args[0]);
  char* skHandle =
      sk_string_create(eHandle->m_id.c_str(), eHandle->m_id.size());
  void* skResult = SKIP_SKStore_maybeGet(ctx, skHandle, skKey);
  args.GetReturnValue().Set(skjson::SKStoreToNode(isolate, skResult, false));
}

void EHandle::Size(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx == nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called outside of a SKStore function.")));
    return;
  }
  EHandle* eHandle = ObjectWrap::Unwrap<EHandle>(args.Holder());
  char* skHandle =
      sk_string_create(eHandle->m_id.c_str(), eHandle->m_id.size());
  double skResult = SKIP_SKStore_size(ctx, skHandle);
  args.GetReturnValue().Set(Number::New(isolate, skResult));
}

void EHandle::Map(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx == nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called outside of a SKStore function.")));
    return;
  }
  const char* fnnames[1] = {"mapElement"};
  MaybeLocal<Object> mbMapperObj =
      skbinding::CheckMapper(args, fnnames, 1, "EHandle.map", 0, false);
  if (mbMapperObj.IsEmpty()) {
    return;
  };
  Local<Object> mapperObj = mbMapperObj.ToLocalChecked();
  // generate name for now
  char* skName = SKIP_SKStore_ksuid();
  EHandle* eHandle = ObjectWrap::Unwrap<EHandle>(args.Holder());
  char* skHandle =
      sk_string_create(eHandle->m_id.c_str(), eHandle->m_id.size());
  uint32_t mapper = CreateHandle(isolate, mapperObj);
  char* skResult = SKIP_SKStore_map(ctx, skHandle, skName, mapper);
  MaybeLocal<Object> result =
      EHandle::Create(isolate, FromUtf8(isolate, skResult));
  if (!result.IsEmpty()) args.GetReturnValue().Set(result.ToLocalChecked());
}

void EHandle::MapReduce(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx == nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called outside of a SKStore function.")));
    return;
  }
  const char* fnnames[1] = {"mapElement"};
  MaybeLocal<Object> mbMapperObj =
      skbinding::CheckMapper(args, fnnames, 1, "EHandle.mapReduce", 1, true);
  if (mbMapperObj.IsEmpty()) {
    return;
  };
  Local<Object> mapperObj = mbMapperObj.ToLocalChecked();
  // generate name for now
  char* skName = SKIP_SKStore_ksuid();
  if (!args[1]->IsObject()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate,
        "EHandle.mapReduce: The second parameter must be an object.")));
    return;
  };
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> accumulator = args[1]->ToObject(context).ToLocalChecked();
  Local<Value> accumulate =
      accumulator->Get(context, FromUtf8(isolate, "accumulate"))
          .ToLocalChecked();
  Local<Value> dismiss =
      accumulator->Get(context, FromUtf8(isolate, "dismiss")).ToLocalChecked();
  if (!accumulate->IsFunction() && !dismiss->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The second parameter must be an Accumulator.")));
    return;
  }
  EHandle* eHandle = ObjectWrap::Unwrap<EHandle>(args.Holder());
  char* skHandle =
      sk_string_create(eHandle->m_id.c_str(), eHandle->m_id.size());
  uint32_t mapper = CreateHandle(isolate, mapperObj);
  uint32_t accMapper = CreateHandle(isolate, accumulator);
  void* skInitValue = skjson::NodeToSKStore(
      isolate,
      accumulator->Get(context, FromUtf8(isolate, "default")).ToLocalChecked());
  char* skResult = SKIP_SKStore_mapReduce(ctx, skHandle, skName, mapper,
                                          accMapper, skInitValue);

  MaybeLocal<Object> result =
      EHandle::Create(isolate, FromUtf8(isolate, skResult));
  if (!result.IsEmpty()) args.GetReturnValue().Set(result.ToLocalChecked());
}

void EHandle::MapTo(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx == nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called outside of a SKStore function.")));
    return;
  }
  const char* fnnames[1] = {"mapElement"};
  MaybeLocal<Object> mbMapperObj =
      skbinding::CheckMapper(args, fnnames, 1, "EHandle.mapTo", 1, false);
  if (mbMapperObj.IsEmpty()) {
    return;
  };
  Local<Object> mapperObj = mbMapperObj.ToLocalChecked();
  if (!args[0]->IsString() && !args[0]->IsObject()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The parameter must be a string or an object.")));
    return;
  };
  Local<Context> context = isolate->GetCurrentContext();
  const char* strTable;
  if (args[0]->IsString()) {
    v8::String::Utf8Value table(isolate, args[0]);
    strTable = *table;
  } else {
    Local<Object> object = args[0]->ToObject(context).ToLocalChecked();
    THandle* tHandle = ObjectWrap::Unwrap<THandle>(object);
    strTable = tHandle->m_table.c_str();
  }
  EHandle* eHandle = ObjectWrap::Unwrap<EHandle>(args.Holder());
  char* skHandle =
      sk_string_create(eHandle->m_id.c_str(), eHandle->m_id.size());
  char* skTable = sk_string_create(strTable, strlen(strTable));
  uint32_t mapper = CreateHandle(isolate, mapperObj);
  SKIP_SKStore_toSkdb(ctx, skHandle, skTable, mapper);
}

MaybeLocal<Object> EHandle::Create(Isolate* isolate, Local<String> hdl) {
  Local<Context> context = isolate->GetCurrentContext();
  const int argc = 1;
  Local<Value> argv[argc] = {hdl};
  Local<Function> constructor = kEHandleConstructor.Get(isolate);
  return constructor->NewInstance(context, argc, argv);
}

extern "C" {

void SKIP_SKStore_applyMapFun(uint32_t mapperId, SKCONTEXT ctx, SKWRITER writer,
                              CJSON key, SKITERATOR it) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> mapper_;
  if (!GetHandle(isolate, mapperId, mapper_)) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Unable to retrieve EHandle.map function.")));
    return;
  }
  if (!mapper_->IsObject()) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Invalid EHandle.map mapper object.")));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> mapper = mapper_.As<Object>();
  Local<Value> mapElement_ =
      mapper->Get(context, FromUtf8(isolate, "mapElement")).ToLocalChecked();
  if (!mapElement_->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate,
        "Invalid EHandle.map mapper object. (mapElement method not defined)")));
    return;
  }

  SKCONTEXT current = SwitchContext(ctx);
  Local<Function> mapElement = mapElement_.As<Function>();
  Local<Value> jsIt =
      NonEmptyIterator::Create(isolate, External::New(isolate, it));
  Local<Value> jsKey = skjson::SKStoreToNode(isolate, key, false);
  const unsigned argc = 2;
  Local<Value> argv[argc] = {jsKey, jsIt};
  SKTryCatch(
      isolate, mapElement, mapper, argc, argv,
      [&current, &writer](Isolate* isolate, Local<Value> jsResult) {
        Local<Context> context = isolate->GetCurrentContext();
        RestoreContext(current);
        Local<Value> gargv[1] = {jsResult};
        Local<Array> jsArr =
            CallGlobalStaticMethod(isolate, "Array", "from", 1, gargv)
                .As<Array>();
        int l = jsArr->Length();
        for (int i = 0; i < l; i++) {
          Local<Array> value =
              jsArr->Get(context, i).ToLocalChecked().As<Array>();
          SKIP_SKStore_writerSet(
              writer,
              skjson::NodeToSKStore(isolate,
                                    value->Get(context, 0).ToLocalChecked()),
              skjson::NodeToSKStore(isolate,
                                    value->Get(context, 1).ToLocalChecked()));
        };
        return nullptr;
      },
      [&current](Isolate* isolate) { RestoreContext(current); });
}

CJSON SKIP_SKStore_applyAccumulate(uint32_t accumulateId, CJSON acc,
                                   CJSON value) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Value> accumulator_;
  if (!GetHandle(isolate, accumulateId, accumulator_)) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Unable to retrieve accumulate function.")));
    return nullptr;
  }
  if (!accumulator_->IsObject()) {
    isolate->ThrowException(
        Exception::Error(FromUtf8(isolate, "Invalid accumulator.")));
    return nullptr;
  }
  Local<Object> accumulator = accumulator_->ToObject(context).ToLocalChecked();
  Local<Value> accumulate_ =
      accumulator->Get(context, FromUtf8(isolate, "accumulate"))
          .ToLocalChecked();
  if (!accumulate_->IsFunction()) {
    isolate->ThrowException(
        Exception::Error(FromUtf8(isolate, "Invalid accumulator.")));
    return nullptr;
  }
  Local<Function> accumulate = accumulate_.As<Function>();
  Local<Value> jsAcc = skjson::SKStoreToNode(isolate, acc, false);
  Local<Value> jsValue = skjson::SKStoreToNode(isolate, value, false);
  const unsigned argc = 2;
  Local<Value> argv[argc] = {jsAcc, jsValue};
  return SKTryCatch(
      isolate, accumulate, accumulator, argc, argv,
      [](Isolate* isolate, Local<Value> jsResult) {
        return skjson::NodeToSKStore(isolate, jsResult);
      },
      [](Isolate* isolate) {});
}

CJSON SKIP_SKStore_applyDismiss(uint32_t dismissId, CJSON acc, CJSON value) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Value> accumulator_;
  if (!GetHandle(isolate, dismissId, accumulator_)) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Unable to retrieve dismiss function.")));
    return nullptr;
  }
  if (!accumulator_->IsObject()) {
    isolate->ThrowException(
        Exception::Error(FromUtf8(isolate, "Invalid accumulator.")));
    return nullptr;
  }
  Local<Object> accumulator = accumulator_->ToObject(context).ToLocalChecked();
  Local<Value> dismiss_ =
      accumulator->Get(context, FromUtf8(isolate, "dismiss")).ToLocalChecked();
  if (!dismiss_->IsFunction()) {
    isolate->ThrowException(
        Exception::Error(FromUtf8(isolate, "Invalid accumulator.")));
    return nullptr;
  }
  Local<Function> dismiss = dismiss_.As<Function>();
  Local<Value> jsAcc = skjson::SKStoreToNode(isolate, acc, false);
  Local<Value> jsValue = skjson::SKStoreToNode(isolate, value, false);
  const unsigned argc = 2;
  Local<Value> argv[argc] = {jsAcc, jsValue};
  return SKTryCatch(
      isolate, dismiss, accumulator, argc, argv,
      [](Isolate* isolate, Local<Value> jsResult) {
        if (jsResult->IsNull() || jsResult->IsUndefined()) {
          return (void*)nullptr;
        }
        return skjson::NodeToSKStore(isolate, jsResult);
      },
      [](Isolate* isolate) {});
}

CJSON SKIP_SKStore_applyConvertToRowFun(uint32_t convId, CJSON key,
                                        SKITERATOR it) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> mapper_;
  if (!GetHandle(isolate, convId, mapper_)) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Unable to retrieve convertion function.")));
    return nullptr;
  }
  if (!mapper_->IsObject()) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Invalid EHandle.map mapper object.")));
    return nullptr;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> mapper = mapper_.As<Object>();
  Local<Value> mapElement_ =
      mapper->Get(context, FromUtf8(isolate, "mapElement")).ToLocalChecked();
  if (!mapElement_->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate,
        "Invalid EHandle.map mapper object. (mapElement method not defined)")));
    return nullptr;
  }

  Local<Function> mapElement = mapElement_.As<Function>();
  Local<Value> jsIt =
      NonEmptyIterator::Create(isolate, External::New(isolate, it));
  Local<Value> jsKey = skjson::SKStoreToNode(isolate, key, false);
  const unsigned argc = 2;
  Local<Value> argv[argc] = {jsKey, jsIt};
  return SKTryCatch(
      isolate, mapElement, mapper, argc, argv,
      [](Isolate* isolate, Local<Value> jsResult) {
        return skjson::NodeToSKStore(isolate, jsResult);
      },
      [](Isolate* isolate) {});
}

}  // extern "C"

}  // namespace skstore