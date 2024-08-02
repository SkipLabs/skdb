// skehandle.h
#ifndef SKEHANDLE_H
#define SKEHANDLE_H

#include <node.h>
#include <node_object_wrap.h>

#include <string>

namespace skstore {

class EHandle : public node::ObjectWrap {
 public:
  explicit EHandle(const std::string& id);
  static void Init(v8::Local<v8::Object> exports);
  static v8::MaybeLocal<v8::Object> Create(v8::Isolate* isolate,
                                           v8::Local<v8::String> hdl);
  const char* getName();

 private:
  ~EHandle();

  static void CreateAndWrap(v8::Isolate*, v8::Local<v8::Value>,
                            v8::Local<v8::Object>);
  static void Prototype(v8::Local<v8::FunctionTemplate>);
  static void New(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Get(const v8::FunctionCallbackInfo<v8::Value>&);
  static void MaybeGet(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Size(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Map(const v8::FunctionCallbackInfo<v8::Value>&);
  static void MapReduce(const v8::FunctionCallbackInfo<v8::Value>&);
  static void MapTo(const v8::FunctionCallbackInfo<v8::Value>&);

  const std::string m_id;
};

}  // namespace skstore

#endif  // SKEHANDLE_H