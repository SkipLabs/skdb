// sktable.h
#ifndef SKTABLE_H
#define SKTABLE_H

#include <node.h>
#include <node_object_wrap.h>

#include <string>

#include "skwatcher.h"

namespace skstore {

class Table : public node::ObjectWrap {
 public:
  explicit Table(const std::string&, const std::string&, SKWatcher*);
  static void Init(v8::Local<v8::Object>);
  static v8::MaybeLocal<v8::Object> Create(v8::Isolate*, v8::Local<v8::String>,
                                           v8::Local<v8::String>,
                                           v8::Local<v8::External>);

 private:
  ~Table();

  static void CreateAndWrap(v8::Isolate*, v8::Local<v8::Value>,
                            v8::Local<v8::Value>, v8::Local<v8::Value>,
                            v8::Local<v8::Object>);
  static void Prototype(v8::Local<v8::FunctionTemplate>);
  static void New(const v8::FunctionCallbackInfo<v8::Value>&);
  //
  static void Insert(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Update(const v8::FunctionCallbackInfo<v8::Value>&);
  static void UpdateWhere(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Select(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Delete(const v8::FunctionCallbackInfo<v8::Value>&);
  static void DeleteWhere(const v8::FunctionCallbackInfo<v8::Value>&);
  static void Watch(const v8::FunctionCallbackInfo<v8::Value>&);
  static void WatchChanges(const v8::FunctionCallbackInfo<v8::Value>&);
  static void GetName(const v8::FunctionCallbackInfo<v8::Value>&);

  const std::string m_table;
  const std::string m_columns;
  SKWatcher* m_watcher;
};

}  // namespace skstore

#endif  // SKTHANDLE_H