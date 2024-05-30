#include <dlfcn.h>
#include <pybind11/pybind11.h>
#include <skdb/skdb.h>

#include <cstdlib>
#include <vector>

namespace py = pybind11;

namespace pyskdb {
struct ResultBuilder {
  std::vector<std::string> field_names;
  int objectIdx = 0;
  py::dict object;
  py::list objects;
};

ResultBuilder* result = nullptr;

void clear_field_names() {
  result->field_names.clear();
}

void push_field_name(char* field_name) {
  result->field_names.push_back(std::string(field_name));
}

void clear_object() {
  result->object = py::dict();
  result->objectIdx = 0;
}

void push_object_field_null() {
  result->object[py::str(result->field_names[result->objectIdx++])] =
      py::none();
}

void push_object_field_int32(int32_t val) {
  result->object[py::str(result->field_names[result->objectIdx++])] = val;
}

void push_object_field_int64(char* val) {
  result->object[py::str(result->field_names[result->objectIdx++])] = atol(val);
}

void push_object_field_float(char* val) {
  result->object[py::str(result->field_names[result->objectIdx++])] = atof(val);
}

void push_object_field_string(char* val) {
  result->object[py::str(result->field_names[result->objectIdx++])] =
      std::string(val);
}

void push_object() {
  result->objects.append(result->object);
}
}  // namespace pyskdb

PYBIND11_MODULE(skdb, m) {
  SKIP_clear_field_names_ptr = &pyskdb::clear_field_names;
  SKIP_push_field_name_ptr = &pyskdb::push_field_name;
  SKIP_clear_object_ptr = &pyskdb::clear_object;
  SKIP_push_object_field_null_ptr = &pyskdb::push_object_field_null;
  SKIP_push_object_field_int32_ptr = &pyskdb::push_object_field_int32;
  SKIP_push_object_field_int64_ptr = &pyskdb::push_object_field_int64;
  SKIP_push_object_field_float_ptr = &pyskdb::push_object_field_float;
  SKIP_push_object_field_string_ptr = &pyskdb::push_object_field_string;
  SKIP_push_object_ptr = &pyskdb::push_object;

  m.doc() = R"pbdoc(
    Skdb -- The reactive database
    -----------------------------

    .. currentmodule:: skdb

    .. autosummary::
      :toctree: _generate

      exec
  )pbdoc";

  m.def(
      "exec",
      [](std::string query) {
        pyskdb::result = new pyskdb::ResultBuilder();
        void* obstack = SKIP_new_Obstack();
        char* sk_query = sk_string_create(query.c_str(), query.length());
        skdb_exec(sk_query);
        SKIP_destroy_Obstack(obstack);

        auto res = std::move(pyskdb::result->objects);
        delete pyskdb::result;
        return res;
      },
      py::return_value_policy::copy,
      R"pbdoc(
    Execute a query

    TODO
  )pbdoc");

  m.attr("__version__") = "TODO";
}
