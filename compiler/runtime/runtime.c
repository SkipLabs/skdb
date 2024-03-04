#include "runtime.h"

#ifdef SKIP64
#include <stdlib.h>
#include <unistd.h>
#endif

/*****************************************************************************/
/* Operations on the runtime representation of skip values. */
/*****************************************************************************/

/* A 64-bit "header" immediately precedes each skip object. The header of
   string objects consists of 2 uint32 values: first the size, then the hash,
   and then the string bytes themselves. Otherwise, the header is a pointer
   to the object's vtable. The runtime system assumes that every vtable is
   8-aligned (that is, the least significant 3 bits are clear). Bit 0 is used
   by copy.c and intern.c to tag temporary forwarding pointers.  Bit 1 is
   used by SKIP_is_string to determine if an object is a string or an object
   of some other type, and sk_string_set_hash ensures that bit 1 of string
   hash values is always set. */

sk_string_t* get_sk_string(char* obj) {
  return (sk_string_t*)(obj - sk_string_header_size);
}

uint32_t sk_string_hash_tag = 0x80000002;

uint32_t SKIP_is_string(char* obj) {
#ifdef SKIP64
  uint32_t res = get_sk_string(obj)->hash & sk_string_hash_tag;
  if (!res && ((uintptr_t)get_vtable_ptr(obj) & 0x7) != 0) {
    fprintf(stderr, "misaligned vtable: %lX\n", ((uintptr_t)get_vtable_ptr(obj) & 0xF));
    SKIP_exit(124);
  }
  if (get_sk_string(obj)->hash & 0x80000000) {
    if (get_sk_string(obj)->hash & 0x2) {
      return 1;
    } else {
      fprintf(stderr, "bit 31 but not 1 set: %p\n", &get_sk_string(obj)->hash);
      exit(66);
    }
  } else if (get_sk_string(obj)->hash & 0x2) {
    fprintf(stderr, "bit 1 but not 31 set: %p\n", &get_sk_string(obj)->hash);
    exit(67);
  } else {
    return 0;
  }
#endif
  return get_sk_string(obj)->hash & sk_string_hash_tag;
}

uint32_t sk_tag_string_hash(uint32_t untagged_hash) {
  return untagged_hash | sk_string_hash_tag;
}

void** get_vtable_ptr(char* skip_object) {
  // a vtable pointer immediately precedes a pointer to each skip object
  return ((void**)skip_object) - 1;
}

SKIP_gc_type_t* get_gc_type(char* skip_object) {
  SKIP_gc_type_t*** vtable_ptr = (SKIP_gc_type_t***)get_vtable_ptr(skip_object);
  if (((uintptr_t)vtable_ptr & 0x7) != 0) {
#ifdef SKIP64
    fprintf(stderr, "misaligned vtable: %lX\n", ((uintptr_t)vtable_ptr & 0xF));
#endif
    SKIP_exit(125);
  }
  // the gc_type of each object is stored in slot 1 of the vtable,
  // see createVTableBuilders in vtable.sk
  SKIP_gc_type_t** slot1 = *vtable_ptr + 1;
  return *slot1;
}


/*****************************************************************************/
/* Saving/restoring context to thread locals.
 *
 * These primitives are very dangerous to use unless you really know what you
 * are doing. The GC does not keep track of the local context, so saving a
 * local context without a good understanding of how the memory model works
 * will probably lead to memory corruption.
 *
 * You have been warned ...
 */
/*****************************************************************************/

#ifdef SKIP32
char* lcontext = NULL;
#endif
#ifdef SKIP64
__thread char* lcontext = NULL;
#endif

int32_t SKIP_has_local_context() {
  return (int32_t)(lcontext != NULL);
}

void SKIP_set_local_context(char* context) {
  lcontext = context;
}

void SKIP_remove_local_context() {
  lcontext = NULL;
}

char* SKIP_get_local_context() {
  return lcontext;
}

/*****************************************************************************/
/* Primitives that are not used in embedded mode. */
/*****************************************************************************/

