// skthandle.h
#ifndef SKTHANDLE_H
#define SKTHANDLE_H

#include <node.h>
#include <node_object_wrap.h>

#include <string>

namespace skstore {

class THandle : public node::ObjectWrap {
 public:
  explicit THandle(const std::string& table);
  static void Init(v8::Local<v8::Object> exports);
  static v8::Local<v8::Value> Create(v8::Isolate* isolate,
                                     v8::Local<v8::String> hdl);
  const std::string m_table;

 private:
  ~THandle();

  static void CreateAndWrap(v8::Isolate*, v8::Local<v8::Value>,
                            v8::Local<v8::Object>);
  static void Prototype(v8::Local<v8::FunctionTemplate>);
  static void New(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Map(const v8::FunctionCallbackInfo<v8::Value>&);
};

}  // namespace skstore

#endif  // SKTHANDLE_H