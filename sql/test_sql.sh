#!/bin/bash
if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "
export SKDB

run_one_test () {
  printf "%-40s " "$2:"
  out1=$(mktemp)
  err1=$(mktemp)
  out2=$(mktemp)
  err2=$(mktemp)
  # a parameterized test foo.sql expects arguments in foo_args.json and
  # checks skdb on foo_args.json and foo.sql vs sqlite
  args_file="${2%.*}"_args.json
  if test -f $args_file; then
    cat $args_file $2 | $1 $SKDB --always-allow-joins --expect-query-params 2> $err1 | sort > $out1
    stat1=${PIPESTATUS[1]}
    cat <(test/params/json_args_to_sqlite_params.sh $args_file) $2 | $1 sqlite3 2> $err2 | sort > $out2
    stat2=${PIPESTATUS[1]}
  else
    cat $2 | $1 $SKDB --always-allow-joins 2> $err1 | sort > $out1
    stat1=${PIPESTATUS[1]}
    cat $2 | $1 sqlite3 2> $err2 | sort > $out2
    stat2=${PIPESTATUS[1]}
  fi
  if [ $stat1 -eq 0 ]; then
      if [ $stat2 -eq 0 ]; then
          diff $out1 $out2 > /dev/null
          if [ $? -eq 0 ]; then
              echo "OK"
          else
              echo "FAILED"
          fi
      else
          echo "FAILED (only sqlite exited $stat2)"
          diff $err1 $err2
      fi
  else
      if [ $stat2 -eq 0 ]; then
          echo "FAILED (only skdb exited $stat1)"
          diff $err1 $err2
      else
          echo "OK (both exited non-zero)"
      fi
  fi
}
export -f run_one_test

run_test () {
  run_one_test "" $1
}
export -f run_test

if ! [ -z "$1" ]; then
    if test -f "$1"; then
        echo "RUNNING TEST: $1"
        run_one_test time $1
    else
        echo "File does not exist: $1"
    fi
    exit 0
fi

echo ""
echo "*******************************************************************************"
echo "* UNIT TESTS *"
echo "*******************************************************************************"
echo ""

./unit_tests.sh

echo ""
echo "*******************************************************************************"
echo "* SKDB TESTS *"
echo "*******************************************************************************"
echo ""

parallel run_test ::: \
    test/*.sql \
    test/random/expr/*.sql \
    test/random/select/*.sql \
    test/random/groupby/*.sql \
    test/random/aggregates/*.sql

echo ""
echo "*******************************************************************************"
echo "* SKDB TAIL TESTS *"
echo "*******************************************************************************"
echo ""

./test_tail_filter_param.sh


echo ""
echo "*******************************************************************************"
echo "* DATES *"
echo "*******************************************************************************"
echo ""

./test_date.sh

echo ""
echo "*******************************************************************************"
echo "* SKDB REPLICATION TESTS *"
echo "*******************************************************************************"
echo ""

./test_replication.sh

echo ""
echo "*******************************************************************************"
echo "* SKDB CONCURRENCY TESTS *"
echo "*******************************************************************************"
echo ""

for i in {1..10}; do ./test_concurrent_sync.sh; done
for i in {1..10}; do (cd ./test/concurrent/inserts/ && ./run.sh); done
for i in {1..10}; do (cd ./test/concurrent/sum/ && ./run.sh); done
for i in {1..10}; do (cd ./test/concurrent/sum_transaction/ && ./run.sh); done

echo ""
echo "*******************************************************************************"
echo "* PRIVACY *"
echo "*******************************************************************************"
echo ""

./test_privacy.sh

echo ""
echo "*******************************************************************************"
echo "* JSON *"
echo "*******************************************************************************"
echo ""

./test_json.sh

echo ""
echo "*******************************************************************************"
echo "* SKDB DIFF TESTS *"
echo "*******************************************************************************"
echo ""

./test_diff.sh

echo ""
echo "*******************************************************************************"
echo "* MEMORY *"
echo "*******************************************************************************"
echo ""

(cd ./test/memory/ && ./run.sh)
