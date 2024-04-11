# this builds the artifacts of this repository, orchestrating the
# various build systems

.PHONY: all
all: npm build/skdb build/init.sql

PLAYWRIGHT_REPORTER?="line"
SKARGO_PROFILE?=release
SKDB_WASM=sql/target/wasm32-unknown-unknown/$(SKARGO_PROFILE)/skdb.wasm
SKDB_BIN=sql/target/host/$(SKARGO_PROFILE)/skdb
SKNPM_BIN=sknpm/target/host/$(SKARGO_PROFILE)/sknpm
SDKMAN_DIR?=$(HOME)/.sdkman
SKDB_METRICS?=$(shell realpath ./sql/monitoring/metrics.json)

ifndef PLAYWRIGHT_JUNIT_OUTPUT_NAME
SKNPM_FLAG=
else
SKNPM_FLAG=--junitxml $(PLAYWRIGHT_JUNIT_OUTPUT_NAME)
endif # ifndef PLAYWRIGHT_JUNIT_OUTPUT_NAME

################################################################################
# skdb wasm + js client
################################################################################

.PHONY: npm
npm: $(SKDB_WASM) build/package/skdb build/package/package.json
	cd build/package && npm install

build/package/package.json:
	@echo "{" > build/package/package.json
	@echo "  \"dependencies\": {" >> build/package/package.json
	@echo "      \"skdb\": \"file:skdb\"" >> build/package/package.json
	@echo "  }" >> build/package/package.json
	@echo "}" >> build/package/package.json

build/package/skdb: build/sknpm
	cd sql && ../build/sknpm build --profile $(SKARGO_PROFILE)  --bin skdb --out-dir ../build/package/skdb

sql/target/wasm32-unknown-unknown/dev/skdb.wasm: sql/src/*
	cd sql && skargo build --target wasm32-unknown-unknown --bin skdb

sql/target/wasm32-unknown-unknown/release/skdb.wasm: sql/src/*
	cd sql && skargo build --release --target wasm32-unknown-unknown --bin skdb

$(SDKMAN_DIR):
	cd $(dirname $(SDKMAN_DIR)) && sh -c 'wget -q -O- "https://get.sdkman.io?rcupdate=false" | bash'

################################################################################
# sknpm native binary
################################################################################

sknpm/target/host/dev/sknpm: sknpm/src/* skargo/src/* prelude/src/*
	cd sknpm && skargo build

sknpm/target/host/release/sknpm: sknpm/src/* skargo/src/* prelude/src/*
	cd sknpm && skargo build --release --bin sknpm

build/sknpm: $(SKNPM_BIN)
	mkdir -p build
	cp $^ $@

################################################################################
# skdb native binary
################################################################################

sql/target/host/dev/skdb: sql/src/* prelude/src/**/*.sk skdate/src/* skjson/src/* sqlparser/src/*
	cd sql && skargo build

sql/target/host/release/skdb: sql/src/* prelude/src/**/*.sk skdate/src/* skjson/src/* sqlparser/src/*
	cd sql && skargo build --release --bin skdb

# TODO: keeping this for now as nearly all test scripts refer to build/skdb
build/skdb: $(SKDB_BIN)
	mkdir -p build
	cp $^ $@

################################################################################
# skdb server
################################################################################

build/init.sql: sql/privacy/init.sql
	mkdir -p build
	cp $^ $@

################################################################################
# dev workflow orchestration
################################################################################

CHECK_TARGETS=$(patsubst %/Skargo.toml,check-%,$(shell ls -1 */Skargo.toml))

check-%:
	cd $* && skargo check

.PHONY: check
check: $(CHECK_TARGETS)

.PHONY: clean
clean:
	rm -Rf build
	find . -name 'Skargo.toml' -print0 | sed 's|Skargo.toml|target|g' | xargs -0 rm -rf

.PHONY: fmt-sk
fmt-sk:
	find . -path ./compiler/tests -not -prune -or -name \*.sk | parallel skfmt -i {}

.PHONY: fmt-c
fmt-c:
	find . -path ./prelude/libbacktrace -not -prune -or -path ./sql/test/TPC-h/tnt-tpch -not -prune -or -regex '.*\.[ch]\(pp\)*' | parallel clang-format -i {}

.PHONY: fmt-js
fmt-js:
	npx prettier --log-level warn --write .

.PHONY: fmt
fmt: fmt-sk fmt-c fmt-js

.PHONY: check-fmt
check-fmt: fmt
	if ! git diff --quiet --exit-code; then echo "make fmt changed some files:"; git status --porcelain; exit 1; fi

# run the docs site locally at http://localhost:3000
.PHONY: run-docs
run-docs:
	cd skipruntime-ts/ts/src && bun install
	cd www && npm run start

# regenerate api docs served by run-docs from ts sources
.PHONY: docs
docs:
	cd skipruntime-ts/ts/src && bun install
	cd www && npx docusaurus generate-typedoc

