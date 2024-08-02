// skstore.h
#ifndef SKSTORE_H
#define SKSTORE_H

#include <node.h>
#include <node_object_wrap.h>

namespace skstore {

class SKStore : public node::ObjectWrap {
 public:
  explicit SKStore();
  static void Init(v8::Local<v8::Object> exports);
  static v8::Local<v8::Value> Create(v8::Isolate* isolate);

 private:
  ~SKStore();

  static void Prototype(v8::Local<v8::FunctionTemplate>);
  static void New(const v8::FunctionCallbackInfo<v8::Value>&);
  //
  static void Lazy(const v8::FunctionCallbackInfo<v8::Value>&);
  static void AsyncLazy(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Multimap(const v8::FunctionCallbackInfo<v8::Value>&);
  static void MultimapReduce(const v8::FunctionCallbackInfo<v8::Value>&);
  static void JSONExtract(const v8::FunctionCallbackInfo<v8::Value>&);
};

void Init(v8::Local<v8::Object> exports);

}  // namespace skstore

#endif  // SKSTORE_H