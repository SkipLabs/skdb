extern "C" {
#include "runtime.h"
}
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#ifdef __APPLE__
#include <sys/syslimits.h>
#else
#include <linux/limits.h>
#endif
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <exception>
#include <iostream>
#include <map>
#include <random>
#include <string>
#include <vector>

extern "C" {
#include "xoroshiro128plus.h"
}

#ifndef RELEASE
#include <backtrace.h>

typedef struct {
  char* head;
  char* page;
  char* end;
} sk_saved_obstack_t;

extern "C" {
char* sk2c_string(char* skStr);
void* sk_get_exception_type(void* skExn);
void* sk_get_exception_message(void* skExn);
sk_saved_obstack_t* SKIP_new_Obstack();
void SKIP_destroy_Obstack(sk_saved_obstack_t* saved);
}

namespace {

struct backtrace_data {
  bool full_trace;
  bool before_main;
  bool before_throw;
};

static int print_callback(void* data, uintptr_t pc, const char* filename,
                          int lineno, const char* function) {
  auto ctx = static_cast<backtrace_data*>(data);

  if (ctx->full_trace || (ctx->before_main && !ctx->before_throw)) {
    fprintf(stderr, "File %s, line %d\n\t%s()\n",
            filename == NULL ? "???" : filename, lineno,
            function == NULL ? "???" : function);
  }

  if (0 == strcmp(function, "SKIP_throw")) {
    ctx->before_throw = false;
  } else if (0 == strcmp(function, "skip_main")) {
    ctx->before_main = false;
  }

  return 0;
}

static void error_callback(void* /* data */, const char* msg, int errnum) {
  fprintf(stderr, "libbacktrace: %s", msg);
  if (errnum > 0) fprintf(stderr, ": %s", strerror(errnum));
  fputc('\n', stderr);
}
}  // namespace

#endif  // RELEASE

namespace skip {
struct SkipException : std::exception {
  explicit SkipException(void* exc) : m_skipException(exc) {}

  virtual const char* what() const noexcept override {
    return sk2c_string((char*)sk_get_exception_message(m_skipException));
  }

  const char* name() const noexcept {
    return sk2c_string((char*)sk_get_exception_type(m_skipException));
  }

  void* m_skipException;
};

#ifndef RELEASE

void printStackTrace() {
  struct backtrace_state* state =
      backtrace_create_state(nullptr, 0, error_callback, nullptr);
  if (state == nullptr) {
    fprintf(stderr, "libbacktrace: Failed to initialize backtrace\n");
    return;
  }

  backtrace_data data{false, true, true};
  backtrace_full(state, 3, print_callback, error_callback, &data);
}

#endif
}  // namespace skip

#ifndef RELEASE
namespace {
void terminate() {
  // TODO: Only print backtrace in debug mode.
  try {
    std::exception_ptr eptr = std::current_exception();
    if (eptr) {
      std::rethrow_exception(eptr);
    }
  } catch (skip::SkipException& e) {
    std::cerr << "*** Uncaught exception of type " << e.name() << ": "
              << e.what() << std::endl;
  } catch (std::exception& e) {
    std::cerr << "*** Uncaught exception: " << e.what() << std::endl;
  }
  std::cerr << "*** Stack trace:" << std::endl;
  skip::printStackTrace();
}
}  // namespace
#endif

