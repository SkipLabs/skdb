OUT_DIR?=$(shell realpath ./build)
LIB_DIR?=/usr/local/lib

OLEVEL ?= -O2

ifdef PROFILE
PRFDEF=$(shell echo $(PROFILE) | tr  '[:lower:]' '[:upper:]')
ifeq ($(PRFDEF),RELEASE)
OLEVEL = -O3
else
ifeq ($(PRFDEF),DEBUG)
OLEVEL = -O0
endif # ifeq ($(PRFDEF),DEBUG)
endif # ifeq ($(PRFDEF),RELEASE)
endif # ifdef PROFILE
OLEVEL ?= -O2
CFLAGS += $(OLEVEL) -g3

LBT_EXISTS=$(shell [ -e $(LIB_DIR)/libbacktrace.a ] && echo 1 || echo 0 )

SKIP_SRC=$(shell find src/ -name '*.sk')

.PHONY: default
default: $(OUT_DIR)/libbacktrace.a $(OUT_DIR)/libskip_runtime64.a preamble/preamble64.ll
	@echo "skargo:skc-preamble=preamble/preamble64.ll"
	@echo "skargo:skc-link-lib=$(OUT_DIR)/libskip_runtime64.a"
	@echo "skargo:skc-link-lib=$(OUT_DIR)/libbacktrace.a"
	@echo "skargo:skc-link-arg=-lpthread"

.PHONY: wasm
wasm: $(OUT_DIR)/libskip_runtime32.a preamble/preamble32.ll
	@echo "skargo:skc-preamble=preamble/preamble32.ll"
	@echo "skargo:skc-link-lib=$(OUT_DIR)/libskip_runtime32.a"

.PHONY: bootstrap
bootstrap: $(OUT_DIR)/libstd.sklib

.PHONY: $(OUT_DIR)/libbacktrace.a
ifeq ($(LBT_EXISTS), 1)
$(OUT_DIR)/libbacktrace.a:
	@[ -d $(OUT_DIR) ] || mkdir -p $(OUT_DIR)
	cp $(LIB_DIR)/libbacktrace.a $@
else
CFLAGS += -I$(realpath libbacktrace)

libbacktrace/Makefile:
	test -f libbacktrace/configure || (echo "Warning: libbacktrace submodule not initialized" && false)
	(cd libbacktrace && CC=clang ./configure)

$(OUT_DIR)/libbacktrace.a: libbacktrace/Makefile
	@[ -d $(OUT_DIR) ] || mkdir -p $(OUT_DIR)
	$(MAKE) -C libbacktrace
	cp libbacktrace/.libs/libbacktrace.a $@
endif

.PHONY: $(OUT_DIR)/libskip_runtime64.a
$(OUT_DIR)/libskip_runtime64.a:
	@[ -d $(OUT_DIR) ] || mkdir -p $(OUT_DIR)
	CFLAGS="$(CFLAGS)" $(MAKE) -C runtime/ libskip_runtime64.a
	cp runtime/libskip_runtime64.a $@

.PHONY: $(OUT_DIR)/libskip_runtime32.bc
$(OUT_DIR)/libskip_runtime32.bc:
	@[ -d $(OUT_DIR) ] || mkdir -p $(OUT_DIR)
	CFLAGS="$(CFLAGS)" $(MAKE) -C runtime/ libskip_runtime32.bc
	cp runtime/libskip_runtime32.bc $@

$(OUT_DIR)/libskip_runtime32.o: $(OUT_DIR)/libskip_runtime32.bc
	@[ -d $(OUT_DIR) ] || mkdir -p $(OUT_DIR)
	llc -mtriple=wasm32-unknown-unknown -O2 -filetype=obj $^ -o $@

$(OUT_DIR)/libskip_runtime32.a: $(OUT_DIR)/libskip_runtime32.o
	@[ -d $(OUT_DIR) ] || mkdir -p $(OUT_DIR)
	llvm-ar crs $@ $^

$(OUT_DIR)/libstd.sklib: $(OUT_DIR)/libskip_runtime64.a $(OUT_DIR)/libbacktrace.a $(SKIP_SRC)
	SKC_PREAMBLE=./preamble/preamble64.ll skc -o $@ --sklib-name std --no-std $(OLEVEL) --link-args '-lpthread' $^

.PHONY: clean
clean:
	rm -f $(OUT_DIR)/libbacktrace.a $(OUT_DIR)/libskip_runtime64.a $(OUT_DIR)/libstd.sklib
	$(MAKE) -C runtime clean
	(test ! -f libbacktrace/Makefile && echo "Warning: libbacktrace submodule or Makefile not initialized") || $(MAKE) -C libbacktrace distclean
	find . -name 'Skargo.toml' -print0 | sed 's|Skargo.toml|target|g' | xargs -0 rm -rf
