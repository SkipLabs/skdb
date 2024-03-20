#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "

pass() { printf "%-36s OK\n" "TEST $1:"; }
fail() { printf "%-36s FAILED\n" "TEST $1:"; }

if cat test/unit/test_unique.sql | $SKDB 2>&1 | grep -q UNIQUE
then
    pass "UNIQUE"
else
    fail "UNIQUE"
fi


if cat test/test_concat.sql | $SKDB | grep -q hellohello
then
    pass "CONCAT"
else
    fail "CONCAT"
fi

if cat test/test_notnull.sql | $SKDB 2>&1 | grep -E 'cannot insert NULL in column declared as NOT NULL' &> /dev/null
then
    pass "NOT NULL"
else
    fail "NOT NULL"
fi

if cat test/test_delete.sql | $SKDB | grep -v -q 22
then
    pass "DELETE"
else
    fail "DELETE"
fi

cat test/test_like.sql | $SKDB > /tmp/kk1
diff /tmp/kk1 test/unit/test_like.expected > /dev/null

if [ $? -eq 0 ]; then
    pass "LIKE"
else
    fail "LIKE"
fi

if cat test/join_select_order.sql | $SKDB --always-allow-joins | grep -q '4|6|4|4|1|4'
then
    pass "JOIN ORDER"
else
    fail "JOIN ORDER"
fi

if cat test/test_update.sql | $SKDB | grep -q '2|3'
then
    pass "JOIN ORDER"
else
    fail "JOIN ORDER"
fi

if cat test/primary_index.sql | $SKDB --show-used-indexes | grep -q 'USING INDEX: __skdb__t1_id'
then
    pass "PRIMARY INDEX"
else
    fail "PRIMARY INDEX"
fi

if cat test/insert_values.sql | $SKDB | grep -q '3'
then
    pass "MULTIPLE INSERTS"
else
    fail "MULTIPLE INSERTS"
fi

if cat test/test_not_like.sql | $SKDB | grep -q 'def'
then
    pass "NOT LIKE"
else
    fail "NOT LIKE"
fi

if cat test/aggr_union.sql | $SKDB | awk '{x+=$1}; END {print x}' | grep -q '11'
then
    pass "AGGR UNION"
else
    fail "AGGR UNION"
fi

if cat test/unit/test_joins.sql | $SKDB --always-allow-joins | tr '\n' S | grep -q '1|2|1|3S2|4||S1|2|1|3S1|2|1|3S2|4||S'
then
    pass "JOIN"
else
    fail "JOIN"
fi

if cat test/unit_parse_float.sql | $SKDB | tr '\n' S | grep -q '1000000000.0S10000000000.0S100000000000000.0S1.0e+15S1.0e-05S1.1e-05S9.0e-05S0.0001S0.0009S58.0S400.0S1.23456e-65S1000.0S-100000000000000.0S-1.0e+15S-0.0001S-1.0e-05S-1.0e-09S-1.0e-10S-58.0S-400.0S-1.23456e-65S-1000.0S1.0e+15S100000000000000.0S1000.0S400.0S58.0S0.0009S0.0001S0.0001S9.0e-05S1.1e-05S1.0e-05S1.0e-05S1.23456e-65S-1.23456e-65S-1.0e-09S-1.0e-08S-1.0e-05S-0.0001S-58.0S-400.0S-1000.0S-100000000000000.0S-1.0e+15'
then
    pass "PARSE FLOAT"
else
    fail "PARSE FLOAT"
fi

gcc test/unit/utf8_string/make_utf8_insert_select.c -o /tmp/make_utf8_insert_select
/tmp/make_utf8_insert_select | $SKDB > /tmp/kk1

diff /tmp/kk1 test/unit/utf8_string/expected_string.txt > /dev/null

if [ $? -eq 0 ]; then
    pass "UTF8"
else
    fail "UTF8"
fi

./test_notify.sh

cat test/join_outside_of_reactive.sql | $SKDB 2> /tmp/kk1
diff /tmp/kk1 test/unit/join_outside_of_reactive.exp > /dev/null

if [ $? -eq 0 ]; then
    pass "REACTIVE JOIN"
else
    fail "REACTIVE JOIN"
fi

if cat test/insert_autoid.sql | $SKDB | grep -q "3"
then
    pass "INSERT AUTOINCREMENT"
else
    fail "INSERT AUTOINCREMENT"
fi

if cat test/unit/test_seqnum.sql | $SKDB | tr '\n' S | grep -q "123S122S"; then
    pass "LOCAL SEQUENCE NUMBER"
else
    fail "LOCAL SEQUENCE NUMBER"
fi

if cat test/unit/test_seqnum2.sql | $SKDB | tr '\n' S | grep -q "9S16S22S29"; then
    pass "LOCAL SEQUENCE NUMBER 2"
else
    fail "LOCAL SEQUENCE NUMBER 2"
fi

if cat test/unit/test_id.sql | $SKDB | tr '\n' S | grep -q "123S122S"; then
    pass "ID"
else
    fail "ID"
fi

if cat test/lower_upper.sql | $SKDB | grep -q "FOO|bar"; then
    pass "LOWER/UPPER"
else
    fail "LOWER/UPPER"
fi

if cat test/unit/test_insert_seqnum.sql | $SKDB | grep -q "|22"; then
    pass "INSERT LOCAL SEQUENCE NUMBER"
else
    fail "INSERT LOCAL SEQUENCE NUMBER"
fi

if cat test/unit/test_insert_id.sql | $SKDB | grep -q "|22"; then
    pass "INSERT ID"
else
    fail "INSERT ID"
fi


