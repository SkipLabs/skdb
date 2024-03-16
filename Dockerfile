FROM ubuntu:22.04 as stage0

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -q -y wget gnupg && \
    wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | apt-key add - && \
    wget -O - https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | apt-key add - && \
    echo "deb http://apt.llvm.org/jammy/ llvm-toolchain-jammy-15 main" >> /etc/apt/sources.list.d/llvm.list && \
    echo "deb-src http://apt.llvm.org/jammy/ llvm-toolchain-jammy-15 main" >> /etc/apt/sources.list.d/llvm.list && \
    echo "deb https://deb.nodesource.com/node_20.x nodistro main" >> /etc/apt/sources.list.d/nodejs.list && \
    apt-get update && \
    apt-get install -q -y git zip unzip curl make lld-15 sqlite3 gcc gawk clang-15 llvm-15 automake jq parallel nodejs file && \
    npm install -g typescript@5.1 && \
    npx playwright install-deps

RUN sh -c 'curl -s "https://get.sdkman.io?rcupdate=false" | bash'
RUN bash -c "source $HOME/.sdkman/bin/sdkman-init.sh && \
    sdk install gradle && \
    sdk install java 20.0.2-tem"

RUN update-alternatives --install /usr/bin/llvm-config llvm-config /usr/bin/llvm-config-15 100 && \
    update-alternatives --install /usr/bin/wasm-ld wasm-ld /usr/bin/wasm-ld-15 100 && \
    update-alternatives --install /usr/bin/clang clang /usr/bin/clang-15 100 && \
    update-alternatives --install /usr/bin/clang++ clang++ /usr/bin/clang++-15 100 && \
    update-alternatives --install /usr/bin/llvm-link llvm-link /usr/bin/llvm-link-15 100 && \
    update-alternatives --install /usr/bin/llc llc /usr/bin/llc-15 100 && \
    update-alternatives --install /usr/bin/llvm-ar llvm-ar /usr/bin/llvm-ar-15 100

ENV CC=clang
ENV CXX=clang++

FROM stage0 as bootstrap

COPY . /work

WORKDIR /work/compiler
RUN make clean && make STAGE=0

FROM stage0 as base

COPY --from=bootstrap /work/compiler/stage0/bin/ /usr/bin/
COPY --from=bootstrap /work/compiler/stage0/lib/ /usr/lib/
