#include "skstore.h"

#include <sstream>

#include "skcommon.h"
#include "skehandle.h"
#include "skiterator.h"
#include "skjson_utils.h"
#include "sklhandle.h"
#include "sktable.h"
#include "skthandle.h"
#include "skwatcher.h"

#define CJSON void*
#define CJArray void*
#define CJObject void*
#define SKCONTEXT void*
#define SKHANDLE void*
#define SKWRITER void*
#define SKITERATOR void*
#define SKOBSTACK void*
#define SKERROR void*

// Runtime
extern "C" {
char* sk_string_create(const char* buffer, uint32_t size);
}

// FromSkip
extern "C" {
// SKStore
double SKIP_SKStore_create();
char* SKIP_SKStore_lazy(SKCONTEXT ctx, char* name, uint32_t lazyFn);
char* SKIP_SKStore_asyncLazy(SKCONTEXT ctx, char* name, uint32_t getFn,
                             uint32_t lazyFn);
char* SKIP_SKStore_fromSkdb(SKCONTEXT ctx, char* table, char* name,
                            uint32_t lazyFn);
char* SKIP_SKStore_multimap(SKCONTEXT ctx, char* name, CJArray mappings);
char* SKIP_SKStore_multimapReduce(SKCONTEXT ctx, char* name, CJArray mappings,
                                  uint32_t accumulator, CJSON accInit);
double SKIP_SKStore_asyncResult(char* callId, char* name, CJSON key,
                                CJSON params, CJSON value);
char* SKIP_SKStore_nameForMeta(char* script, int64_t line, int64_t column);
SKOBSTACK SKIP_new_Obstack();
void SKIP_destroy_Obstack(SKOBSTACK obstack);
char* SKIP_getExceptionMessage(SKERROR error);
char* SKIP_SKStore_getExceptionStack(SKERROR error);
double SKIP_SKStore_createTables(CJSON schemas);
int SKIP_init_runtime(char* fileName, int is_create, int64_t capacity);
void SKIP_collect_alloc_error(int code, char* fileName, int is_create,
                              std::ostringstream& error);

CJArray SKIP_SKStore_jsonExtract(CJObject json, char* pattern);
}

namespace skstore {

using skbinding::CallGlobalStaticMethod;
using skbinding::CheckResult;
using skbinding::CreateHandle;
using skbinding::DeleteHandle;
using skbinding::FromUtf8;
using skbinding::GetContext;
using skbinding::GetHandle;
using skbinding::InitClass;
using skbinding::Metadata;
using skbinding::NatTryCatch;
using skbinding::RestoreContext;
using skbinding::SKTryCatch;
using skbinding::SKTryCatchVoid;
using skbinding::SwitchContext;
using skbinding::ToSKString;
using v8::Array;
using v8::Boolean;
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
using v8::Persistent;
using v8::Promise;
using v8::String;
using v8::Value;

static Persistent<Function> kSKStoreConstructor;
static Persistent<Array> kSKInitFunction;

SKStore::SKStore() {}

SKStore::~SKStore() {}

void SKStore::Prototype(Local<FunctionTemplate> tpl) {
  NODE_SET_PROTOTYPE_METHOD(tpl, "lazy", Lazy);
  NODE_SET_PROTOTYPE_METHOD(tpl, "asyncLazy", AsyncLazy);
  NODE_SET_PROTOTYPE_METHOD(tpl, "multimap", Multimap);
  NODE_SET_PROTOTYPE_METHOD(tpl, "multimapReduce", MultimapReduce);
  NODE_SET_PROTOTYPE_METHOD(tpl, "jsonExtract", JSONExtract);
}

void SKStore::Init(Local<Object> exports) {
  InitClass(exports, "SKStore", New, Prototype, &kSKStoreConstructor);
}

void SKStore::New(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.IsConstructCall()) {
    // Invoked as constructor: `new Class(...)`
    SKStore* obj = new SKStore();
    obj->Wrap(args.This());
    args.GetReturnValue().Set(args.This());
  } else {
    // Invoked as plain function `Class(...)`, turn into construct call.
    Local<Function> cons = args.Data()
                               .As<Object>()
                               ->GetInternalField(0)
                               .As<Value>()
                               .As<Function>();
    Local<Object> result = cons->NewInstance(context).ToLocalChecked();
    args.GetReturnValue().Set(result);
  }
}

