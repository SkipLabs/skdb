#!/bin/bash

(cd tnt-tpch
 make tpch-dbgen/dbgen
 (cd tpch-dbgen/ && ./dbgen -f -s 1)
 ./create_db.sh customer lineitem nation orders partsupp part region supplier)

TPCHDB='./tnt-tpch/TPC-H.db'


if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "

rm -f /tmp/test.db

$SKDB --init /tmp/test.db

echo "
CREATE TABLE CUSTOMER (
  c_custkey    INTEGER PRIMARY KEY,
  c_name       TEXT,
  c_address    TEXT,
  c_nationkey  INTEGER,
  c_phone      TEXT,
  c_acctbal    FLOAT,
  c_mktsegment TEXT,
  c_comment    TEXT
);
" | $SKDB --data /tmp/test.db

echo "
CREATE TABLE LINEITEM (
  l_orderkey      INTEGER,
  l_partkey       INTEGER,
  l_suppkey       INTEGER,
  l_linenumber    INTEGER,
  l_quantity      INTEGER,
  l_extendedprice FLOAT,
  l_discount      FLOAT,
  l_tax           FLOAT,
  l_returnflag    TEXT,
  l_linestatus    TEXT,
  l_shipdate      TEXT,
  l_commitdate    TEXT,
  l_receiptdate   TEXT,
  l_shipinstruct  TEXT,
  l_shipmode      TEXT,
  l_comment       TEXT
);
" | $SKDB --data /tmp/test.db

echo "
CREATE TABLE NATION (
  n_nationkey INTEGER PRIMARY KEY,
  n_name      TEXT,
  n_regionkey INTEGER,
  n_comment   TEXT
);
" | $SKDB --data /tmp/test.db

echo "
CREATE TABLE ORDERS (
  o_orderkey      INTEGER PRIMARY KEY,
  o_custkey       INTEGER,
  o_orderstatus   TEXT,
  o_totalprice    FLOAT,
  o_orderdate     TEXT,
  o_orderpriority TEXT,
  o_clerk         TEXT,
  o_shippriority  INTEGER,
  o_comment       TEXT
);
" | $SKDB --data /tmp/test.db

echo "
CREATE TABLE PART (
  p_partkey     INTEGER PRIMARY KEY,
  p_name        TEXT,
  p_mfgr        TEXT,
  p_brand       TEXT,
  p_type        TEXT,
  p_size        INTEGER,
  p_container   TEXT,
  p_retailprice FLOAT,
  p_comment     TEXT
);
" | $SKDB --data /tmp/test.db

echo "
CREATE TABLE PARTSUPP (
  ps_partkey    INTEGER,
  ps_suppkey    INTEGER,
  ps_availqty   INTEGER,
  ps_supplycost FLOAT,
  ps_comment    TEXT
);
" | $SKDB --data /tmp/test.db

echo "
CREATE TABLE REGION (
  r_regionkey INTEGER PRIMARY KEY,
  r_name      TEXT,
  r_comment   TEXT
);
" | $SKDB --data /tmp/test.db

echo "
CREATE TABLE SUPPLIER (
  s_suppkey   INTEGER PRIMARY KEY,
  s_name      TEXT,
  s_address   TEXT,
  s_nationkey INTEGER,
  s_phone     TEXT,
  s_acctbal   FLOAT,
  s_comment   TEXT
);
" | $SKDB --data /tmp/test.db

sqlite3 $TPCHDB ".mode insert customer" "select * from customer;" | $SKDB --data /tmp/test.db
sqlite3 $TPCHDB ".mode insert lineitem" "select * from lineitem;" | head -n 500000 | $SKDB --data /tmp/test.db
sqlite3 $TPCHDB ".mode insert nation" "select * from nation;" | $SKDB --data /tmp/test.db
sqlite3 $TPCHDB ".mode insert orders" "select * from orders;" | $SKDB --data /tmp/test.db
sqlite3 $TPCHDB ".mode insert part" "select * from part;" | $SKDB --data /tmp/test.db
sqlite3 $TPCHDB ".mode insert partsupp" "select * from partsupp;" | $SKDB --data /tmp/test.db
sqlite3 $TPCHDB ".mode insert region" "select * from region;" | $SKDB --data /tmp/test.db
sqlite3 $TPCHDB ".mode insert supplier" "select * from supplier;" | $SKDB --data /tmp/test.db

$SKDB compact --data /tmp/test.db
