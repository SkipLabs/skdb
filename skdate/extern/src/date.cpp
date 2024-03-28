

#include <langinfo.h>
#include <string.h>
#include <sys/time.h>

#include <chrono>
#include <cstdint>
#include <ctime>
#include <iomanip>
#include <sstream>

extern "C" {

uint32_t SKIP_String_byteSize(char*);
char* sk_string_create(const char* buffer, uint32_t size);

/**
 * Retrieves the local version of variables required for formatting using format
 * specifier. A => Full weekday name. a => Abbreviated weekday name. B => Full
 * month name. b => Abbreviated month name. c => Date/Time format string of the
 * locale. x => Date format string of the locale. X => Time format string of the
 * locale. r => AM/PM Time format string of the locale. p => AM or PM locale
 * string.
 */
char* SKIP_locale(u_int32_t code, int32_t value) {
  char c = (char)code;
  const char* locale;
  if (c == 'c') {
    locale = nl_langinfo(D_T_FMT);
  } else if (c == 'x') {
    locale = nl_langinfo(D_FMT);
  } else if (c == 'X') {
    locale = nl_langinfo(T_FMT);
  } else if (c == 'r') {
    locale = nl_langinfo(T_FMT_AMPM);
  } else if (c == 'p' && value == 0) {
    locale = nl_langinfo(AM_STR);
  } else if (c == 'p' && value == 1) {
    locale = nl_langinfo(PM_STR);
  } else if (c == 'A') {
    locale = nl_langinfo(DAY_1 + (value % 7));
  } else if (c == 'a') {
    locale = nl_langinfo(ABDAY_1 + (value % 7));
  } else if (c == 'B') {
    locale = nl_langinfo(MON_1 + ((value - 1) % 12));
  } else if (c == 'b') {
    locale = nl_langinfo(ABMON_1 + ((value - 1) % 12));
  } else {
    char tmp[] = {'%', '%', c};
    locale = tmp;
  }
  return sk_string_create(locale, strlen(locale));
}

void localefor(struct tm* local, uint32_t year, uint32_t month, uint32_t day) {
  struct tm tm_info;
  tm_info.tm_year = year - 1900;
  tm_info.tm_mon = month - 1;
  tm_info.tm_mday = day;
  tm_info.tm_hour = 0;
  tm_info.tm_min = 0;
  tm_info.tm_sec = 0;
  tm_info.tm_isdst = -1;
  time_t t = mktime(&tm_info);
  localtime_r(&t, local);
}

int32_t SKIP_localetimezone(uint32_t year, uint32_t month, uint32_t day) {
  struct tm local;
  localefor(&local, year, month, day);
  return (int32_t)local.tm_gmtoff;
}

int64_t SKIP_currenttimemillis() {
  timeval curTime;
  gettimeofday(&curTime, 0);
  return std::time(0) * 1000 + curTime.tv_usec / 1000;
}

char* SKIP_localetimezonename(uint32_t year, uint32_t month, uint32_t day) {
  char buffer[32];
  struct tm local;
  localefor(&local, year, month, day);
  size_t size = strftime(buffer, sizeof(buffer), "%Z", &local);
  return sk_string_create(buffer, size);
}
}
