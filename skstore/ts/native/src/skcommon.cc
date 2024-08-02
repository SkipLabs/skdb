
#include "skcommon.h"

#include <functional>
#include <iostream>
#include <regex>

#define SKCONTEXT void*

namespace skbinding {

using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionCallback;
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
using v8::TryCatch;
using v8::Value;

#define SKERROR void*

extern "C" {
char* sk_get_exception_type(SKERROR skExn);
char* sk_get_exception_message(SKERROR skExn);
void sk_string_check_c_safe(char* str);
char* SKIP_SKStore_getExceptionStack(SKERROR error);
}

Local<String> FromUtf8(Isolate* isolate, const char* str) {
  return String::NewFromUtf8(isolate, str).ToLocalChecked();
}

void AddFunction(Isolate* isolate, Local<Object> handler, const char* name,
                 FunctionCallback callback) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<FunctionTemplate> v8Tpl = FunctionTemplate::New(isolate, callback);
  Local<Function> v8Fn = v8Tpl->GetFunction(context).ToLocalChecked();
  handler->Set(context, FromUtf8(isolate, name), v8Fn).FromJust();
}

void Metadata(Isolate* isolate, std::string& script, int& line, int& column) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<Value> exc = Exception::Error(FromUtf8(isolate, ""));
  Local<Object> error = exc->ToObject(context).ToLocalChecked();
  Local<Value> stack =
      error->Get(context, FromUtf8(isolate, "stack")).ToLocalChecked();
  String::Utf8Value jsStack(isolate, stack);
  const char* strStack = *jsStack;
  std::stringstream ss(strStack);
  std::string to;
  while (std::getline(ss, to, '\n')) {
    std::smatch sm;
    if (std::regex_match(to, sm,
                         std::regex("[^(]+\\((.+):([0-9]+):([0-9]+)\\)$"))) {
      script = sm[1];
      line = atoi(sm[2].str().c_str());
      column = atoi(sm[3].str().c_str());
      break;
    }
  }
}