Local<Value> SKStore::Create(Isolate* isolate) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<Function> constructor = kSKStoreConstructor.Get(isolate);
  return constructor->NewInstance(context).ToLocalChecked();
}

void SKStore::Lazy(const FunctionCallbackInfo<Value>& args) {
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
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter.")));
    return;
  };
  if (!args[0]->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "Parameter must be a function.")));
    return;
  }
  std::string script;
  int line = 0, column = 0;
  Metadata(isolate, script, line, column);
  Local<Function> cb = Local<Function>::Cast(args[0]);
  char* skScript = sk_string_create(script.c_str(), script.size());
  char* skName = SKIP_SKStore_nameForMeta(skScript, line, column);
  uint32_t mapper = CreateHandle(isolate, cb);
  char* skResult = SKIP_SKStore_lazy(ctx, skName, mapper);
  args.GetReturnValue().Set(
      LHandle::Create(isolate, FromUtf8(isolate, skResult)));
}

void SKStore::AsyncLazy(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx == nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called outside of a SKStore function.")));
    return;
  }
  if (args.Length() != 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameters.")));
    return;
  };
  if (!args[0]->IsFunction() || !args[1]->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "Parameters must be functions.")));
    return;
  }
  std::string script;
  int line = 0, column = 0;
  Metadata(isolate, script, line, column);
  Local<Function> getCb = Local<Function>::Cast(args[0]);
  Local<Function> computeCb = Local<Function>::Cast(args[1]);
  char* skScript = sk_string_create(script.c_str(), script.size());
  char* skName = SKIP_SKStore_nameForMeta(skScript, line, column);
  uint32_t getHdl = CreateHandle(isolate, getCb);
  uint32_t computeHdl = CreateHandle(isolate, computeCb);
  char* skResult = SKIP_SKStore_asyncLazy(ctx, skName, getHdl, computeHdl);
  args.GetReturnValue().Set(
      LHandle::Create(isolate, FromUtf8(isolate, skResult)));
}

bool ConvertMappings(Isolate* isolate, Local<Array> mappings,
                     Local<Array> mappings_) {
  Local<Context> context = isolate->GetCurrentContext();
  int l = mappings->Length();
  for (int i = 0; i < l; i++) {
    Local<Value> mapping = mappings->Get(context, i).ToLocalChecked();
    Local<Value> handle;
    Local<Value> mapper;
    if (mapping->IsArray()) {
      Local<Array> mappingArr = mapping.As<Array>();
      handle = mappingArr->Get(context, 0).ToLocalChecked();
      mapper = mappingArr->Get(context, 1).ToLocalChecked();
    } else if (mapping->IsObject()) {
      Local<Object> mappingObject = mapping.As<Object>();
      handle = mappingObject->Get(context, FromUtf8(isolate, "handle"))
                   .ToLocalChecked();
      mapper = mappingObject->Get(context, FromUtf8(isolate, "mapper"))
                   .ToLocalChecked();
    } else {
      return false;
    }
    if (!handle->IsObject() || !mapper->IsFunction()) {
      return false;
    }
    EHandle* eHandle = node::ObjectWrap::Unwrap<EHandle>(handle.As<Object>());
    Local<Function> mapperFn = mapper.As<Function>();
    Local<Array> mapping_ = Array::New(isolate);
    mapping_
        ->Set(context, mapping_->Length(),
              FromUtf8(isolate, eHandle->getName()))
        .FromJust();
    mapping_
        ->Set(context, mapping_->Length(),
              Number::New(isolate, CreateHandle(isolate, mapperFn)))
        .FromJust();
    mappings_->Set(context, mappings_->Length(), mapping_).FromJust();
  }
  return true;
}