if cat test/test_string_escaping_json.sql | $SKDB --format=json | grep -q '{"a":"\\"Hello world\\""}'; then
    pass "STRING ESCAPING JSON"
else
    fail "STRING ESCAPING JSON"
fi

if cat test/test_null_encoding_json.sql | $SKDB --format=json | grep -q '{"a":1,"b":null,"c":2}'; then
    pass "NULL ENCODING JSON"
else
    fail "NULL ENCODING JSON"
fi

if cat test/test_real.sql | $SKDB | grep -q "1"; then
    pass "REAL"
else
    fail "REAL"
fi

if cat test/test_missing_semi.sql | $SKDB | grep -q "22"; then
    pass "MISSING SEMI"
else
    fail "MISSING SEMI"
fi

if cat test/test_ignore_replace.sql | $SKDB | tr '\n' 'S' | grep -q "22|23S24|26S25|27S31|32S33|34S51|42|43S"; then
    pass "IGNORE/REPLACE"
else
    fail "IGNORE/REPLACE"
fi

if cat test/test_ignore_replace2.sql | $SKDB | tr '\n' 'S' | grep -q "50|1S50|2S"; then
    pass "IGNORE/REPLACE2"
else
    fail "IGNORE/REPLACE2"
fi

if cat test/test_underscore_alias.sql | $SKDB | grep -q "22"; then
    pass "UNDERSCORE ALIAS"
else
    fail "UNDERSCORE ALIAS"
fi

if cat test/create_index_if_not_exists.sql | $SKDB | grep -q "22"; then
    pass "CREATE INDEX IF NOT EXISTS"
else
    fail "CREATE INDEX IF NOT EXISTS"
fi

tmpfile=$(mktemp /tmp/testfile.XXXXXX)
tmpfile_dump=$(mktemp /tmp/testfile.XXXXXX)
rm -f $tmpfile $tmpfile_dump
$SKDB --init $tmpfile
cat test/unit/test_dump_index.sql | $SKDB --data $tmpfile
$SKDB dump --data $tmpfile > $tmpfile_dump

diff $tmpfile_dump test/unit/test_dump_index.exp  > /dev/null
if [ $? -eq 0 ]; then
    rm $tmpfile $tmpfile_dump
    pass "DUMP INDEXES"
else
    fail "DUMP INDEXES"
fi

if cat test/test_select_star_plus.sql | $SKDB | grep -q "22|23|45"; then
    pass "STAR COMMA"
else
    fail "STAR COMMA"
fi

if cat test/unit/test_default_values.sql | $SKDB | tr '\n' ' ' | grep -E -- '-?[0-9]+\|test1\|test2\|[0-9]{2}:[0-9]{2}:[0-9]{2}' | grep -E '[0-9]+\|\|foo' | grep -qE '[0-9]+\|bar\|hello' ; then
    pass "DEFAULT VALUES"
else
    fail "DEFAULT VALUES"
fi

if cat test/test_count_string.sql | $SKDB | grep -q "0"; then
    pass "COUNT STRING"
else
    fail "COUNT STRING"
fi

if cat test/test_insert_or_update.sql | $SKDB | grep -q "1|3"; then
    pass "INSERT OR UPDATE"
else
    fail "INSERT OR UPDATE"
fi

if cat test/test_table_dot_star.sql | $SKDB --always-allow-joins | grep -q "2|3|4|5|2|6"; then
    pass "DOT STAR"
else
    fail "DOT STAR"
fi

if cat test/unit/test_index_on_star.sql | $SKDB --show-used-indexes | grep -q "USING INDEX: v1_a"; then
    pass "INDEX DOT STAR"
else
    fail "INDEX DOT STAR"
fi

if cat test/limit_unit.sql | $SKDB | wc | tr ' ' 'S' | tr '\n' 'S' | grep -q "SSSSSS1SSSSSSS1SSSSSSS2S"; then
    pass "LIMIT"
else
    fail "LIMIT"
fi

if cat test/test_index_transaction.sql | $SKDB --show-used-indexes | tr ' ' 'S' | grep -q "USINGSINDEX:S__skdb__T1_a"; then
    pass "TRANSACTION INDEX"
else
    fail "TRANSACTION INDEX"
fi

if cat test/test_index_transaction2.sql | $SKDB --show-used-indexes | tr ' ' 'S' | grep -q "USINGSINDEX:S__skdb__T1_a"; then
    pass "TRANSACTION INDEX 2"
else
    fail "TRANSACTION INDEX 2"
fi

if cat test/unit/test_duplicate_join.sql | $SKDB --always-allow-joins | grep -q '1|1';
then
    pass "DUPLICATE JOIN"
else
    fail "DUPLICATE JOIN"
fi

if cat test/unit/test_datetime.sql | $SKDB | grep -qE '[0-9]{2}:[0-9]{2}:[0-9]{2}\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\|[0-9]{2}:[0-9]{2}:[0-9]{2}\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\|[0-9]+\.[0-9]+\|[0-9]+\|[0-9]{2}/[0-9]{2}/[0-9]{2}\|[0-9]{2}:[0-9]{2}:[0-9]{2}\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\|[0-9]+\.[0-9]+\|[0-9]+\|[0-9]{2}/[0-9]{2}/[0-9]{2}';
then
    pass "DATETIME"
else
    fail "DATETIME"
fi

if cat test/unit/test_create_table_as_select.sql | $SKDB | grep -q '1|1|2|2|read-only' ; then
    pass "CREATE TABLE AS SELECT"
else
    fail "CREATE TABLE AS SELECT"
fi

if cat test/unit/test_length.sql | $SKDB | grep -q '|0|||test|4|literal|7' ; then
    pass "LENGTH"
else
    fail "LENGTH"
fi
