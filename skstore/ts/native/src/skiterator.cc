// skiterator.cc
#include "skiterator.h"

#include <map>

#include "skcommon.h"
#include "skjson_utils.h"

#define CJSON void*
#define SKCONTEXT void*
#define SKITERATOR const void*

extern "C" {
// NonEmptyIterator
CJSON SKIP_SKStore_iteratorNext(SKITERATOR it);
CJSON SKIP_SKStore_iteratorUniqueValue(SKITERATOR it);
CJSON SKIP_SKStore_iteratorFirst(SKITERATOR it);
}

namespace skstore {

using skbinding::FromUtf8;
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

static Persistent<Function> kEmptyIteratorConstructor;

NonEmptyIterator::NonEmptyIterator(void* hdl) : m_hdl(hdl) {}

NonEmptyIterator::~NonEmptyIterator() {}

void NonEmptyIterator::Prototype(Local<FunctionTemplate> tpl) {
  NODE_SET_PROTOTYPE_METHOD(tpl, "next", Next);
  NODE_SET_PROTOTYPE_METHOD(tpl, "first", First);
  NODE_SET_PROTOTYPE_METHOD(tpl, "uniqueValue", UniqueValue);
  NODE_SET_PROTOTYPE_METHOD(tpl, "toArray", ToArray);
}

void NonEmptyIterator::Init(Local<Object> exports) {
  InitClass(exports, "NonEmptyIterator", New, Prototype,
            &kEmptyIteratorConstructor);
}

bool IsExternal(Local<Value> value) {
  return value->IsExternal();
}

void NonEmptyIterator::CreateAndWrap(Isolate* isolate, Local<Value> value,
                                     Local<Object> toWrap) {
  Local<External> external = value.As<External>();
  NonEmptyIterator* obj = new NonEmptyIterator(external->Value());
  obj->Wrap(toWrap);
}

void NonEmptyIterator::New(const FunctionCallbackInfo<Value>& args) {
  NewClass(args, IsExternal, CreateAndWrap);
}

Local<Value> NonEmptyIterator::Create(Isolate* isolate, Local<External> it) {
  Local<Context> context = isolate->GetCurrentContext();
  const int argc = 1;
  Local<Value> argv[argc] = {it};
  Local<Function> constructor = kEmptyIteratorConstructor.Get(isolate);
  return constructor->NewInstance(context, argc, argv).ToLocalChecked();
}

void NonEmptyIterator::Next(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  NonEmptyIterator* it = ObjectWrap::Unwrap<NonEmptyIterator>(args.Holder());
  void* skResult = SKIP_SKStore_iteratorNext(it->m_hdl);
  args.GetReturnValue().Set(skjson::SKStoreToNode(isolate, skResult, false));
}

void NonEmptyIterator::First(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  NonEmptyIterator* it = ObjectWrap::Unwrap<NonEmptyIterator>(args.Holder());
  void* skResult = SKIP_SKStore_iteratorFirst(it->m_hdl);
  args.GetReturnValue().Set(skjson::SKStoreToNode(isolate, skResult, false));
}

void NonEmptyIterator::UniqueValue(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  NonEmptyIterator* it = ObjectWrap::Unwrap<NonEmptyIterator>(args.Holder());
  void* skResult = SKIP_SKStore_iteratorUniqueValue(it->m_hdl);
  args.GetReturnValue().Set(skjson::SKStoreToNode(isolate, skResult, false));
}

void NonEmptyIterator::ToArray(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  NonEmptyIterator* it = ObjectWrap::Unwrap<NonEmptyIterator>(args.Holder());
  Local<Array> jsArr = Array::New(isolate);
  void* skValue = SKIP_SKStore_iteratorNext(it->m_hdl);
  while (skValue != nullptr) {
    Local<Value> jsValue = skjson::SKStoreToNode(isolate, skValue, false);
    jsArr->Set(context, jsArr->Length(), jsValue).FromJust();
  };
  args.GetReturnValue().Set(jsArr);
}

}  // namespace skstore