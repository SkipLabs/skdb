#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static unsigned int test_utf8_data[] = {
    126, 240, 157, 152, 136, 225, 184, 134, 240, 157, 150, 162, 240,
    157, 149, 175, 217, 164, 225, 184, 158, 212, 141, 208, 157, 199,
    143, 240, 157, 153, 133, 198, 152, 212, 184, 226, 178, 152, 240,
    157, 153, 137, 224, 167, 166, 206, 161, 240, 157, 151, 164, 201,
    140, 240, 157, 147, 162, 200, 154, 208, 166, 240, 157, 146, 177};

static unsigned char
    string_utf8_buffer[sizeof(test_utf8_data) / sizeof(int) + 1];

int main(int argc, char* argv[]) {
  int i;
  for (i = 0; i < sizeof(string_utf8_buffer); i++) {
    string_utf8_buffer[i] = (unsigned char)test_utf8_data[i];
  }
  printf("CREATE TABLE t1 (a TEXT);\n");
  printf("INSERT INTO t1 values ('%saaa''aaa%s');\n", string_utf8_buffer,
         string_utf8_buffer);
  printf("SELECT * from t1 where a like '%s%%';", string_utf8_buffer);
}
