/*****************************************************************************/
/* Persistent memory storage. */
/*****************************************************************************/

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>

#include "runtime.h"

#define BOTTOM_ADDR ((void*)0x0000001000000000)
#define FTABLE_SIZE 64

/*****************************************************************************/
/* Persistent constants. */
/*****************************************************************************/

void*** pconsts = NULL;

/*****************************************************************************/
/* Database capacity. */
/*****************************************************************************/

size_t* capacity = NULL;

/*****************************************************************************/
/* Gensym. */
/*****************************************************************************/

uint64_t* gid;

uint64_t SKIP_genSym(uint64_t largerThan) {
  uint64_t n = 1;
  uint64_t gid_value = __atomic_load_n(gid, __ATOMIC_RELAXED);

  if (largerThan > 1024L * 1024L * 1024L) {
    fprintf(stderr, "ID too large: %" PRIu64 "\n", largerThan);
    exit(2);
  }

  if (largerThan > gid_value) {
    n += largerThan - gid_value;
  }

  return __atomic_fetch_add(gid, n, __ATOMIC_RELAXED);
}

/*****************************************************************************/
/* The global information structure. */
/*****************************************************************************/

typedef struct ginfo {
  void* ftable[FTABLE_SIZE];
  void* context;
  char* head;
  char* end;
  char* fileName;
  size_t total_palloc_size;
} ginfo_t;

ginfo_t* ginfo = NULL;

/*****************************************************************************/
/* Global locking. */
/*****************************************************************************/

pthread_mutexattr_t* gmutex_attr;
pthread_mutex_t* gmutex = (void*)1234;

// This is only used for debugging purposes
int sk_is_locked = 0;

void sk_check_has_lock() {
  if ((ginfo->fileName != NULL) && !sk_is_locked) {
    fprintf(stderr, "INTERNAL ERROR: unsafe operation\n");
    SKIP_throw_cruntime(ERROR_INTERNAL_LOCK);
  }
}

void sk_global_lock_init() {
  pthread_mutexattr_init(gmutex_attr);
  pthread_mutexattr_setpshared(gmutex_attr, PTHREAD_PROCESS_SHARED);
#ifndef __APPLE__
  pthread_mutexattr_setrobust(gmutex_attr, PTHREAD_MUTEX_ROBUST);
#endif
  pthread_mutex_init(gmutex, gmutex_attr);
}

void sk_global_lock() {
  if (ginfo->fileName == NULL) {
    return;
  }

  int code = pthread_mutex_lock(gmutex);
  sk_is_locked = 1;

  if (code == 0) {
    return;
  }

#ifndef __APPLE__
  if (code == EOWNERDEAD) {
    pthread_mutex_consistent(gmutex);
    return;
  }
#endif

  perror("Internal error: locking failed");
  exit(ERROR_LOCKING);
}

void sk_global_unlock() {
  if (ginfo->fileName == NULL) {
    return;
  }

  int code = pthread_mutex_unlock(gmutex);
  sk_is_locked = 0;

  if (code == 0) {
    return;
  }

  perror("Internal error: global unlocking failed");
  exit(ERROR_LOCKING);
}

/*****************************************************************************/
/* Mutexes/Condition variables. */
/*****************************************************************************/

void SKIP_mutex_init(pthread_mutex_t* lock) {
  if (sizeof(pthread_mutex_t) > 48) {
    fprintf(stderr, "Internal error: mutex object too large for this arch\n");
  }
  pthread_mutexattr_t mutex_attr_holder;
  pthread_mutexattr_t* mutex_attr = &mutex_attr_holder;
  pthread_mutexattr_init(mutex_attr);
  pthread_mutexattr_setpshared(mutex_attr, PTHREAD_PROCESS_SHARED);
#ifndef __APPLE__
  pthread_mutexattr_setrobust(mutex_attr, PTHREAD_MUTEX_ROBUST);
#endif
  pthread_mutex_init(lock, mutex_attr);
}

void SKIP_mutex_lock(pthread_mutex_t* lock) {
  int code = pthread_mutex_lock(lock);

  if (code == 0) {
    return;
  }

#ifndef __APPLE__
  if (code == EOWNERDEAD) {
    pthread_mutex_consistent(lock);
    return;
  }
#endif

  fprintf(stderr, "Internal error: locking failed\n");
  exit(ERROR_LOCKING);
}

void SKIP_mutex_unlock(pthread_mutex_t* lock) {
  int code = pthread_mutex_unlock(lock);

  if (code == 0) {
    return;
  }

  fprintf(stderr, "Internal error: unlocking failed, %d\n", code);
  exit(ERROR_LOCKING);
}

