// sktable.cc
#include "sktable.h"

#include <sstream>

#include "skcommon.h"
#include "skjson_utils.h"

#define CJSON void*
#define CJArray void*
#define CJObject void*
#define SKOBSTACK void*
#define SKCONTEXT void*

extern "C" {
double SKIP_SKStore_insert(char* name, CJArray entries, uint32_t update);
double SKIP_SKStore_update(char* name, char* columns, CJArray entry,
                           CJObject updates);
double SKIP_SKStore_updateWhere(char* name, CJObject where, CJObject updates);
double SKIP_SKStore_select(char* name, CJObject select, CJArray columns);
double SKIP_SKStore_delete(char* name, char* columns, CJArray entry);
double SKIP_SKStore_deleteWhere(char* name, CJObject where);
//
char* sk_string_create(const char* buffer, uint32_t size);
SKOBSTACK SKIP_new_Obstack();
void SKIP_destroy_Obstack(SKOBSTACK obstack);
void SKIP_reactive_query(int32_t, char*, char*);
void SKIP_reactive_query_changes(int32_t, char*, char*);
}  // extern "C"

namespace skstore {

using skbinding::CallGlobalStaticMethod;
using skbinding::CheckResult;
using skbinding::FromUtf8;
using skbinding::GetContext;
using skbinding::GetHandle;
using skbinding::InitClass;
using skbinding::Metadata;
using skbinding::RestoreContext;
using skbinding::SwitchContext;
using v8::Array;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::External;
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
using v8::Uint32;
using v8::Value;

static Persistent<Function> kTableConstructor;

Table::Table(const std::string& table, const std::string& columns,
             SKWatcher* watcher)
    : m_table(table), m_columns(columns), m_watcher(watcher) {}

Table::~Table() {}

void Table::Prototype(Local<FunctionTemplate> tpl) {
  NODE_SET_PROTOTYPE_METHOD(tpl, "insert", Insert);
  NODE_SET_PROTOTYPE_METHOD(tpl, "update", Update);
  NODE_SET_PROTOTYPE_METHOD(tpl, "updateWhere", UpdateWhere);
  NODE_SET_PROTOTYPE_METHOD(tpl, "select", Select);
  NODE_SET_PROTOTYPE_METHOD(tpl, "delete", Delete);
  NODE_SET_PROTOTYPE_METHOD(tpl, "deleteWhere", DeleteWhere);
  NODE_SET_PROTOTYPE_METHOD(tpl, "watch", Watch);
  NODE_SET_PROTOTYPE_METHOD(tpl, "watchChanges", WatchChanges);
  NODE_SET_PROTOTYPE_METHOD(tpl, "getName", GetName);
}

void Table::Init(Local<Object> exports) {
  InitClass(exports, "Table", New, Prototype, &kTableConstructor);
}

void Table::CreateAndWrap(Isolate* isolate, Local<Value> nameValue,
                          Local<Value> columnsValue, Local<Value> watcherValue,
                          Local<Object> toWrap) {
  v8::String::Utf8Value table(isolate, nameValue);
  std::string strTable(*table);
  v8::String::Utf8Value columns(isolate, columnsValue);
  std::string strColumns(*columns);
  SKWatcher* watcher = (SKWatcher*)watcherValue.As<External>()->Value();
  Table* obj = new Table(strTable, strColumns, watcher);
  obj->Wrap(toWrap);
}

void Table::New(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() != 3) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameters.")));
    return;
  };
  if (!args[0]->IsString() || !args[1]->IsString() || !args[2]->IsExternal()) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid parameter type.")));
    return;
  }
  if (args.IsConstructCall()) {
    // Invoked as constructor: `new Class(...)`
    CreateAndWrap(isolate, args[0], args[1], args[2], args.This());
    args.GetReturnValue().Set(args.This());
  } else {
    // Invoked as plain function `Class(...)`, turn into construct call.
    const int argc = 3;
    Local<Value> argv[argc] = {args[0], args[1], args[3]};
    Local<Function> cons = args.Data()
                               .As<Object>()
                               ->GetInternalField(0)
                               .As<Value>()
                               .As<Function>();
    Local<Object> result =
        cons->NewInstance(context, argc, argv).ToLocalChecked();
    args.GetReturnValue().Set(result);
  }
}

MaybeLocal<Object> Table::Create(Isolate* isolate, Local<String> table,
                                 Local<String> columns,
                                 Local<External> watcher) {
  Local<Context> context = isolate->GetCurrentContext();
  const int argc = 3;
  Local<Value> argv[argc] = {table, columns, watcher};
  Local<Function> constructor = kTableConstructor.Get(isolate);
  return constructor->NewInstance(context, argc, argv);
}

