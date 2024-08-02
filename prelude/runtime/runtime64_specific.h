#ifndef SKIP_RUNTIME_64
#define SKIP_RUNTIME_64

#include <iostream>
#include <sstream>

namespace skruntime {

class Logger {
 public:
  virtual ~Logger() = 0;
  virtual void print(char*) = 0;
  virtual void println() = 0;
  virtual void error(char*) = 0;
  virtual void errorln() = 0;
  virtual void flush(bool) = 0;
  virtual std::string out() = 0;
  virtual __attribute__((noreturn)) void exit(int) = 0;
};

class BufferedLogger : public Logger {
 public:
  inline BufferedLogger() : m_out(), m_err() {}
  ~BufferedLogger() {}
  __attribute__((noreturn)) void exit(int);
  inline void print(char* msg) {
    m_out << msg;
  }
  inline void println() {
    m_out << std::endl;
  }
  inline void error(char* msg) {
    m_err << msg;
  }
  inline void errorln() {
    m_err << std::endl;
  }
  inline void flush(bool toIO) {
    if (toIO) {
      std::cout << m_out.str();
      m_out.clear();
      std::cout.flush();
      std::cerr << m_err.str();
      m_err.clear();
      std::cerr.flush();
    }
  }

  inline std::string out() {
    return m_out.str();
  }

 private:
  std::ostringstream m_out;
  std::ostringstream m_err;
};

}  // namespace skruntime

#endif