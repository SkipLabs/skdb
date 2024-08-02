// skthandle.cc
#include "skthandle.h"

#include <iostream>
#include <map>

#include "skcommon.h"
#include "skehandle.h"
#include "skjson_utils.h"

#define CJSON void*
#define SKCONTEXT void*
#define SKHANDLE const void*
#define SKWRITER void*

// Runtime
extern "C" {
char* sk_string_create(const char* buffer, uint32_t size);
}

extern "C" {
// Handle
char* SKIP_SKStore_fromSkdb(SKCONTEXT ctx, char* table, char* name,
                            uint32_t mapper);
char* SKIP_SKStore_nameForMeta(char* script, int64_t line, int64_t column);
// Writer
void SKIP_SKStore_writerSet(SKWRITER writer, CJSON key, CJSON value);
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
using v8::Value;

static Persistent<Function> kTHandleConstructor;

THandle::THandle(const std::string& table) : m_table(table) {}

THandle::~THandle() {}

void THandle::Prototype(Local<FunctionTemplate> tpl) {
  NODE_SET_PROTOTYPE_METHOD(tpl, "map", Map);
}

void THandle::Init(Local<Object> exports) {
  InitClass(exports, "THandle", New, Prototype, &kTHandleConstructor);
}

bool IsString(Local<Value> value);

void THandle::CreateAndWrap(Isolate* isolate, Local<Value> value,
                            Local<Object> toWrap) {
  v8::String::Utf8Value table(isolate, value);
  std::string strTable(*table);
  THandle* obj = new THandle(strTable);
  obj->Wrap(toWrap);
}

void THandle::New(const FunctionCallbackInfo<Value>& args) {
  NewClass(args, IsString, CreateAndWrap);
}

Local<Value> THandle::Create(Isolate* isolate, Local<String> hdl) {
  Local<Context> context = isolate->GetCurrentContext();
  const int argc = 1;
  Local<Value> argv[argc] = {hdl};
  Local<Function> constructor = kTHandleConstructor.Get(isolate);
  return constructor->NewInstance(context, argc, argv).ToLocalChecked();
}

void THandle::Map(const v8::FunctionCallbackInfo<v8::Value>& args) {
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
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The parameter must be a function.")));
    return;
  };
  std::string script;
  int line = 0, column = 0;
  Metadata(isolate, script, line, column);
  Local<Function> cb = Local<Function>::Cast(args[0]);
  char* skScript = sk_string_create(script.c_str(), script.size());
  char* skName = SKIP_SKStore_nameForMeta(skScript, line, column);
  THandle* tHandle = ObjectWrap::Unwrap<THandle>(args.Holder());
  char* skTable =
      sk_string_create(tHandle->m_table.c_str(), tHandle->m_table.size());
  uint32_t mapper = CreateHandle(isolate, cb);
  char* skResult = SKIP_SKStore_fromSkdb(ctx, skTable, skName, mapper);
  MaybeLocal<Object> eHandle =
      EHandle::Create(isolate, FromUtf8(isolate, skResult));
  if (!eHandle.IsEmpty()) args.GetReturnValue().Set(eHandle.ToLocalChecked());
}

extern "C" {

void SKIP_SKStore_applyMapTableFun(uint32_t mapperId, SKCONTEXT ctx,
                                   SKWRITER writer, CJSON row, double occ) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> mapper_;
  if (!GetHandle(isolate, mapperId, mapper_)) {
    isolate->ThrowException(Exception::Error(
        FromUtf8(isolate, "Unable to retrieve map function.")));
    return;
  }
  if (!mapper_->IsFunction()) {
    isolate->ThrowException(
        Exception::Error(FromUtf8(isolate, "Invalid map function.")));
    return;
  }
  SKCONTEXT current = SwitchContext(ctx);
  Local<Function> mapper = mapper_.As<Function>();
  Local<Value> jsRow = skjson::SKStoreToNode(isolate, row, false);
  const unsigned argc = 2;
  Local<Value> argv[argc] = {jsRow, Number::New(isolate, occ)};
  SKTryCatch(
      isolate, mapper, Null(isolate), argc, argv,
      [&current, &writer](Isolate* isolate, Local<Value> jsResult) {
        RestoreContext(current);
        Local<Context> context = isolate->GetCurrentContext();
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
        }
        return nullptr;
      },
      [&current](Isolate* isolate) { RestoreContext(current); });
}

}  // extern "C"

}  // namespace skstore