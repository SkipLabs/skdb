CXXFLAGS ?= -O3 -mllvm -inline-threshold=0 # -enable-new-pm=false
SKARGO_PROFILE?=release
STAGE    ?= 1

prefix   ?= /usr/local
exec_prefix ?= $(prefix)
bindir   ?= $(exec_prefix)/bin
libdir   ?= $(exec_prefix)/lib


.PHONY: default
default: stage$(STAGE)

.PHONY: runtime/libskip_runtime64.a
runtime/libskip_runtime64.a:
	$(MAKE) -C runtime $(@F)

.PHONY: runtime/libbacktrace/.libs/libbacktrace.a
runtime/libbacktrace/.libs/libbacktrace.a:
	$(MAKE) -C runtime libbacktrace

.PHONY: runtime/libskip_runtime32.bc
runtime/libskip_runtime32.bc:
	$(MAKE) -C runtime $(@F)

bootstrap/%.ll: bootstrap/%.ll.gz
	gunzip -c $< > $@

stage%:
	mkdir -p $@
	$(MAKE) $@/bin/skc $@/bin/skfmt $@/bin/skargo $@/lib/libskip_runtime64.a $@/lib/libbacktrace.a $@/lib/libskip_runtime32.bc $@/lib/skip_preamble64.ll $@/lib/skip_preamble32.ll

stage%/lib/libskip_runtime64.a: runtime/libskip_runtime64.a
	mkdir -p $(@D)
	cp $< $@

stage%/lib/libbacktrace.a: runtime/libbacktrace/.libs/libbacktrace.a
	mkdir -p $(@D)
	cp $< $@

stage%/lib/libskip_runtime32.bc: runtime/libskip_runtime32.bc
	mkdir -p $(@D)
	cp $< $@

stage%/lib/skip_preamble64.ll: preamble/preamble64.ll
	mkdir -p $(@D)
	cp $< $@

stage%/lib/skip_preamble32.ll: preamble/preamble32.ll
	mkdir -p $(@D)
	cp $< $@

stage0/bin/skargo: bootstrap/skargo_out64.ll stage0/lib/libskip_runtime64.a stage0/lib/libbacktrace.a
	mkdir -p $(@D)
	clang++ -no-pie $(CXXFLAGS) -o $@ $^ -lpthread -g3

stage0/bin/skfmt: bootstrap/skfmt_out64.ll stage0/lib/libskip_runtime64.a stage0/lib/libbacktrace.a
	mkdir -p $(@D)
	clang++ -no-pie $(CXXFLAGS) -o $@ $^ -lpthread -g3

stage0/bin/skc: bootstrap/skc_out64.ll stage0/lib/libskip_runtime64.a stage0/lib/libbacktrace.a
	mkdir -p $(@D)
	clang++ -no-pie $(CXXFLAGS) -o $@ $^ -lpthread -g3

stage1/bin/skc stage1/bin/skfmt stage1/bin/skargo: stage0
	PATH=stage0/bin/:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir stage1/bin
	(cd ../skargo && PATH=../compiler/stage0/bin:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir ../compiler/stage1/bin)

stage2/bin/skc stage2/bin/skfmt stage2/bin/skargo: stage1
	PATH=stage1/bin/:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir stage2/bin
	(cd ../skargo && PATH=../compiler/stage1/bin:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir ../compiler/stage2/bin)

stage3/bin/skc stage3/bin/skfmt stage3/bin/skargo: stage2
	PATH=stage2/bin/:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir stage3/bin
	(cd ../skargo && PATH=../compiler/stage2/bin:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir ../compiler/stage3/bin)
# 	TODO: Ensure stage2 == stage3.

stageA/bin/skc:
	mkdir -p stageA/bin
	cp $(shell command -v skc) stageA/bin/skc

stageA/bin/skargo:
	mkdir -p stageA/bin
	cp $(shell command -v skargo) stageA/bin/skargo

stageA/bin/skfmt:
	mkdir -p stageA/bin
	cp $(shell command -v skfmt) stageA/bin/skfmt

stageB/bin/skc stageB/bin/skfmt stageB/bin/skargo: stageA
	PATH=stageA/bin/:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir stageB/bin
	(cd ../skargo && PATH=../compiler/stageA/bin:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir ../compiler/stageB/bin)

stageC/bin/skc stageC/bin/skfmt stageC/bin/skargo: stageB
	PATH=stageB/bin/:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir stageC/bin
	(cd ../skargo && PATH=../compiler/stageB/bin:$(PATH) skargo build --profile $(SKARGO_PROFILE) --target-dir ../compiler/stageC/bin)

.PHONY: install
install: stage$(STAGE)
	install -d $(libdir)
	install -m 644 stage$(STAGE)/lib/libskip_runtime64.a $(libdir)
	install -m 644 stage$(STAGE)/lib/libbacktrace.a $(libdir)
	install -m 644 stage$(STAGE)/lib/libskip_runtime32.bc $(libdir)
	install -m 644 preamble/preamble64.ll $(libdir)/skip_preamble64.ll
	install -m 644 preamble/preamble32.ll $(libdir)/skip_preamble32.ll
	install -d $(bindir)
	install -m 755 stage$(STAGE)/bin/skc stage$(STAGE)/bin/skfmt stage$(STAGE)/bin/skargo $(bindir)

.PHONY: clean
clean:
	$(MAKE) -C runtime clean
	rm -Rf stage* bootstrap/*.ll

.PHONY: test
test: stage$(STAGE)
	PATH=stage$(STAGE)/bin:$(PATH) skargo test
