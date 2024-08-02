// skiterator.h
#ifndef SKITERATOR_H
#define SKITERATOR_H

#include <node.h>
#include <node_object_wrap.h>

namespace skstore {

class NonEmptyIterator : public node::ObjectWrap {
 public:
  explicit NonEmptyIterator(void* hdl);
  static void Init(v8::Local<v8::Object> exports);
  static v8::Local<v8::Value> Create(v8::Isolate*, v8::Local<v8::External>);

 private:
  ~NonEmptyIterator();

  static void CreateAndWrap(v8::Isolate*, v8::Local<v8::Value>,
                            v8::Local<v8::Object>);
  static void Prototype(v8::Local<v8::FunctionTemplate>);
  static void New(const v8::FunctionCallbackInfo<v8::Value>&);
  // Methods
  static void Next(const v8::FunctionCallbackInfo<v8::Value>&);
  static void First(const v8::FunctionCallbackInfo<v8::Value>&);
  static void UniqueValue(const v8::FunctionCallbackInfo<v8::Value>&);
  static void ToArray(const v8::FunctionCallbackInfo<v8::Value>&);

  const void* m_hdl;
};

}  // namespace skstore

#endif  // SKITERATOR_H