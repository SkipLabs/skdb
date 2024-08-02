
SKARGO_PROFILE?=release

../build/sknpm:
	cd .. && make build/sknpm

build-%: ../build/sknpm
	cd ts/examples && bun install
	../build/sknpm b -r --out-dir ts/examples/node_modules/skstore

bunrun-%: ../build/sknpm
	cd ts/examples && bun install
	../build/sknpm b -r --out-dir ts/examples/node_modules/skstore
	bun run ts/examples/wmain.ts -f ts/examples/$*.ts -m io

check-%: ../build/sknpm
	cd ts/examples && npm install
	../build/sknpm b -r --nowasm --out-dir ts/examples/node_modules/skstore
	tsc --project ts/examples/tsconfig.json

noderun-%: build/sknpm
	cd ts/examples && npm install
	../build/sknpm b -r --out-dir ts/examples/node_modules/skstore
	tsc --project ts/examples/tsconfig.json
	cd ts/examples && node dist/wmain.js -f dist/$*.js -m io

bunplay-%: ../build/sknpm
	cd ts/examples && bun install
	../build/sknpm b -r --out-dir ts/examples/node_modules/skstore
	echo "play 1\nexit\n" | bun run ts/examples/wmain.ts -f ts/examples/$*.ts -m io

nodeplay-%: ../build/sknpm
	cd ts/examples && npm install
	../build/sknpm b -r --out-dir ts/examples/node_modules/skstore
	tsc --project ts/examples/tsconfig.json
	cd ts/examples && echo "play 1\nexit\n" | node dist/wmain.js -f  dist/$*.js -m io

.PHONY: build
build:
	skargo b --profile $(SKARGO_PROFILE)

target/host/$(SKARGO_PROFILE)/libskstore.so: build
	mkdir -p ~/.skstore
	cp target/host/$(SKARGO_PROFILE)/libskstore.so ~/.skstore/

ts/native/build/Release/sktore.node: target/host/$(SKARGO_PROFILE)/libskstore.so
	cd ts/native && npm i

.PHONY: addon
addon: ts/native/build/Release/sktore.node

.PHONY: test-gyp
test-gyp: addon
	cd ts/native && node tests.js

gyprun-%: ../build/sknpm addon
	cd ts/examples && npm install
	../build/sknpm b -r --out-dir ts/examples/node_modules/skstore
	tsc --project ts/examples/tsconfig.json
	cd ts/examples && node dist/nmain.js -f dist/$*.js -m io

gypplay-%: ../build/sknpm addon
	cd ts/examples && npm install
	../build/sknpm b -r --out-dir ts/examples/node_modules/skstore
	tsc --project ts/examples/tsconfig.json
	cd ts/examples && echo "play 1\nexit\n" | node dist/nmain.js -f dist/$*.js -m io