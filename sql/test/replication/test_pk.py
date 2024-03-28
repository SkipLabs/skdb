#! /usr/bin/env python3

import scheduling as sched
from model import Topology, Client, Server
from test_runner import run_tests, run_just
import sys

def create_cluster(scheduler):
  cluster = (
    Topology(scheduler)
    .schema("CREATE TABLE test_with_pk (id INTEGER PRIMARY KEY, note TEXT);")
  )
  return cluster


def test_client_server_single_orthogonal_insert_each():
  scheduler = sched.AllTopoSortsScheduler()
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))

  cluster.mirror("test_with_pk", client1, server)

  client1.insertInto("test_with_pk", [0, 'foo'])
  server.insertInto("test_with_pk", [1, 'bar'])

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").equals(
    [0, "foo"], [1, "bar"],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_two_conflicting_inserts_each():
  scheduler = sched.AllTopoSortsScheduler()
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  clientInsert = client1.insertOrReplace("test_with_pk", [0, 'foo'])
  serverInsert = server.insertOrReplace("test_with_pk", [0, 'bar'])

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").match(
    colnames=['id', 'note'],
  ).clause(
    # does s1 see the insert before it does it's own?
    lambda schedule: any(schedule.happensBefore(delivery, serverInsert['s1'][0])
                         for delivery in clientInsert['s1']),
    [[0, "bar"]]
  ).elze(
    [[0, "foo"]]
  )

  return scheduler


def test_two_clients_single_server_two_conflicting_inserts_with_causality():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 5000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'bar'])
  server.insertOrReplace("test_with_pk", [0, 'baz'])

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_single_conflicting_insert_each():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 5000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client2.insertOrReplace("test_with_pk", [0, 'bar'])
  server.insertOrReplace("test_with_pk", [0, 'baz'])

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "foo"]], [[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_insert_on_client2():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 5000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'bar'])
  client2.insertOrReplace("test_with_pk", [0, 'baz'])

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_repeat_inserts_on_client1_purge_on_1():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'foo'])

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").equals(
    [0, "foo"],
    colnames=['id', 'note'],
  )

  return scheduler




# | c1        | c1        | c2    | purge? |
# |-----------+-----------+-------+--------|
# | ins 0 foo | ins 0 bar | del 0 | no     |
# | ins 0 foo | ins 0 bar | del 0 | c1     |
# | ins 0 foo | ins 0 bar | del 0 | serv   |
# |-----------+-----------+-------+--------|
# | ins 0 foo | ins 1 bar | del 0 | no     |
# | ins 0 foo | ins 1 bar | del 0 | c1     |
# | ins 0 foo | ins 1 bar | del 0 | server |
# |-----------+-----------+-------+--------|
# | ins 0 foo | ins 0 bar | upd 0 | no     |
# | ins 0 foo | ins 0 bar | upd 0 | c1     |
# | ins 0 foo | ins 0 bar | upd 0 | server |
# |-----------+-----------+-------+--------|
# | ins 0 foo | ins 1 bar | upd 0 | no     |
# | ins 0 foo | ins 1 bar | upd 0 | c1     |
# | ins 0 foo | ins 1 bar | upd 0 | server |
# |-----------+-----------+-------+--------|
# | ins 0 foo | upd 0 bar | upd 0 | no     |
# | ins 0 foo | upd 0 bar | upd 0 | c1     |
# | ins 0 foo | upd 0 bar | upd 0 | server |

def test_two_clients_single_server_multiple_inserts_on_client1_delete_on_client2_same_key():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'bar'])
  client2.deleteFromWhere("test_with_pk", "id = 0")

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "bar"]], []],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_delete_on_client2_same_key_purge_1():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'bar'])
  client2.deleteFromWhere("test_with_pk", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "bar"]], []],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_delete_on_client2_same_key_purge_server():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  server.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'bar'])
  client2.deleteFromWhere("test_with_pk", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [
      [[0, "bar"]], []],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_delete_on_client2_diff_key():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [1, 'bar'])
  client2.deleteFromWhere("test_with_pk", "id = 0")

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "foo"], [1, "bar"]], [[1, "bar"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_delete_on_client2_diff_key_purge_1():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [1, 'bar'])
  client2.deleteFromWhere("test_with_pk", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "foo"], [1, "bar"]], [[1, "bar"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_delete_on_client2_diff_key_purge_server():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  server.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [1, 'bar'])
  client2.deleteFromWhere("test_with_pk", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "foo"], [1, "bar"]], [[1, "bar"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_update_on_client2_same_key():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'bar'])
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_update_on_client2_same_key_purge_1():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'bar'])
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_update_on_client2_same_key_purge_server():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  server.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [0, 'bar'])
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [
      [[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_update_on_client2_diff_key():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [1, 'bar'])
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # check once all tasks have run that the cluster is silent
  cluster.isSilent()

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "foo"], [1, "bar"]], [[0, "baz"], [1, "bar"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_update_on_client2_diff_key_purge_1():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [1, 'bar'])
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "foo"], [1, "bar"]], [[0, "baz"], [1, "bar"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_multiple_inserts_on_client1_update_on_client2_diff_key_purge_server():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  server.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.insertOrReplace("test_with_pk", [1, 'bar'])
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "foo"], [1, "bar"]], [[0, "baz"], [1, "bar"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_updates():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.updateSetWhere("test_with_pk", "note = 'bar'", "id = 0")
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_updates_purge_happens_on1():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  client1.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.updateSetWhere("test_with_pk", "note = 'bar'", "id = 0")
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [[[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


def test_two_clients_single_server_updates_purge_happens_on_server():
  scheduler = sched.ReservoirSample(sched.AllTopoSortsScheduler(runAll=True), 9000)
  cluster = create_cluster(scheduler)

  server = cluster.add(Server("s1", scheduler))
  client1 = cluster.add(Client("c1", scheduler))
  client2 = cluster.add(Client("c2", scheduler))

  cluster.mirror("test_with_pk", client1, server)
  cluster.mirror("test_with_pk", client2, server)

  server.purgeAllAtSomePointFromNow()

  client1.insertOrReplace("test_with_pk", [0, 'foo'])
  client1.updateSetWhere("test_with_pk", "note = 'bar'", "id = 0")
  client2.updateSetWhere("test_with_pk", "note = 'baz'", "id = 0")

  # and that all nodes have reached this state
  cluster.state("SELECT id, note FROM test_with_pk;").isOneOf(
    [
      [[0, "bar"]], [[0, "baz"]]],
    colnames=['id', 'note'],
  )

  return scheduler


if __name__ == '__main__':
  run_tests(sys.modules[__name__])
