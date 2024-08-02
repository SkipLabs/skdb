#ifndef SK_WATCHER_H
#define SK_WATCHER_H

namespace skdb {

class Watcher {
 public:
  virtual uint32_t getLastTick(uint32_t) = 0;
  virtual void clearFieldNames() = 0;
  virtual void pushFieldName(char*) = 0;
  virtual void clearObject() = 0;
  virtual void pushObjectFieldNull() = 0;
  virtual void pushObjectFieldInt32(int32_t) = 0;
  virtual void pushObjectFieldInt64(char*) = 0;
  virtual void pushObjectFieldFloat(char*) = 0;
  virtual void pushObjectFieldString(char*) = 0;
  virtual void pushObjectFieldJSON(void*) = 0;
  virtual void pushObject(uint32_t) = 0;
  virtual void deleteFun(uint32_t) = 0;
  virtual void markQuery(uint32_t) = 0;
  virtual void notifyAll() = 0;
};

Watcher* setWatcher(Watcher* watcher);
void print(const char* prefix);

}  // namespace skdb

#endif  // SK_WATCHER_H