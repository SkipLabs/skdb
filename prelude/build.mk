SCRIPT_DIR:=$(shell dirname $(shell realpath $(firstword $(MAKEFILE_LIST))))
COMP_DIR:=$(shell realpath $(SCRIPT_DIR)/../compiler)

LIB_DIR?=/usr/local/lib

ifdef PROFILE
PRFDEF=$(shell echo $(PROFILE) | tr  '[:lower:]' '[:upper:]')
DEFINITIONS=-D$(PRFDEF)
ifeq ($(PRFDEF),RELEASE)
OLEVEL=-O3
else
ifeq ($(PRFDEF),DEBUG)
OLEVEL=-O0
else
OLEVEL=-O2
endif # ifeq ($(PRFDEF),DEBUG)
endif # ifeq ($(PRFDEF),RELEASE)
else
DEFINITIONS=
OLEVEL=-O2 -g3
endif # ifdef PROFILE

LBT_EXISTS=$(shell [ -e $(LIB_DIR)/libbacktrace.a ] && echo 1 || echo 0 )
COMMONFLAGS=$(OLEVEL) -Werror -Wall -Wextra -Wno-sign-conversion -Wno-sometimes-uninitialized -Wno-c2x-extensions -Wsign-compare -Wextra-semi-stmt
CC64FLAGS=-DSKIP64 $(COMMONFLAGS)

# NB: this MUST be kept in sync with CFILES in compiler/runtime/Makefile
# and CRELFILES in prelude/build_wasm32.mk
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
	runtime/posix.c \
	runtime/native_eq.c \
	runtime/splitmix64.c \
	runtime/xoroshiro128plus.c

NATIVE_RELFILES=\
	runtime/palloc.c\
	runtime/consts.c

ifdef OUT_DIR
BUILD_DIR=$(shell realpath $(OUT_DIR))/
else
BUILD_DIR=$(ROOT_DIR)/build/
endif

CFILES=$(addprefix $(COMP_DIR)/,$(CRELFILES))
NATIVE_FILES=$(addprefix $(COMP_DIR)/,$(NATIVE_RELFILES))

OFILES=$(addprefix $(BUILD_DIR),$(CRELFILES:.c=.o))
ONATIVE_FILES=$(BUILD_DIR)magic.o $(addprefix $(BUILD_DIR),$(NATIVE_RELFILES:.c=.o))

.PHONY: default
default: $(BUILD_DIR)libbacktrace.a $(BUILD_DIR)libskip_runtime64.a
	@echo "skargo:skc-preamble=$(COMP_DIR)/preamble/preamble64.ll"
	@echo "skargo:skc-link-lib=static=skip_runtime64"
	@echo "skargo:skc-link-lib=static=backtrace"
	@echo "skargo:skc-link-lib=pthread"
	@echo "skargo:skc-link-search=$(OUT_DIR)"

$(BUILD_DIR)magic.c:
	@date | cksum | awk '{print "unsigned long version = " $$1 ";"}' > $(BUILD_DIR)magic.c
	@echo "int SKIP_get_version() { return (int)version; }" >> $(BUILD_DIR)magic.c

$(BUILD_DIR)magic.o: $(BUILD_DIR)magic.c
	@echo "skargo:rerun-if-changed=$^"
	@[ -d $(dir $@) ] || mkdir -p $(dir $@)
	@clang $(CC64FLAGS) -o $@ -c $<

$(BUILD_DIR)libskip_runtime64.a: $(OFILES) $(BUILD_DIR)runtime/runtime64_specific.o $(ONATIVE_FILES)
	@ar rcs $@ $^


ifeq ($(LBT_EXISTS), 1)
$(BUILD_DIR)libbacktrace.a:
	cp $(LIB_DIR)/libbacktrace.a $(BUILD_DIR)libbacktrace.a
else
$(BUILD_DIR)libbacktrace.a:
	@[ -d $(BUILD_DIR) ] || mkdir -p $(BUILD_DIR)
	(cd $(COMP_DIR)/runtime/libbacktrace && ./configure) 
	$(MAKE) -C $(COMP_DIR)/runtime/libbacktrace
	cp $(COMP_DIR)/runtime/libbacktrace/.libs/libbacktrace.a $(BUILD_DIR)libbacktrace.a
endif

$(BUILD_DIR)runtime/runtime64_specific.o: $(COMP_DIR)/runtime/runtime64_specific.cpp
	@echo "skargo:rerun-if-changed=$^"
	@[ -d $(dir $@) ] || mkdir -p $(dir $@)
	@clang++ $(CC64FLAGS) -g3 -o $@ -c -I$(COMP_DIR)/runtime/libbacktrace/ $<

$(BUILD_DIR)%.o: $(COMP_DIR)/%.c
	@echo "skargo:rerun-if-changed=$^"
	@[ -d $(dir $@) ] || mkdir -p $(dir $@)
	@clang $(CC64FLAGS) -g3 -o $@ -c $<
