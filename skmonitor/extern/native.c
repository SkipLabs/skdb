#include <ctype.h>
#include <stdio.h>
#include <time.h>

__thread char* trace_path = NULL;

void* SKIP_SKMonitor_createTime(__uint64_t s, __uint64_t ns);

void* SKIP_SKMonitor_now() {
  struct timespec now;
  timespec_get(&now, TIME_UTC);
  return SKIP_SKMonitor_createTime(now.tv_sec, now.tv_nsec);
}

void SKIP_SKMonitor_move(char* from, char* to) {
  rename(from, to);
}