void NewClass(
    const FunctionCallbackInfo<Value>& args,
    std::function<bool(Local<Value>)> check,
    std::function<void(Isolate*, Local<Value>, Local<Object>)> create) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() != 1) {
    // Throw an Error that is passed back to JavaScript
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Must have one parameter.")));
    return;
  };
  if (!check(args[0])) {
    isolate->ThrowException(
        Exception::TypeError(FromUtf8(isolate, "Invalid parameter type.")));
    return;
  }
  if (args.IsConstructCall()) {
    // Invoked as constructor: `new Class(...)`
    create(isolate, args[0], args.This());
    args.GetReturnValue().Set(args.This());
  } else {
    // Invoked as plain function `Class(...)`, turn into construct call.
    const int argc = 1;
    Local<Value> argv[argc] = {args[0]};
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

void InitClass(Local<Object> exports, const char* name,
               FunctionCallback newCallback,
               std::function<void(Local<FunctionTemplate>)> prototype,
               Persistent<Function>* persistent) {
  Isolate* isolate = exports->GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<ObjectTemplate> addon_data_tpl = ObjectTemplate::New(isolate);
  addon_data_tpl->SetInternalFieldCount(1);  // 1
  Local<Object> addon_data =
      addon_data_tpl->NewInstance(context).ToLocalChecked();

  // Prepare constructor template
  Local<FunctionTemplate> tpl =
      FunctionTemplate::New(isolate, newCallback, addon_data);
  tpl->SetClassName(FromUtf8(isolate, name));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // Prototype
  prototype(tpl);

  Local<Function> constructor = tpl->GetFunction(context).ToLocalChecked();
  if (persistent != nullptr) {
    persistent->Reset(isolate, constructor);
  }
  addon_data->SetInternalField(0, constructor);
  exports->Set(context, FromUtf8(isolate, name), constructor).FromJust();
}

Local<Value> CallGlobalStaticMethod(Isolate* isolate, const char* className,
                                    const char* methodName, int argc,
                                    Local<Value> argv[]) {
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> global = context->Global();
  Local<Object> classRef = global->Get(context, FromUtf8(isolate, className))
                               .ToLocalChecked()
                               .As<Object>();
  Local<Function> method = classRef->Get(context, FromUtf8(isolate, methodName))
                               .ToLocalChecked()
                               .As<Function>();
  return method->Call(context, classRef, argc, argv).ToLocalChecked();
}

static SKCONTEXT skContext;
static std::map<uint32_t, Persistent<Value>> kHandles;
static uint32_t kNextHandle = 1;

uint32_t CreateHandle(Isolate* isolate, Local<Value> value) {
  uint32_t handle = kNextHandle++;
  kHandles[handle].Reset(isolate, value);
  return handle;
}

void* SwitchContext(SKCONTEXT ctx) {
  SKCONTEXT current = skContext;
  skContext = ctx;
  return current;
}

void RestoreContext(SKCONTEXT ctx) {
  skContext = ctx;
}

void* GetContext() {
  return skContext;
}

bool GetHandle(Isolate* isolate, uint32_t id, Local<Value>& value) {
  auto pos = kHandles.find(id);
  if (pos == kHandles.end()) {
    return false;
  }
  value = pos->second.Get(isolate);
  return true;
}

bool DeleteHandle(Isolate* isolate, uint32_t id, Local<Value>& value) {
  if (GetHandle(isolate, id, value)) {
    kHandles.erase(id);
    return true;
  }
  return false;
}

bool CheckResult(Isolate* isolate, int result, const char* msg) {
  if (result < 0) {
    Local<Context> context = isolate->GetCurrentContext();
    Local<Value> error_;
    if (DeleteHandle(isolate, (uint32_t)(-result), error_) &&
        error_->IsObject()) {
      Local<Object> errorObj = error_.As<Object>();
      Local<Value> message =
          errorObj->Get(context, FromUtf8(isolate, "message")).ToLocalChecked();
      Local<Value> stack =
          errorObj->Get(context, FromUtf8(isolate, "stack")).ToLocalChecked();
      Local<Value> error = Exception::Error(message.As<String>());
      if (error->IsNativeError()) {
        Local<Object> exc = error.As<Object>();
        exc->Set(context, FromUtf8(isolate, "stack"), stack).FromJust();
      }
      isolate->ThrowException(error);
      return false;
    } else {
      isolate->ThrowException(Exception::Error(FromUtf8(isolate, msg)));
      return false;
    }
  }
  return true;
}

void Print(Isolate* isolate, const char* prefix, Local<Value> value) {
  v8::String::Utf8Value jsValue(isolate, value);
  const char* val = *jsValue;
  std::cout << prefix << ": " << val << std::endl;
}

Local<Value> JSONStringify(Isolate* isolate, Local<Value> value) {
  Local<Value> argv[1] = {value};
  return CallGlobalStaticMethod(isolate, "JSON", "stringify", 1, argv);
}

extern "C" {
void SKIP_SKStore_throwExternalException(char*, char*, char*);

char* sk_string_create(const char* buffer, uint32_t size);
}

void* SKTryCatch(Isolate* isolate, Local<Function> fn, Local<Value> recv,
                 int argc, Local<Value> argv[],
                 std::function<void*(Isolate*, Local<Value>)> success,
                 std::function<void(Isolate*)> failure) {
  Local<Context> context = isolate->GetCurrentContext();
  TryCatch tryCatch(isolate);
  MaybeLocal<Value> optResult = fn->Call(context, Null(isolate), argc, argv);
  if (!tryCatch.HasCaught()) {
    return success(isolate, optResult.ToLocalChecked());
  } else {
    failure(isolate);
    Local<Value> exception = tryCatch.Exception();
    if (exception->IsNativeError()) {
      Local<Context> context = isolate->GetCurrentContext();
      Local<Object> jsObj = exception->ToObject(context).ToLocalChecked();
      char* sktype = ToSKString(isolate, jsObj->GetConstructorName());
      char* skmessage = ToSKString(
          isolate,
          jsObj->Get(context, FromUtf8(isolate, "message")).ToLocalChecked());
      char* skstack = ToSKString(
          isolate,
          jsObj->Get(context, FromUtf8(isolate, "stack")).ToLocalChecked());
      SKIP_SKStore_throwExternalException(sktype, skmessage, skstack);
      return nullptr;
    } else if (exception->IsObject()) {
      MaybeLocal<Value> message =
          exception.As<Object>()->Get(context, FromUtf8(isolate, "message"));
      char* skempty = sk_string_create("", 0);
      char* skmessage;
      if (!message.IsEmpty()) {
        skmessage = ToSKString(isolate, message.ToLocalChecked());
      } else {
        Local<Value> jsmessage = JSONStringify(isolate, exception);
        skmessage = ToSKString(isolate, jsmessage);
      }
      SKIP_SKStore_throwExternalException(skempty, skmessage, skempty);
    } else if (exception->IsString()) {
      char* skempty = sk_string_create("", 0);
      char* skmessage = ToSKString(isolate, exception);
      SKIP_SKStore_throwExternalException(skempty, skmessage, skempty);
    } else {
      char* skempty = sk_string_create("", 0);
      Local<Value> jsmessage = JSONStringify(isolate, exception);
      char* skmessage = ToSKString(isolate, jsmessage);
      SKIP_SKStore_throwExternalException(skempty, skmessage, skempty);
    }
    return nullptr;
  }
}

void SKTryCatchVoid(Isolate* isolate, Local<Function> fn, Local<Value> recv,
                    int argc, Local<Value> argv[],
                    std::function<void(Isolate*)> success,
                    std::function<void(Isolate*)> failure) {
  Local<Context> context = isolate->GetCurrentContext();
  TryCatch tryCatch(isolate);
  (void)fn->Call(context, Null(isolate), argc, argv);
  if (!tryCatch.HasCaught()) {
    success(isolate);
  } else {
    failure(isolate);
    Local<Value> exception = tryCatch.Exception();
    if (exception->IsNativeError()) {
      Local<Context> context = isolate->GetCurrentContext();
      Local<Object> jsObj = exception->ToObject(context).ToLocalChecked();
      char* sktype = ToSKString(isolate, jsObj->GetConstructorName());
      char* skmessage = ToSKString(
          isolate,
          jsObj->Get(context, FromUtf8(isolate, "message")).ToLocalChecked());
      char* skstack = ToSKString(
          isolate,
          jsObj->Get(context, FromUtf8(isolate, "stack")).ToLocalChecked());
      SKIP_SKStore_throwExternalException(sktype, skmessage, skstack);
    } else if (exception->IsObject()) {
      MaybeLocal<Value> message =
          exception.As<Object>()->Get(context, FromUtf8(isolate, "message"));
      char* skempty = sk_string_create("", 0);
      char* skmessage;
      if (!message.IsEmpty()) {
        skmessage = ToSKString(isolate, message.ToLocalChecked());
      } else {
        Local<Value> jsmessage = JSONStringify(isolate, exception);
        skmessage = ToSKString(isolate, jsmessage);
      }
      SKIP_SKStore_throwExternalException(skempty, skmessage, skempty);
    } else if (exception->IsString()) {
      char* skempty = sk_string_create("", 0);
      char* skmessage = ToSKString(isolate, exception);
      SKIP_SKStore_throwExternalException(skempty, skmessage, skempty);
    } else {
      char* skempty = sk_string_create("", 0);
      Local<Value> jsmessage = JSONStringify(isolate, exception);
      char* skmessage = ToSKString(isolate, jsmessage);
      SKIP_SKStore_throwExternalException(skempty, skmessage, skempty);
    }
  }
}

void NatTryCatch(Isolate* isolate, std::function<void(Isolate*)> run) {
  try {
    run(isolate);
  } catch (skbinding::SkipException& e) {
    std::ostringstream error;
    error << e.name() << ": " << e.what();
    Local<Value> v8Error =
        Exception::Error(FromUtf8(isolate, error.str().c_str()));
    if (v8Error->IsNativeError()) {
      char* stack = SKIP_SKStore_getExceptionStack(e.m_skipException);
      if (strlen(stack) > 0) {
        Local<Context> context = isolate->GetCurrentContext();
        Local<Object> exc = v8Error.As<Object>();
        exc->Set(context, FromUtf8(isolate, "stack"), FromUtf8(isolate, stack))
            .FromJust();
      }
    }
    isolate->ThrowException(v8Error);
  } catch (std::exception& e) {
    const char* what = e.what();
    isolate->ThrowException(Exception::Error(FromUtf8(isolate, what)));
  }
}

char* ToSKString(Isolate* isolate, Local<Value> value) {
  String::Utf8Value jsValue(isolate, value);
  const char* strValue = *jsValue;
  return sk_string_create(strValue, strlen(strValue));
}

const char* SkipException::what() const noexcept {
  char* str = (char*)sk_get_exception_message(m_skipException);
  sk_string_check_c_safe(str);
  return str;
}

const char* SkipException::name() const noexcept {
  char* str = (char*)sk_get_exception_type(m_skipException);
  sk_string_check_c_safe(str);
  return str;
}

extern "C" {
void SKIP_SKStore_detachHandle(uint32_t handleId) {
  kHandles.erase(handleId);
}
}

}  // namespace skbinding