extern "C" {

void SKIP_call0(void*);
void SKIP_initializeSkip();
void skip_main();
uint32_t SKIP_String_byteSize(char*);
char* sk_string_create(const char* buffer, uint32_t size);
void SKIP_throw_EndOfFile();

char* sk2c_string(char* skstr) {
  char* cstr;
  size_t size = SKIP_String_byteSize(skstr);
  if (skstr[size - 1] == (char)0) {
    cstr = skstr;
  } else {
    cstr = (char*)malloc(size + 1);
    if (cstr == NULL) {
      perror("malloc");
      exit(1);
    }
    memcpy(cstr, skstr, size);
    cstr[size] = (char)0;
  }
  if (strlen(cstr) != size) {
    fprintf(stderr, "String contains embedded nul character: ");
    fwrite(skstr, size, 1, stderr);
    fprintf(stderr, "\n");
    exit(2);
  }
  return cstr;
}

char** sk2c_string_array(char* skarr) {
  size_t sz = *(uint32_t*)(skarr - sizeof(char*) - sizeof(uint32_t));
  char** arr = (char**)malloc(sizeof(char*) * (sz + 1));
  if (arr == NULL) {
    perror("malloc");
    exit(EXIT_FAILURE);
  }
  for (size_t i = 0; i < sz; ++i) {
    char* skstr = *((char**)skarr + i);
    arr[i] = sk2c_string(skstr);
  }
  arr[sz] = 0;

  return arr;
}

void SKIP_print_char(uint32_t x) {
  printf("%c", x);
}

void SKIP_throw(void* exc) {
  throw skip::SkipException(exc);
}

thread_local std::string lineBuffer;

int32_t SKIP_read_line_fill(void) {
  std::getline(std::cin, lineBuffer);
  if (std::cin.fail()) {
    return -1;
  }
  return lineBuffer.size();
}

int32_t SKIP_read_to_end_fill() {
  std::istreambuf_iterator<char> begin(std::cin), end;
  lineBuffer = std::string(begin, end);
  return lineBuffer.size();
}

uint32_t SKIP_read_line_get(uint32_t i) {
  return lineBuffer[i];
}

thread_local void* exn;

void* SKIP_getExn() {
  return exn;
}

void SKIP_saveExn(void* e) {
  exn = e;
}

static int argc = 0;
static char** argv = NULL;
extern char** environ;

int64_t SKIP_getArgc() {
  return argc;
}

char* SKIP_getArgN(int64_t n) {
  return sk_string_create(argv[n], strlen(argv[n]));
}

int64_t SKIP_get_envc() {
  char** p = nullptr;
  for (p = environ; *p != nullptr; ++p)
    ;
  return (int)(p - environ);
}

char* SKIP_get_envN(int64_t n) {
  return sk_string_create(environ[n], strlen(environ[n]));
}

char* sk_create_none_string_option();
char* sk_create_string_option(char* str);

char* SKIP_getenv(char* skName) {
  char* name = sk2c_string(skName);
  char* value = getenv(name);
  if (name != skName) free(name);
  if (value == nullptr) {
    return sk_create_none_string_option();
  }
  return sk_create_string_option(sk_string_create(value, strlen(value)));
}

void SKIP_setenv(char* skName, char* skValue) {
  char* name = sk2c_string(skName);
  char* value = sk2c_string(skValue);
  int rv = setenv(name, value, 1);
  if (rv != 0) {
    perror("setenv");
    exit(EXIT_FAILURE);
  }
  if (name != skName) free(name);
  if (value != skValue) free(value);
}

void SKIP_unsetenv(char* skName) {
  char* name = sk2c_string(skName);
  int rv = unsetenv(name);
  if (rv != 0) {
    perror("unsetenv");
    exit(EXIT_FAILURE);
  }
  if (name != skName) free(name);
}

void SKIP_memory_init(int pargc, char** pargv);
void sk_persist_consts();
extern void* program_break;

void __attribute__((constructor)) premain() {
  program_break = sbrk(0);
}

int main(int pargc, char** pargv) {
  sk_saved_obstack_t* saved;
  argc = pargc;
  argv = pargv;
  std::set_terminate(terminate);
  SKIP_memory_init(pargc, pargv);
  saved = SKIP_new_Obstack();
  SKIP_initializeSkip();
  sk_persist_consts();
  SKIP_destroy_Obstack(saved);
  skip_main();
}

static void print(FILE* descr, char* str) {
  size_t size = SKIP_String_byteSize((char*)str);
  fwrite(str, size, 1, descr);
}

void SKIP_print_raw(char* str) {
  print(stdout, str);
}

void SKIP_print_error_raw(char* str) {
  print(stderr, str);
}

void SKIP_print_debug_raw(char* str) {
  SKIP_print_error_raw(str);
}

void SKIP_flush_stdout() {
  fflush(stdout);
  fflush(stderr);
}

void print_string(char* str) {
  print(stdout, str);
  printf("\n");
}

void SKIP_print_error(char* str) {
  print(stderr, str);
  fprintf(stderr, "\n");
}

void SKIP_print_debug(char* str) {
  SKIP_print_error(str);
}

char* SKIP_open_file(char* filename_obj) {
  struct stat s;
  char* filename = sk2c_string(filename_obj);

  int fd = open(filename, O_RDONLY);
  int status = fstat(fd, &s);
  size_t size = s.st_size;

  if (size == 0) {
    return sk_string_create("", 0);
  }

  char* f = (char*)mmap(NULL, size, PROT_READ, MAP_PRIVATE, fd, 0);
  if (f == (void*)MAP_FAILED) {
    perror("ERROR (MMap FAILED)");
    fprintf(stderr, "Could not open file: %s\n", filename);
    exit(ERROR_FILE_IO);
  }
  char* result = sk_string_create(f, size);
  if (filename != filename_obj) free(filename);
  munmap(f, size);
  close(fd);
  return result;
}

void SKIP_write_to_file(int64_t fd, char* str) {
  size_t size = SKIP_String_byteSize(str);
  while (size > 0) {
    ssize_t written = write(fd, str, size);
    if (written < 0) {
      int err = errno;
      fprintf(stderr, "Could not write to file. %" PRId64 " (%d)\n", fd, err);
      exit(ERROR_FILE_IO);
    }
    size -= written;
  }
}

void SKIP_FileSystem_appendTextFile(char* filename_obj, char* str_obj) {
  char* filename = sk2c_string(filename_obj);

  int fd = open(filename, O_WRONLY | O_CREAT | O_APPEND, 0775);
  write(fd, str_obj, SKIP_String_byteSize(str_obj));
  close(fd);

  if (filename != filename_obj) free(filename);
}

bool SKIP_check_if_file_exists(char* filename_obj) {
  char* filename = sk2c_string(filename_obj);

  bool res = (access(filename, F_OK) == 0);

  if (filename != filename_obj) free(filename);
  return res;
}

int64_t SKIP_notify(char* filename_obj, uint64_t tick) {
  char* filename = sk2c_string(filename_obj);

  int fd = open(filename, O_CREAT | O_WRONLY, 0644);

  if (filename != filename_obj) free(filename);

  if (fd == -1) {
    return -1;
  }

  char buf_data[256];
  char* buf = buf_data;
  snprintf(buf, 256, "%" PRIu64 "\n", tick);
  size_t size = strlen(buf);

  while (size > 0) {
    size_t written = write(fd, buf, size);
    if (written == -1) {
      return -1;
    }
    buf += written;
    size -= written;
  }

  if (close(fd) == -1) {
    return -1;
  }

  return 0;
}

void SKIP_random_init() {
  std::random_device rd;
  std::uniform_int_distribution<uint64_t> dist(0, UINT64_MAX);
  uint64_t seed = dist(rd);
  xoroshiro128plus_init(seed);
}

uint64_t SKIP_random_next() {
  return xoroshiro128plus_next();
}

int64_t SKIP_time() {
  time_t res = time(nullptr);
  if (res == -1) {
    perror("time");
    exit(EXIT_FAILURE);
  }
  return (int64_t)res;
}

uint64_t SKIP_time_ms() {
  using namespace std::chrono;

  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch())
      .count();
}

