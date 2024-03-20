#!/bin/bash

pass() { printf "%-32s OK\n" "TEST $1:"; }
fail() { printf "%-32s FAILED\n" "TEST $1:"; }

DBFILE=/tmp/test.db

rm -f $DBFILE

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_CMD="skargo run -q --profile $SKARGO_PROFILE -- "

$SKDB_CMD --init $DBFILE

SKDB="$SKDB_CMD --data $DBFILE"

echo "create table t1 (id TEXT PRIMARY KEY, object JSON);" | $SKDB
echo "create table t2 (id TEXT PRIMARY KEY, object TEXT);" | $SKDB

echo "insert into t1 (object) values (json('{\"a\": 32}'));" | $SKDB
echo "insert into t1 (object) values (json('{\"a\": 33, \"b\": 3.3}'));" | $SKDB
echo "insert into t1 (object) values (json('{\"a\": 33, \"b\": 3.3, \"c\":\"text\"}'));" | $SKDB

echo "insert into t2 (object) values ('{\"a\": 34}');" | $SKDB
echo "insert into t2 (object) values ('{\"a\": 34, \"b\": 3.4}');" | $SKDB
echo "insert into t2 (object) values ('{\"a\": 34, \"b\": 3.4, \"c\":\"text2\"}');" | $SKDB

if echo "select json_infer_schema(object) from t2" | $SKDB | grep -q '{"a":int,?"b":float,?"c":string}'; then
    pass "INFER_SCHEMA"
else
    fail "INFER_SCHEMA"
fi

if echo "select json_infer_schema(object) from t2" | $SKDB | grep -q '{"a":int,?"b":float,?"c":string}'; then
    pass "INFER_SCHEMA"
else
    fail "INFER_SCHEMA"
fi

schema='{"a":int,?"b":float,?"c":string}'

if echo "select json_check_schema(json_schema('$schema'), json('{\"a\":22}'))" | $SKDB | grep -q ok; then
    pass "SCHEMA_CHECK1"
else
    fail "SCHEMA_CHECK1"
fi

if echo "select json_check_schema('$schema', '{\"a\":22}')" | $SKDB | grep -q ok; then
    pass "SCHEMA_CHECK1"
else
    fail "SCHEMA_CHECK1"
fi

if echo "select json_check_schema(json_schema('$schema'), json('{\"a\":22.0}'))" | $SKDB 2>&1 | grep -q Error; then
    pass "SCHEMA_CHECK2"
else
    fail "SCHEMA_CHECK2"
fi

if echo "select json_check_schema('$schema', '{\"a\":22.0}')" | $SKDB 2>&1 | grep -q Error; then
    pass "SCHEMA_CHECK3"
else
    fail "SCHEMA_CHECK3"
fi

if echo "select json_check_schema('$schema', '{\"a\":22.0}')" | $SKDB 2>&1 | grep -q Error; then
    pass "SCHEMA_CHECK4"
else
    fail "SCHEMA_CHECK4"
fi

if echo "select json_check_schema(json_schema('$schema'), json('{\"b\":22.0}'))" | $SKDB 2>&1 | grep -q Error; then
    pass "SCHEMA_CHECK5"
else
    fail "SCHEMA_CHECK5"
fi

echo "create reactive view paths as json_split(t1);" | $SKDB

if echo "select count(*) from paths where path='.a'" | $SKDB | grep -q 3; then
    pass "COUNT_PATHS"
else
    fail "COUNT_PATHS"
fi

echo "insert into t1 values ('id555', '{\"c\": 33}');" | $SKDB
echo "insert into t2 values ('id555', '{\"c\": 33}');" | $SKDB

schema2='{?"a":int,?"b":float,?"c":int|string}'

# Let's enforce a schema on t1, see if it is successfully enforced

echo "create reactive view t1_schema as select json_infer_schema(object) from t1;" | $SKDB
echo "delete from t1 where id='id555';" | $SKDB

echo "create reactive view enforce_type as select json_check_schema('$schema2', json_infer_schema(object)) from t1" | $SKDB

# Now let's try to add something that does not respect the schema

if echo "insert into t1 values('$schema2', '{\"c\":3.3}');" | $SKDB 2>&1 | grep -q Error; then
    pass "ENFORCE_SCHEMA"
else
    fail "ENFORCE_SCHEMA"
fi

echo "delete from t1" | $SKDB

echo "create table users (id TEXT PRIMARY KEY, object JSON);" | $SKDB

echo 'INSERT INTO users (object) values ('"'"'{
  "name": "Greg",
  "emails": [
    {
      "type": "work",
      "address": "greg@skiplabs.io"
    },
    {
      "type": "personal",
      "address": "greg@gmail.com"
    }
  ],
  "other_stuff": {}
}'"'"');' | $SKDB

