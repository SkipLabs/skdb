#include <stddef.h>
#include <stdint.h>

#ifdef SKIP32
void* trace_span = NULL;
#else
__thread void* trace_span = NULL;
#endif

typedef struct sk_session {
  int64_t low;
  int64_t high;
} sk_session_t;

extern sk_session_t* psession;

uint64_t SKIP_persistent_size();
uint64_t SKIP_freetable_size();
uint64_t SKIP_obstack_peak();
uint64_t SKIP_Obstack_size(void* saved);

void* SKIP_SKMonitor_createTime(uint64_t s, uint64_t ns);
void* SKIP_SKMonitor_createMemory(uint64_t p, uint64_t f, uint64_t o);
char* sk_string_create(const char* buffer, uint32_t size);

void SKIP_SKMonitor_set_span(void* span) {
  trace_span = span;
}

void* SKIP_SKMonitor_get_span() {
  return trace_span;
}

void* SKIP_SKMonitor_memory() {
  return SKIP_SKMonitor_createMemory(
      SKIP_persistent_size(), SKIP_freetable_size(), SKIP_obstack_peak());
}

int64_t SKIP_SKMonitor_get_session_low() {
  return psession->low;
}

int64_t SKIP_SKMonitor_get_session_high() {
  return psession->high;
}

char* SKIP_SKMonitor_uint64_to_string(uint64_t val) {
  char buffer[21];
  char* ndx = &buffer[sizeof(buffer) - 1];
  int size = 0;
  *ndx = '\0';
  do {
    *--ndx = val % 10 + '0';
    val = val / 10;
    size++;
  } while (val != 0);
  return sk_string_create(ndx, size);
}

uint64_t SKIP_SKMonitor_get_trace_size(void* saved) {
  return SKIP_Obstack_size(saved);
}