char* SKIP_unix_strftime(char* formatp, char* timep) {
  struct tm* tm = (struct tm*)timep;
  char buffer[1024];
  char cformat[1024];
  uint32_t byteSize = SKIP_String_byteSize(formatp);
  if (byteSize >= 1024) {
    fprintf(stderr, "format string too large");
    exit(ERROR_INVALID_STRING);
  }
  cformat[byteSize] = 0;
  memcpy(cformat, formatp, byteSize);
  size_t size = strftime(buffer, 1024, cformat, tm);
  return sk_string_create(buffer, size);
}

char* SKIP_strftime(char* formatp, int64_t timestamp) {
  struct tm tm;
  localtime_r((time_t*)&timestamp, &tm);
  return SKIP_unix_strftime(formatp, (char*)&tm);
}

char* SKIP_getcwd() {
  char path[PATH_MAX];
  char* res = getcwd(path, PATH_MAX);
  if (res == NULL) {
    perror("getcwd");
    exit(EXIT_FAILURE);
  }
  return sk_string_create(path, strlen(path));
}

void SKIP_chdir(char* path_obj) {
  char* path = sk2c_string(path_obj);
  int rv = chdir(path);
  if (rv != 0) {
    perror("chdir");
    exit(EXIT_FAILURE);
  }
  if (path != path_obj) free(path);
}

