#include <cstdint>
#include <iostream>

extern "C" {

extern unsigned char resources_sk_tests_ts[];
extern unsigned int resources_sk_tests_ts_len;

extern unsigned char resources_tests_tar_gz[];
extern unsigned int resources_tests_tar_gz_len;

char* sk_string_create(const char* buffer, uint32_t size);
uint32_t SKIP_String_byteSize(char*);
}

extern "C" {
char* SKIP_sknpm_sk_tests_ts() {
  uint64_t size = resources_sk_tests_ts_len;
  return sk_string_create((char*)resources_sk_tests_ts, size);
}

void SKIP_sknpm_save_sk_tests_ts(char* skTarget) {
  uint64_t size = resources_sk_tests_ts_len;
  std::string target(skTarget, SKIP_String_byteSize(skTarget));
  std::string skTestsFile = target + "/sk_tests.ts";
  FILE* write_ptr = fopen(skTestsFile.c_str(), "w");
  fwrite(resources_sk_tests_ts, size, 1, write_ptr);
  fclose(write_ptr);
}

void SKIP_sknpm_save_archive(char* skTarget) {
  uint64_t size = resources_tests_tar_gz_len;
  std::string target(skTarget, SKIP_String_byteSize(skTarget));
  std::string archiveFile = target + "/tests.tar.gz";
  std::string command = "tar -zxf " + archiveFile + " -C " + target;
  FILE* write_ptr = fopen(archiveFile.c_str(), "wb");
  fwrite((char*)resources_tests_tar_gz, size, 1, write_ptr);
  fclose(write_ptr);
  (void)system(command.c_str());
}
}
