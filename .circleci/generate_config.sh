#!/bin/bash

# TODO: This is flaky as it relies on coarse directory-level diffs.
git diff --quiet HEAD $(git merge-base main HEAD) -- compiler/ prelude/ skfs/
skc=1 #$?
git diff --quiet HEAD $(git merge-base main HEAD) -- skfs/
skfs=1 #$?
git diff --quiet HEAD $(git merge-base main HEAD) -- sql/ sqlparser/
skdb=1 #$?

if (($skc == 0 && $skfs == 0 && $skdb == 0))
then
    circleci-agent step halt
fi

cat .circleci/base.yml

echo "workflows:"

if (( $skc != 0 ))
then
    cat <<EOF
  compiler:
    jobs:
      - compiler
EOF
fi

if (( $skfs != 0 ))
then
    cat <<EOF
  skfs:
    jobs:
      - skfs
EOF
fi

if (( $skdb != 0 ))
then
    cat <<EOF
  skdb:
    jobs:
      - skdb
      - skdb-wasm
EOF
fi