void Table::Insert(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx != nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called inside of a SKStore function.")));
    return;
  }
  if (args.Length() < 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "Must have at least one parameter.")));
    return;
  };
  if (!args[0]->IsArray()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The first parameter must be an array.")));
    return;
  };
  bool update = false;
  if (args.Length() >= 1) {
    if (args[1]->IsBoolean()) {
      update = args[1].As<Boolean>()->Value();
    } else if (!args[1]->IsNullOrUndefined()) {
      update = true;
    }
  }
  Local<Array> entries = args[0].As<Array>();
  SKOBSTACK obstack = SKIP_new_Obstack();
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  CJArray skArray = skjson::NodeToSKStore(isolate, entries);
  char* sktable =
      sk_string_create(table->m_table.c_str(), table->m_table.size());
  int result = (int)SKIP_SKStore_insert(sktable, skArray, update ? 1 : 0);
  SKIP_destroy_Obstack(obstack);
  CheckResult(isolate, result, "Unable to perform insert.");
}

void Table::Update(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx != nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called inside of a SKStore function.")));
    return;
  }
  if (args.Length() != 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameters.")));
    return;
  };
  if (!args[0]->IsArray()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The first parameter must be an array.")));
    return;
  };
  if (!args[1]->IsObject()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The second parameter must be an object.")));
    return;
  };
  SKOBSTACK obstack = SKIP_new_Obstack();
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  CJArray skentry = skjson::NodeToSKStore(isolate, args[0]);
  CJObject skupdates = skjson::NodeToSKStore(isolate, args[1]);
  char* sktable =
      sk_string_create(table->m_table.c_str(), table->m_table.size());
  char* skcolumns =
      sk_string_create(table->m_columns.c_str(), table->m_columns.size());
  int result = (int)SKIP_SKStore_update(sktable, skcolumns, skentry, skupdates);
  SKIP_destroy_Obstack(obstack);
  CheckResult(isolate, result, "Unable to perform update.");
}

void Table::UpdateWhere(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx != nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called inside of a SKStore function.")));
    return;
  }
  if (args.Length() != 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameters.")));
    return;
  };
  if (!args[0]->IsObject()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The first parameter must be an object.")));
    return;
  };
  if (!args[1]->IsObject()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The second parameter must be an object.")));
    return;
  };
  SKOBSTACK obstack = SKIP_new_Obstack();
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  CJObject skwhere = skjson::NodeToSKStore(isolate, args[0]);
  CJObject skupdates = skjson::NodeToSKStore(isolate, args[1]);
  char* sktable =
      sk_string_create(table->m_table.c_str(), table->m_table.size());
  int result = (int)SKIP_SKStore_updateWhere(sktable, skwhere, skupdates);
  SKIP_destroy_Obstack(obstack);
  CheckResult(isolate, result, "Unable to perform update.");
}

void Table::Select(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx != nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called inside of a SKStore function.")));
    return;
  }
  if (args.Length() < 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "Must have at least parameter.")));
    return;
  };
  if (!args[0]->IsObject()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The first parameter must be an object.")));
    return;
  };
  if (args.Length() > 1 && !(args[1]->IsArray() || args[1]->IsUndefined())) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The second parameter must be an array.")));
    return;
  };
  SKOBSTACK obstack = SKIP_new_Obstack();
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  CJObject skwhere = skjson::NodeToSKStore(isolate, args[0]);
  CJObject skcolumns = skjson::NodeToSKStore(
      isolate, (args.Length() > 0 && !args[1]->IsUndefined())
                   ? args[1].As<Array>()
                   : Array::New(isolate));
  char* sktable =
      sk_string_create(table->m_table.c_str(), table->m_table.size());
  int result = (int)SKIP_SKStore_select(sktable, skwhere, skcolumns);
  SKIP_destroy_Obstack(obstack);
  if (CheckResult(isolate, result, "Unable to perform select.")) {
    MaybeLocal<Value> v = table->m_watcher->getChannelValue(isolate, 0);
    if (!v.IsEmpty()) {
      args.GetReturnValue().Set(v.ToLocalChecked());
    } else {
      args.GetReturnValue().Set(Array::New(isolate));
    }
  }
}

void Table::Delete(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx != nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called inside of a SKStore function.")));
    return;
  }
  if (args.Length() != 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter.")));
    return;
  };
  if (!args[0]->IsArray()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The parameter must be an array.")));
    return;
  };
  SKOBSTACK obstack = SKIP_new_Obstack();
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  CJArray skentry = skjson::NodeToSKStore(isolate, args[0]);
  char* sktable =
      sk_string_create(table->m_table.c_str(), table->m_table.size());
  char* skcolumns =
      sk_string_create(table->m_columns.c_str(), table->m_columns.size());
  int result = (int)SKIP_SKStore_delete(sktable, skcolumns, skentry);
  SKIP_destroy_Obstack(obstack);
  CheckResult(isolate, result, "Unable to perform delete.");
}