void SKStore::Multimap(const FunctionCallbackInfo<Value>& args) {
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
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter.")));
    return;
  };
  if (!args[0]->IsArray()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Parameter must be an array.")));
    return;
  }
  std::string script;
  int line = 0, column = 0;
  Metadata(isolate, script, line, column);
  char* skScript = sk_string_create(script.c_str(), script.size());
  char* skName = SKIP_SKStore_nameForMeta(skScript, line, column);
  Local<Array> mappings = Array::New(isolate);
  if (ConvertMappings(isolate, args[0].As<Array>(), mappings)) {
    NatTryCatch(isolate, [&](Isolate* isolate) {
      char* skResult = SKIP_SKStore_multimap(
          ctx, skName, skjson::NodeToSKStore(isolate, mappings));
      MaybeLocal<Object> eHandle =
          EHandle::Create(isolate, FromUtf8(isolate, skResult));
      if (!eHandle.IsEmpty())
        args.GetReturnValue().Set(eHandle.ToLocalChecked());
    });
  } else {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid mapping element.")));
  }
}

void SKStore::MultimapReduce(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx == nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called outside of a SKStore function.")));
    return;
  }
  if (args.Length() != 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameter.")));
    return;
  };
  if (!args[0]->IsArray()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Parameter must be an array.")));
    return;
  }
  if (!args[1]->IsObject()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The second parameter must be an object.")));
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
  std::string script;
  int line = 0, column = 0;
  Metadata(isolate, script, line, column);
  char* skScript = sk_string_create(script.c_str(), script.size());
  char* skName = SKIP_SKStore_nameForMeta(skScript, line, column);
  Local<Array> mappings = Array::New(isolate);
  if (ConvertMappings(isolate, args[0].As<Array>(), mappings)) {
    uint32_t accMapper = CreateHandle(isolate, accumulator);
    void* skInitValue = skjson::NodeToSKStore(
        isolate, accumulator->Get(context, FromUtf8(isolate, "default"))
                     .ToLocalChecked());
    NatTryCatch(isolate, [&](Isolate* isolate) {
      char* skResult = SKIP_SKStore_multimapReduce(
          ctx, skName, skjson::NodeToSKStore(isolate, mappings), accMapper,
          skInitValue);
      MaybeLocal<Object> eHandle =
          EHandle::Create(isolate, FromUtf8(isolate, skResult));
      if (!eHandle.IsEmpty())
        args.GetReturnValue().Set(eHandle.ToLocalChecked());
    });
  }
}

void SKStore::JSONExtract(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() != 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameters.")));
    return;
  };
  if (!args[0]->IsObject() || !args[1]->IsString()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid parameter type.")));
    return;
  }
  NatTryCatch(isolate, [&args](Isolate* isolate) {
    v8::String::Utf8Value pattern(isolate, args[1]);
    const char* strPattern = *pattern;
    CJArray skResult = SKIP_SKStore_jsonExtract(
        skjson::NodeToSKStore(isolate, args[0]),
        sk_string_create(strPattern, strlen(strPattern)));
    args.GetReturnValue().Set(skjson::SKStoreToNode(isolate, skResult, false));
  });
}

