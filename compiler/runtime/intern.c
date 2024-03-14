#include "runtime.h"
#ifdef SKIP64
#include <stdlib.h>
#endif

/*****************************************************************************/
/* Pointer to the type of external pointers. */
/*****************************************************************************/

SKIP_gc_type_t* epointer_ty = NULL;

#ifdef SKIP32
char sk_dirty_pages[PERSISTENT_TABLE_SIZE];
extern unsigned char* bump_pointer;
extern void** sk_ftable;

int32_t sk_dirty_pages_stack[PERSISTENT_TABLE_SIZE];
int32_t sk_dirty_pages_stack_idx = 0;

void sk_persistent_write(char* addr, size_t size) {
  while (1) {
    int32_t page_id = ((uint32_t)addr) >> PERSISTENT_PAGE_BIT_SIZE;
    if (sk_dirty_pages[page_id] == 0) {
      sk_dirty_pages[page_id] = 1;
      sk_dirty_pages_stack[sk_dirty_pages_stack_idx] = page_id;
      sk_dirty_pages_stack_idx++;
    }
    if (size > PERSISTENT_PAGE_SIZE) {
      addr += PERSISTENT_PAGE_SIZE;
      size -= PERSISTENT_PAGE_SIZE;
    } else {
      addr += size;
      size = 0;
      if ((((uint32_t)addr) >> PERSISTENT_PAGE_BIT_SIZE) == page_id) {
        return;
      }
    }
  }
}

int32_t sk_pop_dirty_page() {
  if (sk_dirty_pages_stack_idx > 0) {
    int32_t result = sk_dirty_pages_stack[sk_dirty_pages_stack_idx - 1];
    sk_dirty_pages[result] = 0;
    sk_dirty_pages_stack_idx--;
    return result;
  }
  //  sk_print_int((uint32_t)bump_pointer);
  return -1;
}

#endif

/*****************************************************************************/
/* Interning primitives. */
/*****************************************************************************/

static char* shallow_intern(char* obj, size_t memsize, size_t leftsize) {
  memsize += leftsize;
  size_t alloc_size = memsize + sizeof(uintptr_t);
  char* mem = sk_palloc(alloc_size);
  *(uintptr_t*)mem = 1;
  mem += sizeof(uintptr_t);
  memcpy(mem, obj - leftsize, memsize);
  mem = mem + leftsize;
#ifdef SKIP32
  sk_persistent_write(mem, memsize);
#endif
  return mem;
}

static uintptr_t* sk_get_ref_count_addr(void* obj) {
  uintptr_t* count = obj;
  if (SKIP_is_string(obj)) {
#ifdef SKIP64
    count -= 2;
#endif
#ifdef SKIP32
    count -= 3;
#endif
  } else {
    SKIP_gc_type_t* ty = get_gc_type(obj);

    switch (ty->m_kind) {
      case 0:
        count -= 2;
        break;
      case 1:
        count -= 3;
        break;
      default:
        SKIP_exit(-1);
    }
  }
#ifdef SKIP64
  if ((*count & 0x80000000) != 0) {
    fprintf(stderr, "bit 31 of ref count set: *%p = %lu\n", count, *count);
    abort();
    SKIP_exit(65);
  }
#endif
  return count;
}

void sk_incr_ref_count(void* obj) {
#ifdef SKIP32
  sk_persistent_write(obj, 0);
#endif
  uintptr_t* count = sk_get_ref_count_addr(obj);
  *count = *count + 1;
}

uintptr_t sk_decr_ref_count(void* obj) {
#ifdef SKIP32
  sk_persistent_write(obj, 0);
#endif
  uintptr_t* count = sk_get_ref_count_addr(obj);
  *count = *count - 1;
  return *count;
}

uintptr_t sk_get_ref_count(void* obj) {
  uintptr_t* count = sk_get_ref_count_addr(obj);
  return *count;
}

static char* SKIP_intern_class(sk_stack_t* st, char* obj) {
  SKIP_gc_type_t* ty = get_gc_type(obj);

  size_t memsize = ty->m_userByteSize;
  size_t leftsize = ty->m_uninternedMetadataByteSize;
  void** result = (void**)shallow_intern(obj, memsize, leftsize);

  if (epointer_ty != NULL && ty != epointer_ty &&
      (ty->m_refsHintMask & 1) != 0) {
    size_t size = ty->m_userByteSize / sizeof(void*);
    size_t bitsize = sizeof(void*) * 8;
    size_t slot = 0;
    size_t mask_slot = 0;
    int i;
    while (size > 0) {
      for (i = 0; i < bitsize && i < size; i++) {
        if (ty->m_refMask[mask_slot] & (1 << i)) {
          void** ptr = ((void**)obj) + (mask_slot * bitsize) + i;
          void** slot = result + (mask_slot * bitsize) + i;
          if (*ptr != NULL) {
            sk_stack_push(st, ptr, slot);
          }
        }
      };
      if (size < bitsize) {
        break;
      }
      size -= bitsize;
      mask_slot++;
    }
  }

  return (char*)result;
}

