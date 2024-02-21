ROOT_DIR:=$(shell dirname $(shell realpath $(firstword $(MAKEFILE_LIST))))
COMP_DIR:=$(shell realpath $(ROOT_DIR)/../compiler)

ifdef PROFILE
PRFDEF=$(shell echo $(PROFILE) | tr  '[:lower:]' '[:upper:]')
DEFINITIONS=-D$(PRFDEF)
ifeq ($(PRFDEF),RELEASE)
OLEVEL=-O3
DLEVEL=
else
ifeq ($(PRFDEF),DEBUG)
OLEVEL=-O0
DLEVEL=-g3
else
OLEVEL=-O2
DLEVEL=-g3
endif # ifeq ($(PRFDEF),DEBUG)
endif # ifeq ($(PRFDEF),RELEASE)
else
DEFINITIONS=
OLEVEL=-O2
DLEVEL=-g3
endif # ifdef PROFILE

COMMONFLAGS=$(OLEVEL) -Werror -Wall -Wextra -Wno-sign-conversion -Wno-sometimes-uninitialized -Wno-c2x-extensions -Wsign-compare -Wextra-semi-stmt
CC32FLAGS=-DSKIP32 --target=wasm32 -emit-llvm -nostdlibinc $(COMMONFLAGS)

# NB: this MUST be kept in sync with CFILES in compiler/runtime/Makefile
# and CRELFILES in prelude/build.mk
CRELFILES=\
	runtime/copy.c \
	runtime/free.c \
	runtime/hash.c \
	runtime/hashtable.c \
	runtime/intern.c \
	runtime/memory.c \
	runtime/obstack.c \
	runtime/runtime.c \
	runtime/stdlib.c \
	runtime/stack.c \
	runtime/string.c \
	runtime/native_eq.c \
	runtime/splitmix64.c \
	runtime/xoroshiro128plus.c \
	runtime/runtime32_specific.c

ifdef OUT_DIR
BUILD_DIR=$(shell realpath $(OUT_DIR))/
else
BUILD_DIR=$(ROOT_DIR)/build/
endif

CFILES32=$(addprefix $(COMP_DIR)/,$(CRELFILES))

BCFILES32=$(BUILD_DIR)magic.bc $(addprefix $(BUILD_DIR),$(CRELFILES:.c=.bc))

.PHONY: default
default: $(BUILD_DIR)libskip_runtime32.a
	@echo "skargo:skc-preamble=$(COMP_DIR)/preamble/preamble32.ll"
	@echo "skargo:skc-link-search=$(BUILD_DIR)"
	@echo "skargo:skc-link-lib=static=skip_runtime32"

$(BUILD_DIR)magic.c:
	@date | cksum | awk '{print "unsigned long version = " $$1 ";"}' > $(BUILD_DIR)magic.c
	@echo "int SKIP_get_version() { return (int)version; }" >> $(BUILD_DIR)magic.c

$(BUILD_DIR)magic.bc: $(BUILD_DIR)magic.c
	@[ -d $(dir $@) ] || mkdir -p $(dir $@)
	@clang $(OLEVEL) $(DLEVEL) $(CC32FLAGS) -o $@ -c $<

$(BUILD_DIR)libskip_runtime32.a: $(BUILD_DIR)libskip_runtime32.o
	llvm-ar crs $@ $^

$(BUILD_DIR)libskip_runtime32.bc: $(BCFILES32)
	@[ -d $(dir $@) ] || mkdir -p $(dir $@)
	llvm-link $(BCFILES32) -o $@

%.o: %.bc
	@[ -d $(dir $@) ] || mkdir -p $(dir $@)
	llc -mtriple=wasm32-unknown-unknown $(OLEVEL) -filetype=obj $^ -o $@

$(BUILD_DIR)%.bc: $(COMP_DIR)/%.c
	@[ -d $(dir $@) ] || mkdir -p $(dir $@)
	@clang $(OLEVEL) $(DLEVEL) $(CC32FLAGS) -o $@ -c $<
