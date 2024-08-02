#include <stdint.h>

#include <iostream>

#include "Watcher.h"

namespace skdb {

thread_local static Watcher* watcher = nullptr;
thread_local static bool initialized = false;

Watcher* setWatcher(Watcher* w) {
  Watcher* current = initialized ? watcher : nullptr;
  watcher = w;
  initialized = w != nullptr;
  return current;
}

void print(const char* prefix) {
  std::cout << prefix << ": " << watcher << std::endl;
}

}  // namespace skdb

extern "C" {
/*****************************************************************************/
/* Primitives used to output js objects directly, doesn't do anything
 * in native mode.
 */
/*****************************************************************************/

uint32_t SKIP_last_tick(uint32_t qid) {
  if (skdb::initialized) {
    return skdb::watcher->getLastTick(qid);
  }
  return 0;
}

void SKIP_clear_field_names() {
  if (skdb::initialized) {
    skdb::watcher->clearFieldNames();
  }
}

void SKIP_push_field_name(char* field) {
  if (skdb::initialized) {
    skdb::watcher->pushFieldName(field);
  }
}

void SKIP_clear_object() {
  if (skdb::initialized) {
    skdb::watcher->clearObject();
  }
}

void SKIP_push_object_field_null() {
  if (skdb::initialized) {
    skdb::watcher->pushObjectFieldNull();
  }
}

void SKIP_push_object_field_int32(int32_t v) {
  if (skdb::initialized) {
    skdb::watcher->pushObjectFieldInt32(v);
  }
}

void SKIP_push_object_field_int64(char* v) {
  if (skdb::initialized) {
    skdb::watcher->pushObjectFieldInt64(v);
  }
}

void SKIP_push_object_field_float(char* v) {
  if (skdb::initialized) {
    skdb::watcher->pushObjectFieldFloat(v);
  }
}

void SKIP_push_object_field_string(char* v) {
  if (skdb::initialized) {
    skdb::watcher->pushObjectFieldString(v);
  }
}

void SKIP_push_object_field_json(void* v) {
  if (skdb::initialized) {
    skdb::watcher->pushObjectFieldJSON(v);
  }
}

void SKIP_push_object(uint32_t channel) {
  if (skdb::initialized) {
    skdb::watcher->pushObject(channel);
  }
}

void SKIP_js_delete_fun(int32_t qid) {
  if (skdb::initialized) {
    skdb::watcher->deleteFun(qid);
  }
}

void SKIP_js_mark_query(int32_t qid) {
  if (skdb::initialized) {
    skdb::watcher->markQuery(qid);
  }
}

void SKIP_js_notify_all() {
  if (skdb::initialized) {
    skdb::watcher->notifyAll();
  }
}

}  // extern "C"