# install the repo pre-commit hook locally
.git/hooks/pre-commit: bin/git_hooks/check_format.sh
	ln -s $(PWD)/bin/git_hooks/check_format.sh .git/hooks/pre-commit

.PHONY: setup-git-hooks
setup-git-hooks: .git/hooks/pre-commit


# test targets

.PHONY: test
test:
	$(MAKE) --keep-going SKARGO_PROFILE=dev SKDB_WASM=sql/target/wasm32-unknown-unknown/dev/skdb.wasm SKDB_BIN=sql/target/host/dev/skdb sktest-prelude test-native tstest-sql tstest-skipruntime-ts

.PHONY: test-native
test-native: build/skdb
	cd sql/ && SKARGO_PROFILE=$(SKARGO_PROFILE) ./test_sql.sh \
	|tee /tmp/native-test.out ; \
	! grep -v '\*\|^[[:blank:]]*$$\|OK\|PASS' /tmp/native-test.out

.PHONY: test-client
test-client: build/sknpm
	cd sql && ../build/sknpm test --profile $(SKARGO_PROFILE) $(SKNPM_FLAG) client

.PHONY: test-replication
test-replication: build/skdb
	./sql/test/replication/test_pk.py
	./sql/test/replication/test_no_pk.py

.PHONY: test-tpc
test-tpc: test
	@echo ""
	@echo "*******************************************************************************"
	@echo "* TPC-H *"
	@echo "*******************************************************************************"
	@echo ""
	@cd sql/test/TPC-h/ && ./test_tpch.sh

.PHONY: test-soak-priv
test-soak-priv: $(SKNPM_BIN) build/skdb build/init.sql npm
	./sql/server/test/test_soak.sh

.PHONY: test-soak
test-soak:
	$(MAKE) SKARGO_PROFILE=release test-soak-priv

# run targets

.PHONY: run-dev-server
run-dev-server: sql/target/host/dev/skdb build/init.sql
	mkdir -p build
	cp sql/target/host/dev/skdb build
	(cd sql/server/dev && gradle --console plain run)

# useful for testing in a browser
build/index.html: sql/js/index.html
	mkdir -p build
	cp $^ $@

.PHONY: check-vite
check-vite: npm
	rm -rf build/vitejs
	cp -r sql/ts/vitejs build/vitejs
	cd build/vitejs && npm install;
	rm -r build/vitejs/node_modules/skdb
	cp -r build/package/skdb build/vitejs/node_modules/
	cd build/vitejs && npm run build
	cd build/vitejs && node server.js
	cd build/vitejs && npm run dev

.PHONY: test-bun
test-bun: npm
	rm -rf build/bun
	cp -r sql/ts/bun build/bun
	cd build/bun && bun install;
	rm -r build/bun/node_modules/skdb
	cp -r build/package/skdb build/bun/node_modules/
	cd build/bun && bun bun.js true && bun bun.js false

exbuild-%:
	cd skipruntime-ts && make build-$*

exrun-%:
	cd skipruntime-ts && make bunrun-$*

excheck-%:
	cd skipruntime-ts && make check-$*

nexrun-%:
	cd skipruntime-ts && make noderun-$*

explay-%:
	cd skipruntime-ts && make bunplay-$*

nexplay-%:
	cd skipruntime-ts && make nodeplay-$*

skcheck-%:
	cd $* && skargo c --profile $(SKARGO_PROFILE)

skfmt-%:
	cd $* && skargo fmt

sktest-%:
	cd $* && skargo test --profile $(SKARGO_PROFILE)

skbuild-%:
	cd $* && skargo b --profile $(SKARGO_PROFILE)

tstest-%: build/sknpm
	cd $* && ../build/sknpm test --profile $(SKARGO_PROFILE) $(SKNPM_FLAG)


.PHONY: build-collector
build-collector: $(SDKMAN_DIR)
	bash -c 'source $(HOME)/.sdkman/bin/sdkman-init.sh && cd skmonitor/kotlin && gradle --console plain build'

build/skmonitor.jar: build-collector skmonitor/kotlin/collector/build/libs/collector.jar
	mkdir -p build
	cp skmonitor/kotlin/collector/build/libs/collector.jar $@

.PHONY: collect
collect: build/skmonitor.jar $(eval MPROCESSES:=$(shell bash -c 'source $(HOME)/.sdkman/bin/sdkman-init.sh && jps' | grep skmonitor.jar | awk '{print $$1}'))
ifeq ($(MPROCESSES),)
	bash -c 'source $(HOME)/.sdkman/bin/sdkman-init.sh && java -jar $^ $(SKDB_METRICS) &'
else
	@echo "Already running."
endif

.PHONY: stop-collecting
stop-collecting: $(eval MPROCESSES:=$(shell bash -c 'source $(HOME)/.sdkman/bin/sdkman-init.sh && jps' | grep skmonitor.jar | awk '{print $$1}'))
ifneq ($(MPROCESSES),)
	kill $(MPROCESSES)
endif

## Backward Compatibility

.PHONY: test-wasm
test-wasm: tstest-sql

.PHONY: test-skfs
test-skfs: sktest-prelude



