// skcommon.h
#ifndef SKCOMMON_H
#define SKCOMMON_H

#include <node.h>

#include <string>

namespace skbinding {
v8::Local<v8::String> FromUtf8(v8::Isolate*, const char*);
void AddFunction(v8::Isolate*, v8::Local<v8::Object>, const char*,
                 v8::FunctionCallback callback);
void Metadata(v8::Isolate*, std::string&, int&, int&);
void NewClass(const v8::FunctionCallbackInfo<v8::Value>&,
              std::function<bool(v8::Local<v8::Value>)>,
              std::function<void(v8::Isolate*, v8::Local<v8::Value>,
                                 v8::Local<v8::Object>)>);
void InitClass(v8::Local<v8::Object>, const char*, v8::FunctionCallback,
               std::function<void(v8::Local<v8::FunctionTemplate>)>,
               v8::Persistent<v8::Function>*);
v8::Local<v8::Value> CallGlobalStaticMethod(v8::Isolate*, const char*,
                                            const char*, int,
                                            v8::Local<v8::Value> argv[]);
uint32_t CreateHandle(v8::Isolate*, v8::Local<v8::Value>);
bool GetHandle(v8::Isolate*, uint32_t id, v8::Local<v8::Value>&);
bool DeleteHandle(v8::Isolate*, uint32_t id, v8::Local<v8::Value>&);
void* SwitchContext(void*);
void RestoreContext(void*);
bool CheckResult(v8::Isolate*, int, const char*);
void* GetContext();
void* SKTryCatch(v8::Isolate*, v8::Local<v8::Function>, v8::Local<v8::Value>,
                 int, v8::Local<v8::Value>[],
                 std::function<void*(v8::Isolate*, v8::Local<v8::Value>)>,
                 std::function<void(v8::Isolate*)>);
void SKTryCatchVoid(v8::Isolate*, v8::Local<v8::Function>, v8::Local<v8::Value>,
                    int, v8::Local<v8::Value>[],
                    std::function<void(v8::Isolate*)>,
                    std::function<void(v8::Isolate*)>);
void NatTryCatch(v8::Isolate*, std::function<void(v8::Isolate*)>);
char* ToSKString(v8::Isolate*, v8::Local<v8::Value>);
void Print(v8::Isolate*, const char*, v8::Local<v8::Value>);
v8::Local<v8::Value> JSONStringify(v8::Isolate*, v8::Local<v8::Value>);

struct SkipException : std::exception {
  explicit SkipException(void* exc) : m_skipException(exc) {}

  virtual const char* what() const noexcept override;

  const char* name() const noexcept;

  void* m_skipException;
};
}  // namespace skbinding

#endif  // SKCOMMON_H