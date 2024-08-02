#ifndef SKSTORE_WATCHER_H
#define SKSTORE_WATCHER_H

#include <node.h>

#include <map>
#include <set>
#include <vector>

#include "../../../../sql/extern/src/Watcher.h"

namespace skstore {

class SKWatcher : public skdb::Watcher {
 public:
  SKWatcher();
  virtual ~SKWatcher();
  uint32_t getLastTick(uint32_t);
  void clearFieldNames();
  void pushFieldName(char*);
  void clearObject();
  void pushObjectFieldNull();
  void pushObjectFieldInt32(int32_t);
  void pushObjectFieldInt64(char*);
  void pushObjectFieldFloat(char*);
  void pushObjectFieldString(char*);
  void pushObjectFieldJSON(void*);
  void pushObject(uint32_t);
  void deleteFun(uint32_t);
  void markQuery(uint32_t);
  v8::MaybeLocal<v8::Value> getChannelValue(v8::Isolate*, uint32_t);
  void notifyAll();
  v8::Local<v8::Object> watch(v8::Isolate*, v8::Local<v8::String>,
                              v8::Local<v8::Object>,
                              std::function<void(uint32_t, char*, char*)>,
                              v8::Local<v8::Function>);
  void checkUpdate(v8::Isolate*, v8::Local<v8::Function>, bool);
  void checkChanges(v8::Isolate*, uint32_t, bool, v8::Local<v8::Function>,
                    v8::Local<v8::Function>);

 private:
  std::map<uint32_t, uint32_t> m_ticks;
  std::set<uint32_t> m_to_notify;
  std::vector<std::string> m_field_names;
  v8::Persistent<v8::Object> m_object;
  size_t m_field;
  v8::Persistent<v8::Array> m_channel_0;
  v8::Persistent<v8::Array> m_channel_1;
  v8::Persistent<v8::Array> m_channel_2;
  v8::Persistent<v8::Array> m_channel_3;
  std::vector<uint32_t> m_free_ids;
  size_t m_next_id;
  std::map<uint32_t, v8::Persistent<v8::Function>> m_functions;

  void pushValue(v8::Isolate*, v8::Local<v8::Value>);
  void pushObjectTo(v8::Isolate*, v8::Persistent<v8::Array>&);
  static void Close(const v8::FunctionCallbackInfo<v8::Value>&);
};

}  // namespace skstore

#endif  // SKSTORE_WATCHER_H