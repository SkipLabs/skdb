// skjhandle.h
#ifndef SKLHANDLE_H
#define SKLHANDLE_H

#include <node.h>
#include <node_object_wrap.h>

#include <string>

namespace skstore {

class LHandle : public node::ObjectWrap {
 public:
  explicit LHandle(const std::string& id);
  static void Init(v8::Local<v8::Object> exports);
  static v8::Local<v8::Value> Create(v8::Isolate* isolate,
                                     v8::Local<v8::String> hdl);

 private:
  ~LHandle();

  static void CreateAndWrap(v8::Isolate*, v8::Local<v8::Value>,
                            v8::Local<v8::Object>);
  static void Prototype(v8::Local<v8::FunctionTemplate>);
  static void New(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Get(const v8::FunctionCallbackInfo<v8::Value>&);

  const std::string m_id;
};

class LSelf : public node::ObjectWrap {
 public:
  explicit LSelf(void* hdl);
  static void Init(v8::Local<v8::Object> exports);
  static v8::Local<v8::Value> Create(v8::Isolate* isolate,
                                     v8::Local<v8::External> external);

 private:
  ~LSelf();

  static void CreateAndWrap(v8::Isolate*, v8::Local<v8::Value>,
                            v8::Local<v8::Object>);
  static void Prototype(v8::Local<v8::FunctionTemplate>);
  static void New(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Get(const v8::FunctionCallbackInfo<v8::Value>&);

  const void* m_hdl;
};

}  // namespace skstore

#endif  // SKLHANDLE_H