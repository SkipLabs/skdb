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

#define DEFAULT_CAPACITY (1024L * 1024L * 1024L * 16L)
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
  char* break_ptr;
  size_t total_palloc_size;
  size_t free_table_size;
} ginfo_t;

ginfo_t* ginfo = NULL;

sk_session_t* psession = NULL;

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
/* File name parser (from the command line arguments). */
/*****************************************************************************/

static char* parse_args(int argc, char** argv, int* is_init) {
  // FIXME
  if (argc > 0 && strcmp(argv[0], "skargo") == 0) {
    return NULL;
  }

  int i;
  int idx = -1;

  for (i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--data") == 0 || strcmp(argv[i], "--init") == 0) {
      if (strcmp(argv[i], "--init") == 0) {
        *is_init = 1;
      }
      if (i + 1 >= argc) {
        fprintf(stderr, "Error: --data/--init expects a file name");
        exit(ERROR_ARG_PARSE);
      }
      if (idx != -1) {
        fprintf(stderr, "Error: incompatible --data/--init options");
        exit(ERROR_ARG_PARSE);
      }
      idx = i + 1;
    }
  }

  if (idx == -1) {
    return NULL;
  } else {
    return argv[idx];
  }
}

size_t parse_capacity(int argc, char** argv) {
  int i;

  for (i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--capacity") == 0) {
      if (i + 1 < argc) {
        if (argv[i + 1][0] >= '0' && argv[i + 1][0] <= '9') {
          int j = 0;

          while (argv[i + 1][j] != 0) {
            if (argv[i + 1][j] >= '0' && argv[i + 1][j] <= '9') {
              j++;
              continue;
            }
            fprintf(stderr, "--capacity expects an integer\n");
            exit(2);
          }
          return atol(argv[i + 1]);
        } else if (argv[i + 1][0] == '-') {
          return DEFAULT_CAPACITY;
        } else {
          fprintf(stderr, "--capacity expects an integer\n");
          exit(2);
        }
      }
    }
  }
  return DEFAULT_CAPACITY;
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
  sk_session_t session;
  void** pconsts;
  char persistent_fileName[1];
};

/*****************************************************************************/
/* Creates a new file mapping. */
/*****************************************************************************/

void sk_create_mapping(char* fileName, size_t icapacity) {
  if (fileName != NULL && access(fileName, F_OK) == 0) {
    fprintf(stderr, "ERROR: File %s already exists!\n", fileName);
    exit(ERROR_MAPPING_EXISTS);
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
    perror("ERROR (MAP FAILED)");
    exit(ERROR_MAPPING_FAILED);
  }

  mapping->header.version = SKIP_get_version();
  mapping->header.bottom_addr = mapping;

  gmutex_attr = &mapping->gmutex_attr;
  gmutex = &mapping->gmutex;
  ginfo = &mapping->ginfo_data;
  gid = &mapping->gid;
  capacity = &mapping->capacity;
  pconsts = &mapping->pconsts;
  psession = &mapping->session;

  size_t fileName_length = (fileName != NULL) ? strlen(fileName) + 1 : 0;
  char* persistent_fileName = mapping->persistent_fileName;

  char* head = persistent_fileName + fileName_length;
  char* end = (char*)mapping + icapacity;

  if (head >= end) {
    fprintf(stderr, "Could not initialize memory\n");
    exit(ERROR_MAPPING_MEMORY);
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
  psession->low = 0;
  psession->high = 0;

  if (ginfo->fileName != NULL) {
    sk_global_lock_init();
  }
}

/*****************************************************************************/
/* Loads an existing mapping. */
/*****************************************************************************/

void sk_load_mapping(char* fileName) {
  int fd = open(fileName, O_RDWR, 0600);

  if (fd == -1) {
    fprintf(stderr, "Error: could not open file (did you run --init?)\n");
    exit(ERROR_FILE_IO);
  }

  file_mapping_header_t header;
  lseek(fd, 0L, SEEK_SET);
  int bytes = read(fd, &header, sizeof(file_mapping_header_t));

  if (bytes != sizeof(file_mapping_header_t)) {
    fprintf(stderr, "Error: could not read header\n");
    exit(ERROR_MAPPING_MEMORY);
  }

  if (header.version != SKIP_get_version()) {
    fprintf(stderr, "Error: wrong file format: %s\n", fileName);
    exit(ERROR_MAPPING_VERSION);
  }

  size_t fsize = lseek(fd, 0, SEEK_END) - 1;
  int prot = PROT_READ | PROT_WRITE;
  file_mapping_t* mapping =
      mmap(header.bottom_addr, fsize, prot, MAP_SHARED | MAP_FIXED, fd, 0);
  close(fd);

  if (mapping == MAP_FAILED) {
    perror("ERROR (MAP FAILED)");
    exit(ERROR_MAPPING_FAILED);
  }

  gmutex = &mapping->gmutex;
  ginfo = &mapping->ginfo_data;
  gid = &mapping->gid;
  capacity = &mapping->capacity;
  pconsts = &mapping->pconsts;
  psession = &mapping->session;
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
  sk_session_t session;
  void** pconsts;
} no_file_t;

#ifdef __APPLE__
static void sk_init_no_file() {
  no_file_t* no_file = malloc(sizeof(no_file_t));
  if (no_file == NULL) {
    perror("malloc");
    exit(1);
  }
  ginfo = &no_file->ginfo_data;
  ginfo->total_palloc_size = 0;
  ginfo->fileName = NULL;
  ginfo->context = NULL;
  gmutex = NULL;
  gid = &no_file->gid;
  pconsts = &no_file->pconsts;
  psession = &no_file->session;
  *gid = 1;
  *pconsts = NULL;
  psession->low = 0;
  psession->high = 0;
}
#endif

int sk_is_nofile_mode() {
  return (ginfo->fileName == NULL);
}

/*****************************************************************************/
/* Memory initialization. */
/*****************************************************************************/

extern SKIP_gc_type_t* epointer_ty;

void SKIP_memory_init(int argc, char** argv) {
  int is_create = 0;
  char* fileName = parse_args(argc, argv, &is_create);

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
  sk_init_no_file();

#else   // __APPLE__
  if (is_create || fileName == NULL) {
    size_t capacity = DEFAULT_CAPACITY;
    capacity = parse_capacity(argc, argv);
    sk_create_mapping(fileName, capacity);
  } else {
    sk_load_mapping(fileName);
  }
#endif  // __APPLE__

  char* obj = sk_get_external_pointer();
  epointer_ty = get_gc_type(obj);
}

/*****************************************************************************/
/* Persistent alloc/free primitives. */
/*****************************************************************************/

uint64_t SKIP_persistent_size() {
  uint64_t size = (uint64_t)ginfo->total_palloc_size;
  return size;
}

uint64_t SKIP_freetable_size() {
  uint64_t size = (uint64_t)ginfo->free_table_size;
  return size;
}

void SKIP_print_persistent_size() {
  printf("%ld\n", ginfo->total_palloc_size);
}

void* sk_palloc(size_t size) {
  sk_check_has_lock();
  size = sk_pow2_size(size);
  ginfo->total_palloc_size += size;
  sk_cell_t* ptr = sk_get_ftable(size);
  if (ptr != NULL) {
    ginfo->free_table_size -= size;
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
  ginfo->free_table_size += size;
  sk_add_ftable(chunk, size);
}