void SKIP_cond_init(pthread_cond_t* cond) {
  if (sizeof(pthread_mutex_t) > 48) {
    fprintf(stderr, "Internal error: mutex object too large for this arch\n");
  }
  pthread_condattr_t cond_attr_value;
  pthread_condattr_t* cond_attr = &cond_attr_value;
  pthread_condattr_init(cond_attr);
  pthread_condattr_setpshared(cond_attr, PTHREAD_PROCESS_SHARED);
  pthread_cond_init(cond, cond_attr);
}

void* SKIP_freeze_lock(void* x) {
  return x;
}

void* SKIP_unfreeze_lock(void* x) {
  return x;
}

void* SKIP_freeze_cond(void* x) {
  return x;
}

void* SKIP_unfreeze_cond(void* x) {
  return x;
}

void SKIP_cond_wait(pthread_cond_t* x, pthread_mutex_t* y) {
  pthread_cond_wait(x, y);
}

int32_t SKIP_cond_timedwait(pthread_cond_t* x, pthread_mutex_t* y,
                            uint32_t secs) {
  struct timeval tv;
  struct timespec ts;
  gettimeofday(&tv, NULL);
  ts.tv_sec = tv.tv_sec + secs;
  ts.tv_nsec = 0;
  return (int32_t)pthread_cond_timedwait(x, y, &ts);
}

int32_t SKIP_cond_broadcast(void* c) {
  return (int32_t)pthread_cond_broadcast(c);
}

/*****************************************************************************/
/* Debugging support for contexts. Set CTX_TABLE to 1 to use. */
/*****************************************************************************/

#ifdef CTX_TABLE
char* ctx_table[CTX_TABLE_CAPACITY];
size_t ctx_table_size = 0;

int sk_find_ctx(char* context) {
  int i;
  for (i = 0; i < ctx_table_size; i++) {
    if (context == ctx_table[i]) {
      return i;
    }
  }
  return -1;
}

void sk_clean_ctx_table() {
  int i = 0;
  int j = 0;
  for (; j < ctx_table_size; j++) {
    int rcount = sk_get_ref_count(ctx_table[j]);
    if (rcount < 0) {
      fprintf(stderr, "Error: CTX_TABLE found negative ref count");
      exit(ERROR_CONTEXT_CHECK);
    }
    if (rcount == 0) {
      continue;
    }
    if (i != j) {
      ctx_table[i] = ctx_table[j];
    }
    i++;
  }
  ctx_table_size = i;
}

void sk_print_ctx_table() {
  int i = 0;
  fprintf(stderr, "---- CTX TABLE BEGIN -----\n");
  for (; i < ctx_table_size; i++) {
    fprintf(stderr, "%p, REF_COUNT: %lu\n", ctx_table[i],
            sk_get_ref_count(ctx_table[i]));
  }
  fprintf(stderr, "---- CTX TABLE END -------\n");
}

void sk_add_ctx(char* context) {
  int i = sk_find_ctx(context);
  if (i < 0) {
    if (ctx_table_size >= CTX_TABLE_CAPACITY) {
      fprintf(stderr, "Error: CTX_TABLE reached maximum capacity");
      exit(ERROR_CONTEXT_CHECK);
    }
    ctx_table[ctx_table_size] = context;
    ctx_table_size++;
  }
}

#endif

/*****************************************************************************/
/* Global context access primitives. */
/*****************************************************************************/

char* SKIP_context_get_unsafe() {
  char* context = ginfo->context;

  if (context != NULL) {
    sk_incr_ref_count(context);
  }

  return context;
}

uint32_t SKIP_has_context() {
  sk_global_lock();
  char* context = ginfo->context;
  uint32_t result = context != NULL;
  sk_global_unlock();
  return result;
}

SkipInt SKIP_context_ref_count() {
  char* context = ginfo->context;

  if (context == NULL) {
    return (SkipInt)0;
  } else {
    return sk_get_ref_count(context);
  }
}

char* SKIP_context_get() {
  sk_global_lock();
  char* context = SKIP_context_get_unsafe();
  sk_global_unlock();

  return context;
}

void sk_context_set_unsafe(char* obj) {
  ginfo->context = obj;
#ifdef CTX_TABLE
  sk_add_ctx(obj);
#endif
}

void sk_context_set(char* obj) {
  sk_global_lock();
  ginfo->context = obj;
  sk_global_unlock();
}

/*****************************************************************************/
/* Staging/commit. */
/*****************************************************************************/

void sk_commit(char* new_root, uint32_t sync) {
  if (ginfo->fileName == NULL) {
    sk_context_set_unsafe(new_root);
    return;
  }

  __sync_synchronize();
  if (sync) {
    msync(BOTTOM_ADDR, *capacity, MS_SYNC);
  }
  sk_context_set_unsafe(new_root);
  if (sync) {
    msync(BOTTOM_ADDR, *capacity, MS_SYNC);
  }
}