void Table::DeleteWhere(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx != nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called inside of a SKStore function.")));
    return;
  }
  if (args.Length() != 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter.")));
    return;
  };
  if (!args[0]->IsObject()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(
        FromUtf8(isolate, "The parameter must be an object.")));
    return;
  };
  SKOBSTACK obstack = SKIP_new_Obstack();
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  CJObject skwhere = skjson::NodeToSKStore(isolate, args[0]);
  char* sktable =
      sk_string_create(table->m_table.c_str(), table->m_table.size());
  int result = (int)SKIP_SKStore_deleteWhere(sktable, skwhere);
  SKIP_destroy_Obstack(obstack);
  CheckResult(isolate, result, "Unable to perform delete.");
}

void CheckUpdate(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Array> data = args.Data().As<Array>();
  Local<External> watcher =
      data->Get(context, 0).ToLocalChecked().As<External>();
  Local<Function> onChange =
      data->Get(context, 1).ToLocalChecked().As<Function>();
  bool first = args[1].As<Boolean>()->Value();
  ((SKWatcher*)watcher->Value())->checkUpdate(isolate, onChange, first);
}

void CheckChanges(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() != 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameter.")));
    return;
  };
  if (!args[0]->IsUint32() || !args[1]->IsBoolean()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid parameter types.")));
    return;
  };
  uint32_t id = args[0].As<Uint32>()->Value();
  bool first = args[1].As<Boolean>()->Value();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Array> data = args.Data().As<Array>();
  Local<External> watcher =
      data->Get(context, 0).ToLocalChecked().As<External>();
  Local<Function> init = data->Get(context, 1).ToLocalChecked().As<Function>();
  Local<Function> update =
      data->Get(context, 2).ToLocalChecked().As<Function>();
  ((SKWatcher*)watcher->Value())
      ->checkChanges(isolate, id, first, init, update);
}

void Table::Watch(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx != nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called inside of a SKStore function.")));
    return;
  };
  if (args.Length() != 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter.")));
    return;
  };
  if (!args[0]->IsFunction()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid parameter types.")));
    return;
  };
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  Local<Context> context = isolate->GetCurrentContext();
  std::stringstream strquery;
  strquery << "SELECT * FROM " << table->m_table << ";";
  Local<String> query = FromUtf8(isolate, strquery.str().c_str());
  Local<Object> params = Object::New(isolate);
  Local<Function> onChange = args[0].As<Function>();
  Local<Array> data = Array::New(isolate);
  data->Set(context, 0, External::New(isolate, (void*)table->m_watcher))
      .FromJust();
  data->Set(context, 1, onChange).FromJust();

  Local<FunctionTemplate> tpl =
      FunctionTemplate::New(isolate, CheckUpdate, data);
  Local<Function> fn = tpl->GetFunction(context).ToLocalChecked();
  Local<Object> closable =
      table->m_watcher->watch(isolate, query, params, SKIP_reactive_query, fn);
  args.GetReturnValue().Set(closable);
}

void Table::WatchChanges(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  SKCONTEXT ctx = GetContext();
  if (ctx != nullptr) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(Exception::TypeError(FromUtf8(
        isolate, "Get cannot be called inside of a SKStore function.")));
    return;
  };
  if (args.Length() != 2) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have two parameters.")));
    return;
  };
  if (!args[0]->IsFunction() || !args[1]->IsFunction()) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid parameter types.")));
    return;
  };
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  Local<Context> context = isolate->GetCurrentContext();
  std::stringstream strquery;
  strquery << "SELECT * FROM " << table->m_table << ";";
  Local<String> query = FromUtf8(isolate, strquery.str().c_str());
  Local<Object> params = Object::New(isolate);
  Local<Function> init = args[0].As<Function>();
  Local<Function> update = args[1].As<Function>();

  Local<Array> data = Array::New(isolate);
  data->Set(context, 0, External::New(isolate, (void*)table->m_watcher))
      .FromJust();
  data->Set(context, 1, init).FromJust();
  data->Set(context, 2, update).FromJust();

  Local<FunctionTemplate> tpl =
      FunctionTemplate::New(isolate, CheckChanges, data);
  Local<Function> fn = tpl->GetFunction(context).ToLocalChecked();
  Local<Object> closable = table->m_watcher->watch(
      isolate, query, params, SKIP_reactive_query_changes, fn);
  args.GetReturnValue().Set(closable);
}

void Table::GetName(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Table* table = ObjectWrap::Unwrap<Table>(args.Holder());
  args.GetReturnValue().Set(FromUtf8(isolate, table->m_table.c_str()));
}

}  // namespace skstore