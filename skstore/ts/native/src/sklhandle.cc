// skehandle.cc
#include "sklhandle.h"

#include "skcommon.h"
#include "skjson_utils.h"

#define CJSON void*
#define SKCONTEXT void*
#define SKHANDLE const void*

// Runtime
extern "C" {
char* sk_string_create(const char* buffer, uint32_t size);
}

extern "C" {
// Handle
CJSON SKIP_SKStore_getLazy(SKCONTEXT ctx, char* handle, CJSON key);
CJSON SKIP_SKStore_getSelf(SKCONTEXT ctx, SKHANDLE handle, CJSON key);
}

namespace skstore {

using skbinding::CallGlobalStaticMethod;
using skbinding::FromUtf8;
using skbinding::GetContext;
using skbinding::InitClass;
using skbinding::Metadata;
using skbinding::NewClass;
using v8::Array;
using v8::Context;
using v8::Exception;
using v8::External;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::Number;
using v8::Object;
using v8::ObjectTemplate;
using v8::Persistent;
using v8::String;
using v8::Value;

static Persistent<Function> kLHandleConstructor;
static Persistent<Function> kLSelfConstructor;

LHandle::LHandle(const std::string& id) : m_id(id) {}

LHandle::~LHandle() {}

void LHandle::Prototype(Local<FunctionTemplate> tpl) {
  NODE_SET_PROTOTYPE_METHOD(tpl, "get", Get);
}

void LHandle::Init(Local<Object> exports) {
  InitClass(exports, "LHandle", New, Prototype, &kLHandleConstructor);
}

bool IsString(Local<Value> value);

void LHandle::CreateAndWrap(Isolate* isolate, Local<Value> value,
                            Local<Object> toWrap) {
  v8::String::Utf8Value handleId(isolate, value);
  std::string strHandleId(*handleId);
  LHandle* obj = new LHandle(strHandleId);
  obj->Wrap(toWrap);
}

void LHandle::New(const FunctionCallbackInfo<Value>& args) {
  NewClass(args, IsString, CreateAndWrap);
}

void LHandle::Get(const FunctionCallbackInfo<Value>& args) {
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
  LHandle* lHandle = ObjectWrap::Unwrap<LHandle>(args.Holder());
  void* skKey = skjson::NodeToSKStore(isolate, args[0]);
  char* skHandle =
      sk_string_create(lHandle->m_id.c_str(), lHandle->m_id.size());
  void* skResult = SKIP_SKStore_getLazy(ctx, skHandle, skKey);
  args.GetReturnValue().Set(skjson::SKStoreToNode(isolate, skResult, false));
}

Local<Value> LHandle::Create(Isolate* isolate, Local<String> hdl) {
  Local<Context> context = isolate->GetCurrentContext();
  const int argc = 1;
  Local<Value> argv[argc] = {hdl};
  Local<Function> constructor = kLHandleConstructor.Get(isolate);
  return constructor->NewInstance(context, argc, argv).ToLocalChecked();
}

LSelf::LSelf(void* hdl) : m_hdl(hdl) {}

LSelf::~LSelf() {}

void LSelf::Prototype(Local<FunctionTemplate> tpl) {
  NODE_SET_PROTOTYPE_METHOD(tpl, "get", Get);
}

void LSelf::Init(Local<Object> exports) {
  InitClass(exports, "LSelf", New, Prototype, &kLSelfConstructor);
}

bool IsExternal(Local<Value> value);

void LSelf::CreateAndWrap(Isolate* isolate, Local<Value> value,
                          Local<Object> toWrap) {
  Local<External> external = value.As<External>();
  LSelf* obj = new LSelf(external->Value());
  obj->Wrap(toWrap);
}

void LSelf::New(const FunctionCallbackInfo<Value>& args) {
  NewClass(args, IsExternal, CreateAndWrap);
}

void LSelf::Get(const FunctionCallbackInfo<Value>& args) {
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
  LSelf* lSelf = ObjectWrap::Unwrap<LSelf>(args.Holder());
  void* skKey = skjson::NodeToSKStore(isolate, args[0]);
  void* skResult = SKIP_SKStore_getSelf(ctx, lSelf->m_hdl, skKey);
  args.GetReturnValue().Set(skjson::SKStoreToNode(isolate, skResult, false));
}

Local<Value> LSelf::Create(Isolate* isolate, Local<External> hdl) {
  Local<Context> context = isolate->GetCurrentContext();
  const int argc = 1;
  Local<Value> argv[argc] = {hdl};
  Local<Function> constructor = kLSelfConstructor.Get(isolate);
  return constructor->NewInstance(context, argc, argv).ToLocalChecked();
}

}  // namespace skstore