// skwatcher.cc
#include "skwatcher.h"

#include "skcommon.h"
#include "skjson_utils.h"

#define SKOBSTACK void*

extern "C" {
SKOBSTACK SKIP_new_Obstack();
void SKIP_destroy_Obstack(SKOBSTACK obstack);
void SKIP_reactive_print_result(uint32_t);
void SKIP_delete_reactive_query(uint32_t);
}

namespace skstore {

using skbinding::CallGlobalStaticMethod;
using skbinding::FromUtf8;
using skbinding::ToSKString;
using v8::Array;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::External;
using v8::False;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Number;
using v8::Object;
using v8::ObjectTemplate;
using v8::Persistent;
using v8::String;
using v8::True;
using v8::Uint32;
using v8::Value;

static Persistent<Function> kSKWatches;

SKWatcher::SKWatcher()
    : m_ticks(),
      m_to_notify(),
      m_field_names(),
      m_object(),
      m_field(0),
      m_channel_0(),
      m_channel_1(),
      m_channel_2(),
      m_channel_3(),
      m_free_ids(),
      m_next_id(0),
      m_functions() {}

SKWatcher::~SKWatcher() {}

uint32_t SKWatcher::getLastTick(uint32_t qid) {
  auto pos = m_ticks.find(qid);
  if (pos == m_ticks.end()) {
    return 0;
  }
  return pos->second;
}

void SKWatcher::clearFieldNames() {
  m_field_names.clear();
}

void SKWatcher::pushFieldName(char* name) {
  m_field_names.push_back(name);
}

void SKWatcher::clearObject() {
  Isolate* isolate = Isolate::GetCurrent();
  m_object.Reset(isolate, Object::New(isolate));
  m_field = 0;
}

void SKWatcher::pushValue(Isolate* isolate, Local<Value> value) {
  Local<Context> context = isolate->GetCurrentContext();
  m_object.Get(isolate)
      ->Set(context, FromUtf8(isolate, m_field_names[m_field].c_str()), value)
      .FromJust();
  m_field++;
}

void SKWatcher::pushObjectFieldNull() {
  Isolate* isolate = Isolate::GetCurrent();
  pushValue(isolate, Null(isolate));
}

void SKWatcher::pushObjectFieldInt32(int32_t v) {
  Isolate* isolate = Isolate::GetCurrent();
  pushValue(isolate, Number::New(isolate, v));
}

void SKWatcher::pushObjectFieldInt64(char* v) {
  Isolate* isolate = Isolate::GetCurrent();
  pushValue(isolate, Number::New(isolate, atol(v)));
}

void SKWatcher::pushObjectFieldFloat(char* v) {
  Isolate* isolate = Isolate::GetCurrent();
  pushValue(isolate, Number::New(isolate, atof(v)));
}

void SKWatcher::pushObjectFieldString(char* v) {
  Isolate* isolate = Isolate::GetCurrent();
  pushValue(isolate, FromUtf8(isolate, v));
}

void SKWatcher::pushObjectFieldJSON(void* v) {
  Isolate* isolate = Isolate::GetCurrent();
  pushValue(isolate, skjson::SKStoreToNode(isolate, v, true));
}

void SKWatcher::pushObjectTo(Isolate* isolate, Persistent<Array>& channel) {
  Local<Context> context = isolate->GetCurrentContext();
  if (channel.IsEmpty()) {
    channel.Reset(isolate, Array::New(isolate));
  }
  Local<Array> array = channel.Get(isolate);
  array->Set(context, array->Length(), m_object.Get(isolate)).FromJust();
  m_object.Empty();
}

void SKWatcher::pushObject(uint32_t channel) {
  Isolate* isolate = Isolate::GetCurrent();
  switch (channel) {
    case 0:
      pushObjectTo(isolate, m_channel_0);
      break;
    case 1:
      pushObjectTo(isolate, m_channel_1);
      break;
    case 2:
      pushObjectTo(isolate, m_channel_2);
      break;
    case 3:
      pushObjectTo(isolate, m_channel_2);
      break;
    default:
      break;
  }
}

void SKWatcher::deleteFun(uint32_t qid) {
  m_ticks[qid] = 0;
  m_functions[qid].Empty();
  m_free_ids.push_back(qid);
}

void SKWatcher::markQuery(uint32_t qid) {
  m_to_notify.insert(qid);
}

void SKWatcher::notifyAll() {
  std::set<uint32_t> notified(m_to_notify);
  m_to_notify.clear();
  std::for_each(notified.begin(), notified.end(), [this](uint32_t const& id) {
    this->m_channel_0.Empty();
    this->m_channel_1.Empty();
    this->m_channel_2.Empty();
    this->m_channel_3.Empty();
    SKOBSTACK obstack = SKIP_new_Obstack();
    SKIP_reactive_print_result(id);
    SKIP_destroy_Obstack(obstack);
    Isolate* isolate = Isolate::GetCurrent();
    Local<Context> context = isolate->GetCurrentContext();
    Local<Function> userFun = this->m_functions[id].Get(isolate);
    Local<Number> jsId = Number::New(isolate, id);
    const unsigned argc = 2;
    Local<Value> argv[argc] = {jsId, False(isolate)};
    (void)userFun->Call(context, Null(isolate), argc, argv);
  });
}

void SKWatcher::Close(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<Array> data = args.Data().As<Array>();
  Local<External> watcher =
      data->Get(context, 0).ToLocalChecked().As<External>();
  uint32_t id = data->Get(context, 1).ToLocalChecked().As<Uint32>()->Value();
  ((SKWatcher*)watcher->Value())->m_functions[id].Empty();
  SKIP_delete_reactive_query(id);
}

Local<Object> SKWatcher::watch(
    Isolate* isolate, Local<String> query, Local<Object> params,
    std::function<void(uint32_t, char*, char*)> watchFn,
    Local<Function> userFn) {
  //
  uint32_t id = m_next_id;
  if (!m_free_ids.empty()) {
    id = m_free_ids.back();
    m_free_ids.pop_back();
  } else {
    m_next_id++;
  }
  m_ticks[id] = 0;
  m_channel_0.Empty();
  m_channel_1.Empty();
  m_channel_2.Empty();
  m_channel_3.Empty();

  Local<Context> context = isolate->GetCurrentContext();
  m_functions[id].Reset(isolate, userFn);
  kSKWatches.Reset(isolate, userFn);
  Local<Value> strParams = skbinding::JSONStringify(isolate, params);
  SKOBSTACK obstack = SKIP_new_Obstack();
  char* skquery = ToSKString(isolate, query);
  char* skparams = ToSKString(isolate, strParams);
  watchFn(id, skquery, skparams);
  SKIP_destroy_Obstack(obstack);
  Local<Number> jsId = Number::New(isolate, id);
  const unsigned argc = 2;
  Local<Value> argv[argc] = {jsId, True(isolate)};
  (void)userFn->Call(context, Null(isolate), argc, argv);
  Local<Array> cdata = Array::New(isolate);
  cdata->Set(context, 0, External::New(isolate, (void*)this)).FromJust();
  cdata->Set(context, 1, jsId).FromJust();
  Local<FunctionTemplate> ctpl = FunctionTemplate::New(isolate, Close, cdata);
  Local<Function> close = ctpl->GetFunction(context).ToLocalChecked();
  Local<Object> obj = Object::New(isolate);
  obj->Set(context, FromUtf8(isolate, "close"), close).FromJust();
  return obj;
}

void SKWatcher::checkUpdate(Isolate* isolate, Local<Function> onchange,
                            bool first) {
  if (!m_channel_0.IsEmpty()) {
    Local<Context> context = isolate->GetCurrentContext();
    Local<Value> argv[1] = {m_channel_0.Get(isolate)};
    (void)onchange->Call(context, Null(isolate), 1, argv);
    m_channel_0.Empty();
  } else if (first) {
    Local<Context> context = isolate->GetCurrentContext();
    Local<Value> argv[1] = {Array::New(isolate)};
    (void)onchange->Call(context, Null(isolate), 1, argv);
  }
}

MaybeLocal<Value> SKWatcher::getChannelValue(Isolate* isolate,
                                             uint32_t channel) {
  Local<Value> value;
  switch (channel) {
    case 0:
      value = m_channel_0.Get(isolate);
      m_channel_0.Empty();
      return MaybeLocal<Value>(value);
    case 1:
      value = m_channel_1.Get(isolate);
      m_channel_1.Empty();
      return MaybeLocal<Value>(value);
    case 2:
      value = m_channel_2.Get(isolate);
      m_channel_2.Empty();
      return MaybeLocal<Value>(value);
    case 3:
      value = m_channel_3.Get(isolate);
      m_channel_3.Empty();
      return MaybeLocal<Value>(value);
    default:
      return MaybeLocal<Value>();
  }
}

void SKWatcher::checkChanges(Isolate* isolate, uint32_t id, bool first,
                             Local<Function> init, Local<Function> update) {
  Local<Context> context = isolate->GetCurrentContext();
  if (!m_channel_1.IsEmpty() || !m_channel_2.IsEmpty()) {
    Local<Array> added =
        !m_channel_1.IsEmpty() ? m_channel_1.Get(isolate) : Array::New(isolate);
    Local<Array> removed =
        !m_channel_2.IsEmpty() ? m_channel_2.Get(isolate) : Array::New(isolate);
    const unsigned argc = 2;
    Local<Value> argv[argc] = {added, removed};
    (void)update->Call(context, Null(isolate), argc, argv);
    m_channel_1.Empty();
    m_channel_2.Empty();
  } else if (!m_channel_0.IsEmpty() || first) {
    Local<Array> values =
        !m_channel_0.IsEmpty() ? m_channel_0.Get(isolate) : Array::New(isolate);
    Local<Value> argv[1] = {values};
    (void)init->Call(context, Null(isolate), 1, argv);
    m_channel_0.Empty();
  };
  if (!m_channel_3.IsEmpty()) {
    Local<Object> withtick = m_channel_3.Get(isolate)
                                 ->Get(context, 0)
                                 .ToLocalChecked()
                                 ->ToObject(context)
                                 .ToLocalChecked();
    Local<Number> tick = withtick->Get(context, FromUtf8(isolate, "tick"))
                             .ToLocalChecked()
                             .As<Number>();
    m_ticks[id] = (uint32_t)tick->Value();
    m_channel_3.Empty();
  }
}

}  // namespace skstore