void Register(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() != 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameters.")));
    return;
  }
  if (!args[0]->IsObject()) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The first parameter must be an object.")));
    return;
  }
  if (!args[1]->IsArray()) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The second parameter must be an array.")));
    return;
  }
  Local<Array> data = args[1].As<Array>();
  Local<Context> context = isolate->GetCurrentContext();
  Local<String> jscallid = data->Get(context, 0).ToLocalChecked().As<String>();
  Local<String> jsname = data->Get(context, 1).ToLocalChecked().As<String>();
  Local<Value> jskey = data->Get(context, 2).ToLocalChecked();
  Local<Value> jsparams = data->Get(context, 3).ToLocalChecked();
  SKOBSTACK obstack = SKIP_new_Obstack();
  char* skcallid = ToSKString(isolate, jscallid);
  char* skname = ToSKString(isolate, jsname);
  CJSON skkey = skjson::NodeToSKStore(isolate, jskey);
  CJSON skparam = skjson::NodeToSKStore(isolate, jsparams);
  CJSON skvalue = skjson::NodeToSKStore(isolate, args[0]);
  int result =
      (int)SKIP_SKStore_asyncResult(skcallid, skname, skkey, skparam, skvalue);
  SKIP_destroy_Obstack(obstack);
  if (result < 0) {
    Local<Value> error_;
    if (DeleteHandle(isolate, (uint32_t)(-result), error_) &&
        error_->IsObject()) {
      Local<Value> message = error_->ToObject(context)
                                 .ToLocalChecked()
                                 ->Get(context, FromUtf8(isolate, "message"))
                                 .ToLocalChecked();
      isolate->ThrowException(Exception::Error(message.As<String>()));
      return;
    } else {
      isolate->ThrowException(Exception::Error(
          FromUtf8(isolate, "Unable to register async function result.")));
      return;
    }
  }
}

void DoLater(Isolate* isolate, Local<Value> value, Local<Array> data) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> global = context->Global();
  Local<Function> setTimeout =
      global->Get(context, FromUtf8(isolate, "setTimeout"))
          .ToLocalChecked()
          .As<Function>();
  Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, Register);
  Local<Function> fn = tpl->GetFunction(context).ToLocalChecked();
  const unsigned argc = 4;
  Local<Value> argv[argc] = {fn, Number::New(isolate, 0), value, data};
  (void)setTimeout->Call(context, Null(isolate), argc, argv);
}

void Success(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() != 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter.")));
    return;
  };
  if (!args[0]->IsObject()) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "Parameter must be an object.")));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Array> data = args.Data().As<Array>();
  Local<Object> value = args[0]->ToObject(context).ToLocalChecked();
  Local<String> payloadName = FromUtf8(isolate, "payload");
  Local<String> metadataName = FromUtf8(isolate, "metadata");
  Local<Value> payload = value->Get(context, payloadName).ToLocalChecked();
  Local<Value> metadata = value->Get(context, metadataName).ToLocalChecked();
  Local<Object> obj = Object::New(isolate);
  if (!payload->IsNull() && !payload->IsUndefined()) {
    obj->Set(context, FromUtf8(isolate, "status"), FromUtf8(isolate, "success"))
        .FromJust();
    obj->Set(context, payloadName, payload).FromJust();
    if (!metadata->IsNullOrUndefined()) {
      obj->Set(context, metadataName, metadata).FromJust();
    }
  } else {
    obj->Set(context, FromUtf8(isolate, "status"),
             FromUtf8(isolate, "unchanged"))
        .FromJust();
    if (!metadata->IsNullOrUndefined()) {
      obj->Set(context, metadataName, metadata).FromJust();
    }
  };
  DoLater(isolate, obj, data);
}

void Failure(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() != 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter.")));
    return;
  };
  Local<Context> context = isolate->GetCurrentContext();
  Local<Array> data = args.Data().As<Array>();
  Local<Object> obj = Object::New(isolate);
  obj->Set(context, FromUtf8(isolate, "status"), FromUtf8(isolate, "failure"))
      .FromJust();
  if (args[0]->IsString()) {
    obj->Set(context, FromUtf8(isolate, "error"), args[0]).FromJust();
  } else if (args[0]->IsNativeError()) {
    Local<Object> jserror = args[0]->ToObject(context).ToLocalChecked();
    obj->Set(
           context, FromUtf8(isolate, "error"),
           jserror->Get(context, FromUtf8(isolate, "message")).ToLocalChecked())
        .FromJust();
  } else {
    Local<Value> message = skbinding::JSONStringify(isolate, args[0]);
    obj->Set(context, FromUtf8(isolate, "error"), message).FromJust();
  }
  DoLater(isolate, obj, data);
}

thread_local static bool zInilialized = false;