static char* SKIP_intern_array(sk_stack_t* st, char* obj) {
  SKIP_gc_type_t* ty = get_gc_type(obj);

  size_t len = *(uint32_t*)(obj - sizeof(char*) - sizeof(uint32_t));
  size_t memsize = ty->m_userByteSize * len;
  size_t leftsize = ty->m_uninternedMetadataByteSize;
  void** result = (void**)shallow_intern(obj, memsize, leftsize);
  size_t bitsize = sizeof(void*) * 8;

  if ((ty->m_refsHintMask & 1) != 0) {
    char* rhead = (char*)result;
    char* ohead = obj;
    char* end = obj + memsize;

    while (ohead < end) {
      size_t size = ty->m_userByteSize;
      size_t slot = 0;
      size_t mask_slot = 0;
      while (size > 0) {
        int i;
        for (i = 0; i < bitsize && size > 0; i++) {
          if (ty->m_refMask[mask_slot] & (1 << i)) {
            void** ptr = (void**)ohead;
            void** slot = (void**)rhead;
            if (*ptr != NULL) {
              sk_stack_push(st, ptr, slot);
            }
          }
          ohead += sizeof(void*);
          rhead += sizeof(void*);
          size -= sizeof(void*);
        };
        mask_slot++;
      }
    }
  }

  return (char*)result;
}

static char* SKIP_intern_string(char* obj) {
  size_t len = get_sk_string(obj)->size;
  char* result = shallow_intern(obj, len, sk_string_header_size);
  return result;
}

static char* SKIP_intern_obj(sk_stack_t* st, char* obj) {
  char* result;

  SKIP_gc_type_t* ty = get_gc_type(obj);

  switch (ty->m_kind) {
    case 0:
      result = SKIP_intern_class(st, obj);
      break;
    case 1:
      result = SKIP_intern_array(st, obj);
      break;
    default:
      // NOT SUPPORTED
      SKIP_exit(-1);
  }

  return (char*)result;
}

void* SKIP_intern_shared(void* obj) {
  if (obj == NULL) {
    return NULL;
  }

  sk_stack_t st_holder;
  sk_stack_t* st = &st_holder;
  sk_stack3_t st3_holder;
  sk_stack3_t* st3 = &st3_holder;
  size_t nbr_pages = sk_get_nbr_pages(NULL);
  sk_cell_t* pages = sk_get_pages(nbr_pages);
  int* large_pages = sk_malloc(sizeof(int) * nbr_pages);

  for (int i = 0; i < nbr_pages; i++) {
    large_pages[i] = 0;
  }

  sk_stack_init(st, STACK_INIT_CAPACITY);
  sk_stack3_init(st3, STACK_INIT_CAPACITY);

  void* result = obj;
  sk_stack_push(st, &obj, &result);

  while (st->head > 0) {
    sk_value_t delayed = sk_stack_pop(st);
    void* toCopy = *delayed.value;
    size_t obstack_idx = sk_get_obstack_idx(toCopy, pages, nbr_pages);

    if (obstack_idx >= nbr_pages) {
      if (!sk_is_static(toCopy)) {
        sk_incr_ref_count(toCopy);
      }

      continue;
    }

    if (sk_is_large_page(pages[obstack_idx].key)) {
      large_pages[obstack_idx] = 1;
    }

    void* interned_ptr;

    if (SKIP_is_string(toCopy)) {
      sk_string_t* str = get_sk_string(toCopy);
      // mark already-copied strings by setting size to -1
      if (str->size != -1 && str->size < sizeof(void*)) {
        void* interned_ptr = SKIP_intern_string(toCopy);
        *delayed.slot = interned_ptr;
        continue;
      }

      if (str->size == (uint32_t)-1) {
        void* interned_ptr = *(void**)toCopy;
        *delayed.slot = interned_ptr;
        sk_incr_ref_count(interned_ptr);
        continue;
      }
      void* interned_ptr = SKIP_intern_string(toCopy);
      sk_stack3_push(st3, (void**)toCopy, *(void**)toCopy,
                     (void*)(uintptr_t)(str->size));
      str->size = (uint32_t)-1;
      *(void**)toCopy = interned_ptr;
      *delayed.slot = interned_ptr;
      continue;
    }

    void** vtable_ptr = get_vtable_ptr(toCopy);
    // mark already-copied objects by replacing their vtable pointer with a
    // forwarding pointer to the copied object, with the lsb set to
    // distinguish it from vtable pointers
    if (((uintptr_t)*vtable_ptr & 1) == 0) {
      interned_ptr = SKIP_intern_obj(st, toCopy);
      sk_stack3_push(st3, vtable_ptr, *vtable_ptr, NULL);
      *vtable_ptr = (void*)((uintptr_t)interned_ptr | 1);
    } else {
      interned_ptr = (void*)((uintptr_t)*vtable_ptr & ~1);
      sk_incr_ref_count(interned_ptr);
    }

    *delayed.slot = interned_ptr;
  }

  while (st3->head > 0) {
    sk_value3_t cell = sk_stack3_pop(st3);
    void** toClean = cell.value1;
    *toClean = cell.value2;
    if (cell.value3 != NULL) {
      sk_string_t* str = get_sk_string(cell.value1);
      str->size = (uint32_t)(uintptr_t)cell.value3;
    }
  }

  for (int i = 0; i < nbr_pages; i++) {
    if (large_pages[i]) {
      pages[i].value = (uint64_t)pages[i].key;
    }
  }

  sk_free_size(pages, sizeof(sk_cell_t) * nbr_pages);
  sk_free_size(large_pages, sizeof(int) * nbr_pages);
  sk_stack_free(st);
  sk_stack3_free(st3);

  return result;
}

void* SKIP_intern(void* obj) {
  return sk_new_const(obj);
}

sk_list_t* sk_external_pointers = NULL;

void* SKIP_create_external_pointer(void* obj) {
  sk_global_lock();

  void* result = SKIP_intern_shared(obj);

  sk_list_t* l = (sk_list_t*)sk_malloc(sizeof(sk_list_t));
  l->head = result;
  l->tail = sk_external_pointers;
  sk_external_pointers = l;

  sk_global_unlock();

  return result;
}