echo "create reactive view user_paths as json_split(users);" | $SKDB
echo "create reactive view emails as select id, svalue as email from user_paths where path like '.emails[%].address';" | $SKDB 
echo "create index email_idx on emails(email);" | $SKDB

if echo "select email from emails where email like 'greg%gmail%'" | $SKDB | grep -q 'greg@gmail.com'; then
    pass "EMAIL_INDEX"
else
    fail "EMAIL_INDEX"
fi

# Tests for json_extract

echo "create table t3 (v JSON);" | $SKDB

echo 'insert into t3 values('"'"'{"userId": 1,"id": 1,"title": "delectus aut autem","completed": false}'"'"')' | $SKDB
echo 'insert into t3 values('"'"'{"userId":1,"id":2,"title":"quisutamfacilisetofficiaqui","completed":false}'"'"')' | $SKDB
echo 'insert into t3 values('"'"'{"userId":1,"id":3,"title":"fugiatveiammius","completed":false}'"'"')' | $SKDB
echo 'insert into t3 values('"'"'{"userId":1,"id":4,"title":"etporrotempora","completed":true}'"'"')' | $SKDB
echo 'insert into t3 values('"'"'{"userId":1,"id":5,"title":"laboriosammollitiaeteimquasiadipisciquiaprovidetillum","completed":false}'"'"')' | $SKDB

echo "create reactive view t3_sql as json_extract(t3, v, '{id<int>, userId<int>, title<string>, completed<bool>}');" | $SKDB

if echo "select * from t3_sql where id = 1" | $SKDB | grep -q delectus; then
    pass "JSON_EXTRACT"
else
    fail "JSON_EXTRACT"
fi

echo "create table t4 (v JSON);" | $SKDB

echo 'insert into t4 values('"'"'{"userIds":[1,2,3],"id": 1,"title": "delectus aut autem","completed": false}'"'"')' | $SKDB
echo 'insert into t4 values('"'"'{"userIds":[2],"id":2,"title":"quisutamfacilisetofficiaqui","completed":false}'"'"')' | $SKDB
echo 'insert into t4 values('"'"'{"userIds":[1,2],"id":3,"title":"fugiatveiammius","completed":false}'"'"')' | $SKDB
echo 'insert into t4 values('"'"'{"userIds":[4,5],"id":4,"title":"etporrotempora","completed":true}'"'"')' | $SKDB
echo 'insert into t4 values('"'"'{"userIds":[3,4],"id":5,"title":"laboriosammollitiaeteimquasiadipisciquiaprovidetillum","completed":false}'"'"')' | $SKDB

echo "create reactive view t4_sql as json_extract(t4, v, '{id<int>, userIds[]: userId<int>, title<string>, completed<bool>}');" | $SKDB

if echo "select count(*) from t4_sql where id = 1" | $SKDB | grep -q 3; then
    pass "JSON_EXTRACT2"
else
    fail "JSON_EXTRACT2"
fi


echo "create table t5 (v JSON);" | $SKDB

echo 'insert into t5 values('"'"'{"ratings":[1,2.0,3],"id": 1,"title": "delectus aut autem","completed": false}'"'"')' | $SKDB
echo 'insert into t5 values('"'"'{"ratings":[2.0],"id":2,"title":"quisutamfacilisetofficiaqui","completed":false}'"'"')' | $SKDB
echo 'insert into t5 values('"'"'{"ratings":[1.0,2],"id":3,"title":"fugiatveiammius","completed":false}'"'"')' | $SKDB
echo 'insert into t5 values('"'"'{"ratings":[4.0,null],"id":4,"title":"etporrotempora","completed":true}'"'"')' | $SKDB
echo 'insert into t5 values('"'"'{"ratings":[3,4],"id":5,"title":"laboriosammollitiaeteimquasiadipisciquiaprovidetillum","completed":false}'"'"')' | $SKDB

echo "create reactive view t5_sql as json_extract(t5, v, '{ratings[]: rating<num>}');" | $SKDB

if echo "select count(rating) from t5_sql where rating > 1.0" | $SKDB | grep -q 7; then
    pass "JSON_EXTRACT3"
else
    fail "JSON_EXTRACT3"
fi

echo "create reactive view t5_sql2 as json_extract(t5, v, '{ratings[]: rating<null | num>}');" | $SKDB

if echo "select count(rating) from t5_sql2" | $SKDB | grep -q 9; then
    pass "JSON_EXTRACT4"
else
    fail "JSON_EXTRACT4"
fi