void CreateSKStore(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (zInilialized) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "SKStore can only be created one time.")));
    return;
  }
  if (args.Length() < 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "Must have at least two parameters.")));
    return;
  };
  if (!args[0]->IsFunction() || !args[1]->IsArray()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid parameter type.")));
    return;
  }
  int code = SKIP_init_runtime(nullptr, 0, 0);
  if (code != 0) {
    std::ostringstream error;
    SKIP_collect_alloc_error(code, nullptr, 0, error);
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, error.str().c_str())));
    return;
  }
  bool connect = true;
  if (args.Length() > 2 && args[2]->IsBoolean()) {
    connect = args[2].As<Boolean>()->Value();
  }
  if (connect) {
    isolate->ThrowException(
        Exception::Error(FromUtf8(isolate, "TODO: Mirror.")));
  } else {
    SKOBSTACK obstack = SKIP_new_Obstack();
    SKWatcher* watcher = new SKWatcher();
    setWatcher(watcher);
    Local<Array> schemas = args[1].As<Array>();
    CJArray skschemas = skjson::NodeToSKStore(isolate, schemas);
    int result = (int)SKIP_SKStore_createTables(skschemas);
    if (CheckResult(isolate, result, "Unable to create tables.")) {
      Local<Context> context = isolate->GetCurrentContext();
      Local<Array> data = Array::New(isolate, 2);
      data->Set(context, 0, args[0]).FromJust();
      data->Set(context, 1, schemas).FromJust();
      kSKInitFunction.Reset(isolate, data);
      int result = (int)SKIP_SKStore_create();
      Local<External> watcherValue = External::New(isolate, (void*)watcher);
      if (CheckResult(isolate, result, "Unable to create skstore graph.")) {
        int l = schemas->Length();
        Local<Array> tables = Array::New(isolate, l);
        for (int i = 0; i < l; i++) {
          Local<Object> schema = schemas->Get(context, i)
                                     .ToLocalChecked()
                                     ->ToObject(context)
                                     .ToLocalChecked();
          Local<String> table = schema->Get(context, FromUtf8(isolate, "name"))
                                    .ToLocalChecked()
                                    .As<String>();
          Local<Array> cschemas =
              schema->Get(context, FromUtf8(isolate, "expected"))
                  .ToLocalChecked()
                  .As<Array>();
          int cl = cschemas->Length();
          std::ostringstream columns;
          for (int j = 0; j < cl; j++) {
            if (j > 0) columns << ",";
            Local<Object> cschema = cschemas->Get(context, j)
                                        .ToLocalChecked()
                                        ->ToObject(context)
                                        .ToLocalChecked();
            Local<String> column =
                cschema->Get(context, FromUtf8(isolate, "name"))
                    .ToLocalChecked()
                    .As<String>();
            String::Utf8Value name(isolate, column);
            columns << *name;
          }
          Local<String> strColumns = FromUtf8(isolate, columns.str().c_str());
          MaybeLocal<Object> tableObj =
              Table::Create(isolate, table, strColumns, watcherValue);
          if (!tableObj.IsEmpty()) {
            tables->Set(context, i, tableObj.ToLocalChecked()).FromJust();
          } else
            break;
        }
        args.GetReturnValue().Set(tables);
      }
    }
    zInilialized = true;
    SKIP_destroy_Obstack(obstack);
  }
}

void CValue(const FunctionCallbackInfo<Value>& args, const char* type) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "Must have at least one parameters.")));
    return;
  };
  if (!args[0]->IsString()) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The first parameter must be a string.")));
    return;
  }
  if (args.Length() > 1 && !(args[1]->IsBoolean() || args[1]->IsUndefined())) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The second parameter must be a boolean.")));
    return;
  }
  if (args.Length() > 2 && !(args[2]->IsBoolean() || args[2]->IsUndefined())) {
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The third parameter must be a boolean.")));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> obj = Object::New(isolate);
  obj->Set(context, FromUtf8(isolate, "name"), args[0]).FromJust();
  obj->Set(context, FromUtf8(isolate, "type"), FromUtf8(isolate, type))
      .FromJust();
  if (args.Length() > 1 && args[1]->IsBoolean()) {
    obj->Set(context, FromUtf8(isolate, "primary"), args[1]).FromJust();
  }
  if (args.Length() > 2 && args[2]->IsBoolean()) {
    obj->Set(context, FromUtf8(isolate, "notnull"), args[2]).FromJust();
  }
  args.GetReturnValue().Set(obj);
}

