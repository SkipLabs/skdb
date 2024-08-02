{
  "targets": [
    {
      "target_name": "skstore",
      "sources": [
        "src/skstore.cc",
        "src/skwatcher.cc",
        "src/sktable.cc",
        "src/skthandle.cc",
        "src/sklhandle.cc",
        "src/skehandle.cc",
        "src/skiterator.cc",
        "src/skjson_utils.cc",
        "src/skjson_object.cc",
        "src/skjson_array.cc",
        "src/skcommon.cc"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "libraries": ["~/.skstore/libskstore.so"]
    }
  ]
}