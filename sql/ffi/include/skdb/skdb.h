#ifndef __SKDB_H
#define __SKDB_H

#include <stdint.h>

extern "C" {
typedef int64_t SkipInt;

extern void (*SKIP_clear_field_names_ptr)();
extern void (*SKIP_push_field_name_ptr)(char*);
extern void (*SKIP_clear_object_ptr)();
extern void (*SKIP_push_object_field_null_ptr)();
extern void (*SKIP_push_object_field_int32_ptr)(int32_t);
extern void (*SKIP_push_object_field_int64_ptr)(char*);
extern void (*SKIP_push_object_field_float_ptr)(char*);
extern void (*SKIP_push_object_field_string_ptr)(char*);
extern void (*SKIP_push_object_ptr)();

char* sk_string_create(const char* buffer, uint32_t size);
void* SKIP_new_Obstack();
void SKIP_destroy_Obstack(void*);

SkipInt skdb_exec(char* query);
}

#endif  // __SKDB_H