/*****************************************************************************/
/* Disk-persisted state, a.k.a. file mapping. */
/*****************************************************************************/

typedef struct file_mapping file_mapping_t;

typedef struct {
  int64_t version;
  file_mapping_t* bottom_addr;
} file_mapping_header_t;

struct file_mapping {
  file_mapping_header_t header;
  pthread_mutexattr_t gmutex_attr;
  pthread_mutex_t gmutex;
  ginfo_t ginfo_data;
  uint64_t gid;
  size_t capacity;
  void** pconsts;
  char persistent_fileName[1];
};

/*****************************************************************************/
/* Creates a new file mapping. */
/*****************************************************************************/

int sk_create_mapping(char* fileName, size_t icapacity) {
  if (access(fileName, F_OK) == 0) {
    return ERROR_MAPPING_EXISTS;
  }
  file_mapping_t* mapping;
  int prot = PROT_READ | PROT_WRITE;
  if (fileName == NULL) {
    mapping = mmap(NULL, icapacity, prot, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  } else {
    int fd = open(fileName, O_RDWR | O_CREAT, 0600);
    lseek(fd, icapacity, SEEK_SET);
    (void)write(fd, "", 1);
    mapping = mmap(BOTTOM_ADDR, icapacity, prot, MAP_SHARED | MAP_FIXED, fd, 0);
    close(fd);
  }

  if (mapping == MAP_FAILED) {
    return ERROR_MAPPING_FAILED;
  }

  mapping->header.version = SKIP_get_version();
  mapping->header.bottom_addr = mapping;

  gmutex_attr = &mapping->gmutex_attr;
  gmutex = &mapping->gmutex;
  ginfo = &mapping->ginfo_data;
  gid = &mapping->gid;
  capacity = &mapping->capacity;
  pconsts = &mapping->pconsts;

  size_t fileName_length = (fileName != NULL) ? strlen(fileName) + 1 : 0;
  char* persistent_fileName = mapping->persistent_fileName;

  char* head = persistent_fileName + fileName_length;
  char* end = (char*)mapping + icapacity;

  if (head >= end) {
    return ERROR_MAPPING_MEMORY;
  }

  if (fileName != NULL) {
    memcpy(persistent_fileName, fileName, fileName_length);
  } else {
    persistent_fileName = "";
  }

  int i;
  for (i = 0; i < FTABLE_SIZE; i++) {
    ginfo->ftable[i] = NULL;
  }

  ginfo->total_palloc_size = 0;

  // The head must be aligned!
  head = (char*)(((uintptr_t)head + (uintptr_t)(15)) & ~((uintptr_t)(15)));

  ginfo->head = head;
  ginfo->end = end;
  ginfo->fileName = (fileName != NULL) ? persistent_fileName : NULL;
  ginfo->context = NULL;
  *gid = 1;
  if (icapacity != DEFAULT_CAPACITY) {
    printf("CAPACITY SET TO: %ld\n", icapacity);
  }
  *capacity = icapacity;
  *pconsts = NULL;

  if (ginfo->fileName != NULL) {
    sk_global_lock_init();
  }
  return 0;
}

/*****************************************************************************/
/* Loads an existing mapping. */
/*****************************************************************************/

int sk_load_mapping(char* fileName) {
  int fd = open(fileName, O_RDWR, 0600);

  if (fd == -1) {
    return ERROR_FILE_IO;
  }

  file_mapping_header_t header;
  lseek(fd, 0L, SEEK_SET);
  int bytes = read(fd, &header, sizeof(file_mapping_header_t));

  if (bytes != sizeof(file_mapping_header_t)) {
    return ERROR_MAPPING_MEMORY;
  }

  if (header.version != SKIP_get_version()) {
    return ERROR_MAPPING_VERSION;
  }

  size_t fsize = lseek(fd, 0, SEEK_END) - 1;
  int prot = PROT_READ | PROT_WRITE;
  file_mapping_t* mapping =
      mmap(header.bottom_addr, fsize, prot, MAP_SHARED | MAP_FIXED, fd, 0);
  close(fd);

  if (mapping == MAP_FAILED) {
    return ERROR_MAPPING_FAILED;
  }

  gmutex = &mapping->gmutex;
  ginfo = &mapping->ginfo_data;
  gid = &mapping->gid;
  capacity = &mapping->capacity;
  pconsts = &mapping->pconsts;
  return 0;
}

/*****************************************************************************/
/* Detects pointers that come from the binary. */
/*****************************************************************************/

int obstack_intervals_contains(void*);

int sk_is_static(void* ptr) {
  return !((char*)ginfo <= (char*)ptr && (char*)ptr < ginfo->end);
}

/*****************************************************************************/
/* Free table. */
/*****************************************************************************/

size_t sk_bit_size(size_t size) {
  return (size_t)(sizeof(size_t) * 8 - __builtin_clzl(size - 1));
}

size_t sk_pow2_size(size_t size) {
  size = (size + (sizeof(void*) - 1)) & ~(sizeof(void*) - 1);
  return (1 << sk_bit_size(size));
}

void sk_add_ftable(void* ptr, size_t size) {
  int slot = sk_bit_size(size);
  *(void**)ptr = ginfo->ftable[slot];
  ginfo->ftable[slot] = ptr;
}

void* sk_get_ftable(size_t size) {
  int slot = sk_bit_size(size);
  void** ptr = ginfo->ftable[slot];
  if (ptr == NULL) {
    return ptr;
  }
  ginfo->ftable[slot] = *ptr;
  return ptr;
}

/*****************************************************************************/
/* No file initialization (the memory is not backed by a file). */
/*****************************************************************************/

// Handy structure to allocate all those things at once
typedef struct {
  ginfo_t ginfo_data;
  uint64_t gid;
  void** pconsts;
} no_file_t;

#ifdef __APPLE__
static int sk_init_no_file() {
  no_file_t* no_file = malloc(sizeof(no_file_t));
  if (no_file == NULL) {
    return ERROR_MALLOC;
  }
  ginfo = &no_file->ginfo_data;
  ginfo->total_palloc_size = 0;
  ginfo->fileName = NULL;
  ginfo->context = NULL;
  gmutex = NULL;
  gid = &no_file->gid;
  pconsts = &no_file->pconsts;
  *gid = 1;
  *pconsts = NULL;
  return 0;
}
#endif

int sk_is_nofile_mode() {
  return (ginfo->fileName == NULL);
}

/*****************************************************************************/
/* Memory initialization. */
/*****************************************************************************/

extern SKIP_gc_type_t* epointer_ty;

void check_alloc_error(int code, char* fileName, int is_create) {
  if (code == 0) return;
  switch (code) {
    case ERROR_FILE_IO:
      fprintf(stderr, "Error: could not open file (did you run --init?)\n");
      break;
    case ERROR_MAPPING_MEMORY:
      if (is_create) {
        fprintf(stderr, "Error: Could not initialize memory\n");
      } else {
        fprintf(stderr, "Error: could not read header\n");
      }
      break;
    case ERROR_MAPPING_VERSION:
      fprintf(stderr, "Error: wrong file format: %s\n", fileName);
      break;
    case ERROR_MAPPING_FAILED:
      perror("Error (MAP FAILED)");
      break;
    case ERROR_MAPPING_EXISTS:
      fprintf(stderr, "Error: File %s already exists!\n", fileName);
      break;
    case ERROR_MAPPING_CAPACITY:
      fprintf(stderr, "Error: capacity expects an integer greater than zero\n");
      break;
    default:
      fprintf(stderr, "Error with code %d occurs!\n", code);
      break;
  }
  exit(code);
}

int SKIP_memory_init(char* fileName, int is_create, int64_t capacity) {
#ifdef __APPLE__
  if (fileName != NULL) {
    fprintf(stderr,
            "Persistent allocation not supported on this platform. "
            "Disregarding %s.\n",
            fileName);
  }
  if (is_create) {
    exit(EXIT_SUCCESS);
  }
  int res = sk_init_no_file();
  if (res != 0) return res;

#else   // __APPLE__
  if (is_create || fileName == NULL) {
    if (capacity <= 0 && fileName != NULL) return ERROR_MAPPING_CAPACITY;
    int res = sk_create_mapping(fileName,
                                capacity == 0 ? DEFAULT_CAPACITY : capacity);
    if (res != 0) return res;
  } else {
    int res = sk_load_mapping(fileName);
    if (res != 0) return res;
  }
#endif  // __APPLE__

  char* obj = sk_get_external_pointer();
  epointer_ty = get_gc_type(obj);
  return 0;
}

/*****************************************************************************/
/* Persistent alloc/free primitives. */
/*****************************************************************************/

void SKIP_print_persistent_size() {
  printf("%ld\n", ginfo->total_palloc_size);
}

void* sk_palloc(size_t size) {
  sk_check_has_lock();
  size = sk_pow2_size(size);
  ginfo->total_palloc_size += size;
  sk_cell_t* ptr = sk_get_ftable(size);
  if (ptr != NULL) {
    return ptr;
  }
  if (ginfo->head + size >= ginfo->end) {
    fprintf(stderr, "Error: out of persistent memory.\n");
    exit(ERROR_OUT_OF_MEMORY);
  }
  void* result = ginfo->head;
  ginfo->head += size;
  return result;
}

void sk_pfree_size(void* chunk, size_t size) {
  sk_check_has_lock();
  size = sk_pow2_size(size);
  ginfo->total_palloc_size -= size;
  sk_add_ftable(chunk, size);
}