void SKIP_Regex_initialize() {}

void SKIP_print_stack_trace() {
  todo();
}
void SKIP_print_last_exception_stack_trace_and_exit() {
  todo();
}
void SKIP_unreachableMethodCall() {
  todo();
}
void SKIP_unreachableWithExplanation() {
  todo();
}

void SKIP_Obstack_vectorUnsafeSet(char** arr, char* x) {
  *arr = x;
}

void SKIP_Obstack_collect(char* dumb1, char** dumb2, SkipInt dumb3) {}

void* SKIP_llvm_memcpy(char* dest, char* val, SkipInt len) {
  return memcpy(dest, val, (size_t)len);
}

/*****************************************************************************/
/* Global context synchronization. */
/*****************************************************************************/

#ifdef SKIP32
static char* local_ctx = NULL;
#endif

#ifdef SKIP64
static __thread char* local_ctx = NULL;
#endif

void SKIP_unsafe_set_local_context(char* obj) {
  local_ctx = obj;
}

void SKIP_unsafe_remove_local_context(char* obj) {
  local_ctx = NULL;
}

char* SKIP_unsafe_get_local_context() {
  if (local_ctx == NULL) {
#ifdef SKIP64
    fprintf(stderr, "Error: local context is not set");
#endif
    SKIP_throw_cruntime(ERROR_LOCAL_CONTEXT_NULL);
  }
  return local_ctx;
}

void SKIP_context_init(char* obj) {
  sk_global_lock();
  char* context = SKIP_intern_shared(obj);
  sk_context_set_unsafe(context);
  sk_global_unlock();
}

void SKIP_unsafe_context_incr_ref_count(char* obj) {
  sk_incr_ref_count(obj);
}

void SKIP_unsafe_free(char* context) {
  sk_global_lock();
  sk_free_root(context);
  sk_global_unlock();
}

void SKIP_global_lock() {
#ifdef SKIP64
  sk_global_lock();
#endif
}

#ifdef SKIP64
extern int sk_is_locked;
#endif

uint32_t SKIP_global_has_lock() {
#ifdef SKIP64
  return (uint32_t)sk_is_locked;
#endif
#ifdef SKIP32
  return 1;
#endif
}

void SKIP_global_unlock() {
#ifdef SKIP64
  sk_global_unlock();
#endif
}

void* SKIP_context_sync_no_lock(uint64_t txTime, char* old_root, char* delta,
                                char* synchronizer, uint32_t sync,
                                char* lockF) {
  char* root = SKIP_context_get_unsafe();
  if (root == NULL) {
#ifdef SKIP64
    fprintf(stderr, "Internal error: you forgot to initialize the context");
#endif
    SKIP_throw_cruntime(ERROR_CONTEXT_NOT_INITIALIZED);
  }
  if (root == delta || old_root == delta) {
// INVALID use of sync, the root should be different
#ifdef SKIP64
    fprintf(stderr, "Internal error: tried to sync with the same context");
#endif
    SKIP_throw_cruntime(ERROR_SYNC_SAME_CONTEXT);
  }
  char* rtmp = SKIP_resolve_context(txTime, root, delta, synchronizer, lockF);
  char* new_root = SKIP_intern_shared(rtmp);
  sk_commit(new_root, sync);
  sk_free_root(old_root);
  sk_free_root(root);
  sk_free_root(root);
  sk_free_external_pointers();
#ifdef CTX_TABLE
  sk_print_ctx_table();
#endif
  sk_incr_ref_count(new_root);
  return new_root;
}

void* SKIP_context_sync(uint64_t txTime, char* old_root, char* delta,
                        char* synchronizer, uint32_t sync, char* lockF) {
  sk_global_lock();
  char* new_root = SKIP_context_sync_no_lock(txTime, old_root, delta,
                                             synchronizer, sync, lockF);
  sk_global_unlock();
  SKIP_call_after_unlock(synchronizer, delta);
  return new_root;
}
