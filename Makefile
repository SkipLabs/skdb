# this builds the artifacts of this repository, orchestrating the
# various build systems

.PHONY: all
all: npm build/skdb build/init.sql

PLAYWRIGHT_REPORTER?="line"
SKARGO_PROFILE?=release
SKDB_WASM=sql/target/wasm32-unknown-unknown/$(SKARGO_PROFILE)/skdb.wasm
SKDB_BIN=sql/target/host/$(SKARGO_PROFILE)/skdb
SDKMAN_DIR?=$(HOME)/.sdkman

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

sql/target/wasm32-unknown-unknown/dev/skdb.wasm: sql/src/*
	cd sql && skargo build --target wasm32-unknown-unknown --bin skdb

sql/target/wasm32-unknown-unknown/release/skdb.wasm: sql/src/*
	cd sql && skargo build --release --target wasm32-unknown-unknown --bin skdb

$(SDKMAN_DIR):
	cd $(dirname $(SDKMAN_DIR)) && sh -c 'wget -q -O- "https://get.sdkman.io?rcupdate=false" | bash'

################################################################################
# skdb native binary
################################################################################

sql/target/host/dev/skdb: sql/src/* skiplang/prelude/src/**/*.sk skiplang/skdate/src/* skiplang/skjson/src/* skiplang/sqlparser/src/*
	cd sql && skargo build

sql/target/host/release/skdb: sql/src/* skiplang/prelude/src/**/*.sk skiplang/skdate/src/* skiplang/skjson/src/* skiplang/sqlparser/src/*
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

.PHONY: update-js-deps
update-js-deps:
	find . -name node_modules -not -prune -or -name target -not -prune -or -name package.json -exec sh -c 'cd $$(dirname "$$0"); bun update --latest' {} \;

.PHONY: check
check:
	find * -name Skargo.toml -exec sh -c 'bin/cd_sh $$(dirname {}) "skargo check"' \;

.PHONY: check-ts
check-ts:
	bin/check-ts.sh

.PHONY: clean
clean:
	rm -Rf build
	find . -name 'Skargo.toml' -print0 | sed 's|Skargo.toml|target|g' | xargs -0 rm -rf
	npm run clean

.PHONY: clean-all
clean-all: clean
	find . -type d -name 'node_modules' -prune -print0 | xargs -0 rm -rf

.PHONY: fmt-sk
fmt-sk:
	find . -path ./skiplang/compiler/tests -not -prune -or -name \*.sk | parallel skfmt -i {}

.PHONY: fmt-c
fmt-c:
	find . -path ./skiplang/prelude/libbacktrace -not -prune -or -path ./sql/test/TPC-h/tnt-tpch -not -prune -or -regex '.*\.[ch]\(pp\)*' | parallel clang-format -i {}

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
	bun install
	cd www && npm run start

# regenerate api docs served by run-docs from ts sources
.PHONY: docs
docs:
	bun install
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
test-client:
	cd sql && make test-client

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
test-soak-priv: build/skdb build/init.sql npm
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



.PHONY: test-wasm
test-wasm:
	cd sql && make test

## Backward Compatibility

.PHONY: test-skfs
test-skfs: sktest-prelude