void CInteger(const FunctionCallbackInfo<Value>& args) {
  CValue(args, "INTERGER");
}

void CFloat(const FunctionCallbackInfo<Value>& args) {
  CValue(args, "FLOAT");
}

void CText(const FunctionCallbackInfo<Value>& args) {
  CValue(args, "TEXT");
}

void CJson(const FunctionCallbackInfo<Value>& args) {
  CValue(args, "JSON");
}

void Schema(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "Must have at least two parameters.")));
    return;
  };
  if (!args[0]->IsString() || !args[1]->IsArray()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid parameter type.")));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> obj = Object::New(isolate);
  obj->Set(context, FromUtf8(isolate, "name"), args[0]).FromJust();
  obj->Set(context, FromUtf8(isolate, "expected"), args[1]).FromJust();
  args.GetReturnValue().Set(obj);
}

void Init(Local<Object> exports) {
  NODE_SET_METHOD(exports, "createSKStore", CreateSKStore);
  NODE_SET_METHOD(exports, "cinteger", CInteger);
  NODE_SET_METHOD(exports, "cfloat", CFloat);
  NODE_SET_METHOD(exports, "ctext", CText);
  NODE_SET_METHOD(exports, "cjson", CJson);
  NODE_SET_METHOD(exports, "schema", Schema);
  NonEmptyIterator::Init(exports);
  EHandle::Init(exports);
  LHandle::Init(exports);
  LSelf::Init(exports);
  THandle::Init(exports);
  Table::Init(exports);
  SKStore::Init(exports);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, Init)

extern "C" {

void SKIP_SKStore_init(SKCONTEXT ctx) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Context> context = isolate->GetCurrentContext();
  SKCONTEXT current = SwitchContext(ctx);
  Local<Array> data = kSKInitFunction.Get(isolate);
  v8::TryCatch tryCatch(isolate);
  Local<Function> userInit =
      data->Get(context, 0).ToLocalChecked().As<Function>();
  Local<Array> schemas = data->Get(context, 1).ToLocalChecked().As<Array>();
  Local<Value> skstore = SKStore::Create(isolate);
  int l = schemas->Length();
  const unsigned argc = l + 1;
  Local<Value> argv[argc];
  argv[0] = skstore;
  for (int i = 0; i < l; i++) {
    Local<Object> schema = schemas->Get(context, i)
                               .ToLocalChecked()
                               ->ToObject(context)
                               .ToLocalChecked();
    Local<String> table = schema->Get(context, FromUtf8(isolate, "name"))
                              .ToLocalChecked()
                              .As<String>();
    argv[1 + i] = THandle::Create(isolate, table);
  }
  SKTryCatchVoid(
      isolate, userInit, Null(isolate), argc, argv,
      [&current](Isolate* isolate) { RestoreContext(current); },
      [&current](Isolate* isolate) { RestoreContext(current); });
}

CJSON SKIP_SKStore_applyLazyFun(uint32_t fnId, SKCONTEXT ctx, SKHANDLE self,
                                CJSON key) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> fn_;
  if (!GetHandle(isolate, fnId, fn_)) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Unable to retrieve lazy function.")));
    return nullptr;
  }
  if (!fn_->IsFunction()) {
    isolate->ThrowException(
        Exception::Error(FromUtf8(isolate, "Invalid lazy function.")));
    return nullptr;
  }
  SKCONTEXT current = SwitchContext(ctx);
  Local<Function> fn = fn_.As<Function>();
  Local<Value> selfHdl = LSelf::Create(isolate, External::New(isolate, self));
  Local<Value> jsKey = skjson::SKStoreToNode(isolate, key, false);
  const unsigned argc = 2;
  Local<Value> argv[argc] = {selfHdl, jsKey};
  return SKTryCatch(
      isolate, fn, Null(isolate), argc, argv,
      [&current](Isolate* isolate, Local<Value> jsResult) {
        RestoreContext(current);
        return skjson::NodeToSKStore(isolate, jsResult);
      },
      [&current](Isolate* isolate) { RestoreContext(current); });
}