int64_t SKIP_numThreads() {
  return 1;
}

void SKIP_string_to_file(char* str, char* file_obj) {
  char* file = sk2c_string(file_obj);

  FILE* out = fopen(file, "w");
  size_t size = SKIP_String_byteSize(str);
  while (size != 0) {
    size_t written = fwrite(str, 1, size, out);
    size -= written;
  }
  fclose(out);

  if (file != file_obj) free(file);
}

int64_t SKIP_get_mtime(char* path) {
  struct stat st;
  if (stat(path, &st) < 0) {
    return 0;
  }
  return st.st_mtime;
}

bool SKIP_is_directory(char* path) {
  struct stat st;
  if (stat(path, &st) < 0) {
    return 0;
  }
  return st.st_mode & S_IFDIR;
}

int64_t SKIP_system(char* cmd_obj) {
  char* cmd = sk2c_string(cmd_obj);
  int64_t res = system(cmd);
  if (cmd != cmd_obj) free(cmd);
  return res;
}

int64_t SKIP_opendir(char* path_obj) {
  char* path = sk2c_string(path_obj);

  DIR* res = opendir(path);
  if (res == NULL) {
    perror("Error opening dir");
  }

  if (path != path_obj) free(path);
  return (int64_t)res;
}

char* SKIP_readdir(int64_t dir_handle) {
  struct dirent* dp = readdir((DIR*)dir_handle);
  if (dp == NULL) {
    return sk_string_create("", 0);
  }
  size_t len = strlen(dp->d_name);
  return sk_string_create(dp->d_name, len);
}

void SKIP_closedir(int64_t dir_handle) {
  int rv = closedir((DIR*)dir_handle);

  if (rv != 0) {
    perror("closedir");
  }
}

char* SKIP_realpath(char* path_obj) {
  char* path = sk2c_string(path_obj);

  char res[PATH_MAX];
  char* rv = realpath(path, res);
  if (path != path_obj) free(path);
  if (rv == NULL) {
    perror("realpath");
    // TODO: Ideally, this function would return a ?String instead.
    return sk_string_create(res, 0);
  }

  return sk_string_create(res, strlen(res));
}

__attribute__((noreturn)) void SKIP_exit(uint64_t code) {
  exit(code);
}

char* SKIP_call_external_fun(int32_t, char*) {
  fprintf(stderr, "SKIP_call_external_fun not implemented in native mode");
  exit(2);
}

/*****************************************************************************/
/* Primitives used to output js objects directly, doesn't do anything
 * in native mode.
 */
/*****************************************************************************/

void SKIP_last_tick(uint32_t) {
  // Not implemented
}
void SKIP_switch_to(uint32_t) {
  // Not implemented
}
void SKIP_clear_field_names() {
  // Not implemented
}
void SKIP_push_field_name(char*) {
  // Not implemented
}
void SKIP_clear_object() {
  // Not implemented
}
void SKIP_push_object_field_null() {
  // Not implemented
}
void SKIP_push_object_field_int32(int32_t) {
  // Not implemented
}
void SKIP_push_object_field_int64(char*) {
  // Not implemented
}
void SKIP_push_object_field_float(char*) {
  // Not implemented
}
void SKIP_push_object_field_string(char*) {
  // Not implemented
}
void SKIP_push_object() {
  // Not implemented
}
void SKIP_js_delete_fun() {
  // Not implemented
}
}
