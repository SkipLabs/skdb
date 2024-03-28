#!/bin/bash

set -e

# tests replicating a table with no constraints (e.g. no primary key).
# this is the most general form of the replication. the semantics are
# a multiset CRDT where concurrent inserts win over deletes. we use a
# vector clock to ensure that we can detect concurrency and honour
# 'you cannot modify what you haven't seen'.
./test_replication_no_constraints.sh

# tests replicating a table with a primary key. the semantics are
# last-writer-wins as defined by the vector clock partial ordering -
# NOT the order that the server sees updates. we form a total order by
# tiebreaking concurrent updates using the row data.
./test_replication_primary_key.sh

# tests that we do not reflect updates due to replication causing cycles
./test_cyclic_replication.sh

# tests that the system works if no acls are defined
./test_no_acl_replication.sh