CJSON SKIP_SKStore_applyParamsFun(uint32_t getId, SKCONTEXT ctx, CJSON key) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> get_;
  if (!GetHandle(isolate, getId, get_)) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Unable to retrieve async lazy get function.")));
    return nullptr;
  }
  if (!get_->IsFunction()) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Invalid async lazy get function.")));
    return nullptr;
  }
  SKCONTEXT current = SwitchContext(ctx);
  Local<Function> get = get_.As<Function>();
  Local<Value> jsKey = skjson::SKStoreToNode(isolate, key, false);
  const unsigned argc = 1;
  Local<Value> argv[argc] = {jsKey};
  return SKTryCatch(
      isolate, get, Null(isolate), argc, argv,
      [&current](Isolate* isolate, Local<Value> jsResult) {
        RestoreContext(current);
        return skjson::NodeToSKStore(isolate, jsResult);
      },
      [&current](Isolate* isolate) { RestoreContext(current); });
}

void SKIP_SKStore_applyLazyAsyncFun(uint32_t fnId, char* skcallid, char* skname,
                                    CJSON skkey, CJSON skparams) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> fn_;
  if (!GetHandle(isolate, fnId, fn_)) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Unable to retrieve async lazy function.")));
    return;
  }
  if (!fn_->IsFunction()) {
    isolate->ThrowException(
        Exception::Error(FromUtf8(isolate, "Invalid async lazy function.")));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  Local<Function> fn = fn_.As<Function>();
  Local<String> jscallid = FromUtf8(isolate, skcallid);
  Local<String> jsname = FromUtf8(isolate, skname);
  Local<Value> jskey = skjson::SKStoreToNode(isolate, skkey, true);
  Local<Value> jsparams = skjson::SKStoreToNode(isolate, skparams, true);
  Local<Array> data = Array::New(isolate, 4);
  data->Set(context, 0, jscallid).FromJust();
  data->Set(context, 1, jsname).FromJust();
  data->Set(context, 2, jskey).FromJust();
  data->Set(context, 3, jsparams).FromJust();
  const unsigned argc = 2;
  Local<Value> argv[argc] = {jskey, jsparams};
  Local<Value> jsResult =
      fn->Call(context, Null(isolate), argc, argv).ToLocalChecked();
  Local<FunctionTemplate> successTpl =
      FunctionTemplate::New(isolate, Success, data);
  Local<Function> successFn = successTpl->GetFunction(context).ToLocalChecked();
  if (jsResult->IsPromise()) {
    Local<Promise> promise = jsResult.As<Promise>();
    Local<FunctionTemplate> failureTpl =
        FunctionTemplate::New(isolate, Failure, data);
    Local<Function> failureFn =
        failureTpl->GetFunction(context).ToLocalChecked();
    (void)promise->Then(context, successFn, failureFn);
  } else {
    const unsigned argc1 = 1;
    Local<Value> argv1[argc1] = {jsResult};
    successFn->Call(context, Null(isolate), argc1, argv1).ToLocalChecked();
  }
}

double SKIP_SKStore_getErrorHdl(SKERROR error) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> obj = Object::New(isolate);
  char* skmessage = SKIP_getExceptionMessage(error);
  obj->Set(context, FromUtf8(isolate, "message"), FromUtf8(isolate, skmessage))
      .FromJust();
  char* skstack = SKIP_SKStore_getExceptionStack(error);
  obj->Set(context, FromUtf8(isolate, "stack"), FromUtf8(isolate, skstack))
      .FromJust();
  return (double)CreateHandle(isolate, obj);
}

}  // extern "C"

}  // namespace skstore