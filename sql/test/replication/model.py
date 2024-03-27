import asyncio
import uuid
import copy
from collections import defaultdict, deque
from scheduling import Task, MutableCompositeTask
from expect import Expectations
import os
import json
import itertools

SKDB = "/skdb/build/skdb"
INITSQL = "/skdb/sql/privacy/init.sql"

def serialise(val):
  if isinstance(val, str):
    return f"'{val}'"
  return str(val)

def createNativeDb(dbkey, schemaQueries, shouldInit):
  async def f(schedule):
    guid = uuid.uuid4()
    db = f"/tmp/{guid}.db"
    schedule.storeScheduleLocal(dbkey, db)

    proc = await asyncio.create_subprocess_exec(SKDB, "--init", db)
    exit = await proc.wait()
    if exit > 0:
      raise RuntimeError("init exited non-zero")

    if shouldInit:
      init = open(INITSQL)
      proc = await asyncio.create_subprocess_exec(SKDB, "--data", db, stdin=init)
      exit = await proc.wait()
      init.close()
      if exit > 0:
        raise RuntimeError("init exited non-zero")

    qs = "\n".join(schemaQueries)
    proc = await asyncio.create_subprocess_exec(SKDB, "--data", db,
                                                stdin=asyncio.subprocess.PIPE)
    await proc.communicate(qs.encode())
    if proc.returncode is None or proc.returncode > 0:
      raise RuntimeError("init exited non-zero")
  return f

def destroyNativeDb(dbkey):
  async def f(schedule):
    db = schedule.getScheduleLocal(dbkey)
    if db is None:
      raise RuntimeError("could not get db")
    os.remove(db)
  return f

def runDmlQuery(dbkey, query):
  async def f(schedule):
    db = schedule.getScheduleLocal(dbkey)
    if db is None:
      raise RuntimeError("could not get db")

    proc = await asyncio.create_subprocess_exec(SKDB, "--data", db,
                                                stdin=asyncio.subprocess.PIPE)
    await proc.communicate(query.encode())
    if proc.returncode is None or proc.returncode > 0:
      raise RuntimeError(f"running '{query}' exited non-zero")
  return f

def runQuery(dbkey, query):
  async def f(schedule):
    db = schedule.getScheduleLocal(dbkey)
    if db is None:
      raise RuntimeError("could not get db")

    proc = await asyncio.create_subprocess_exec(SKDB, "--data", db, "--format=json",
                                                stdin=asyncio.subprocess.PIPE,
                                                stdout=asyncio.subprocess.PIPE)
    (out, _) = await proc.communicate(query.encode())
    if proc.returncode is None or proc.returncode > 0:
      raise RuntimeError(f"running '{query}' exited non-zero")

    lines = out.decode().split('\n')
    return list(json.loads(x) for x in lines if x.strip() != '')
  return f

def compact(dbkey):
  async def f(schedule):
    db = schedule.getScheduleLocal(dbkey)
    if db is None:
      raise RuntimeError("could not get db")

    proc = await asyncio.create_subprocess_exec(SKDB, "--data", db, "compact",
                                                "--sync",
                                                stderr=asyncio.subprocess.PIPE)
    (_, err) = await proc.communicate()
    schedule.debug(err.decode().rstrip())
    if proc.returncode is None or proc.returncode > 0:
      raise RuntimeError(f"running 'compact' exited non-zero")
    return []
  return f

def subscribe(dbkey, subkey, table, user, dest, peerId):
  async def f(schedule):
    db = schedule.getScheduleLocal(dbkey)
    if db is None:
      raise RuntimeError("could not get db")
    proc = await asyncio.create_subprocess_exec(SKDB, "--data", db, "subscribe", table,
                                                # TODO:
                                                # "--user", user,
                                                "--ignore-source", dest,
                                                # "--peer-id", peerId,  # for multi-peer
                                                stdout=asyncio.subprocess.PIPE)
    (out, _) = await proc.communicate()
    session = out.decode().rstrip()
    schedule.storeScheduleLocal(subkey, session)
    return session
  return f

async def tail(db, session, peerId, spec):
  proc = await asyncio.create_subprocess_exec(SKDB, "--data", db, "tail",
                                              "--format=csv", session,
                                              "--read-spec",
                                              # "--peer-id", peerId,  # for multi-peer
                                              stdin=asyncio.subprocess.PIPE,
                                              stdout=asyncio.subprocess.PIPE,
                                              stderr=asyncio.subprocess.PIPE)
  (out, err) = await proc.communicate(json.dumps(spec).encode())
  return out, err

def startStreamingWriteCsv(dbkey, writecsvKey, user, source, peerId, log, enableRebuilds=False):
  async def f(schedule):
    db = schedule.getScheduleLocal(dbkey)
    if db is None:
      raise RuntimeError("could not get db")

    args = [
      "--data", db, "write-csv",
      # TODO:
      # "--user", user,
      "--source", source,
      # "--peer-id", peerId,  # for multi-peer
    ]
    if (enableRebuilds):
      args.append("--enable-rebuilds")
    proc = await asyncio.create_subprocess_exec(SKDB, *args,
                                                stdin=asyncio.subprocess.PIPE,
                                                stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE)
    schedule.storeScheduleLocal(writecsvKey, proc)
    async def logStderr():
      stream = proc.stderr
      if not stream:
        return
      buf = await stream.readline()
      while len(buf) > 0:
        log(buf.decode().rstrip())
        buf = await stream.readline()
    asyncio.create_task(logStderr())
    return proc
  return f

def getOurLastCheckpoint(current, diffOutput):
  def parse(line: str):
    ticks = line.removeprefix(':').split(' ')
    if len(ticks) < 1:
      raise RuntimeError(f"Could not parse checkpoint from {line}")
    return int(ticks[0])
  lines = diffOutput.split('\n')
  cps = [parse(l) for l in lines if l.startswith(":")]
  cps.append(current)
  cps.append(0)
  return max(cps)

def diffOutputIsSilent(diff):
  lines = diff.split('\n')
  return all(l.startswith(':') or l.strip() == "" for l in lines)

class HalfStream:

  def __init__(self, sender, receiver, sendTask, recvTask):
    self.other: HalfStream | None = None
    self.sender = sender
    self.receiver = receiver
    self.sendTaskFactory = sendTask
    self.recvTaskFactory = recvTask

  def __repr__(self):
    return f"<{self.sender} -> {self.receiver}>"

  def __str__(self):
    return f"<{self.sender} -> {self.receiver}>"

  def send(self, schedule, payload):
    schedule.getScheduleLocal(self).append(payload)
    return self

  def recv(self, schedule):
    payload =  schedule.getScheduleLocal(self).pop()
    schedule.debug(payload.decode())
    return payload

  def initTask(self):
    t = MutableCompositeTask()
    send = self.sendTaskFactory(self, init=True)
    t.add(send)
    recv = self.recvTaskFactory(self, init=True)
    t.add(recv)
    async def f(schedule):
      schedule.storeScheduleLocal(self, deque())
    t.add(Task(f"create {self} channel buffer", f))
    return t

  def sendTask(self):
    return self.sendTaskFactory(self, init=False)

  def recvTask(self):
    return self.recvTaskFactory(self, init=False)

  def clockTask(self):
    # originally we added the two tasks separtely with a
    # happens-before relation, but this blows up the number of
    # schedules
    t = MutableCompositeTask()
    t.add(self.sendTask())
    t.add(self.recvTask())
    return t

class SkdbPeer:

  def __init__(self, name, scheduler):
    self.schema = ['foo']
    self.streams = defaultdict(list)
    self.lastTask: None|Task|MutableCompositeTask = None
    self.name = name
    self.scheduler = scheduler

  def __repr__(self):
    return self.name

  def __str__(self):
    return self.name

  def notifyConnection(self, table, stream: HalfStream):
    self.streams[table].append(stream)
    return self

  def _scheduleDmlTask(self, table, task):
    self.scheduler.add(task)

    # tasks on a peer are sequential
    self.scheduler.happensBefore(self.lastTask, task)
    self.lastTask = task

    schedules = list()
    deliveryTasks = defaultdict(list)
    deliveryTasks[self.name].append(task)

    def buildDeliverySchedules(candidateEdges, sched, tasks, deliveries):
      def receivedFrom(edge, deliveries):
        # has sender received from receiver? if so, this is a no-op
        # delivery and can be pruned to avoid schedule explosion
        return edge.receiver in deliveries[edge.sender]

      def updateDeliveries(edge):
        ds = copy.copy(deliveries)
        ds[edge.receiver] = ds[edge.receiver].union({edge.sender})
        return ds

      def getNewCandidates(edge, deliveries):
        node = edge.receiver
        return [x for x in node.streams[table]
                if not receivedFrom(x, deliveries) and x not in sched]

      if candidateEdges == []:
        for a,b in itertools.pairwise(tasks):
          self.scheduler.happensBefore(a, b)
        schedules.append(tasks)

      for edge in candidateEdges:
        ourCandidateEdges = copy.copy(candidateEdges)
        ourCandidateEdges.remove(edge)
        ourSched = sched
        ourDeliveries = deliveries
        ourTasks = tasks
        if not receivedFrom(edge, deliveries):
          ourSched = copy.copy(sched)
          ourSched.append(edge)
          ourDeliveries = updateDeliveries(edge)
          ourCandidateEdges.extend(getNewCandidates(edge, ourDeliveries))
          task = edge.clockTask()
          ourTasks = copy.copy(tasks)
          ourTasks.append(task)
          deliveryTasks[edge.receiver.name].append(task)
        buildDeliverySchedules(ourCandidateEdges, ourSched, ourTasks, ourDeliveries)

    buildDeliverySchedules(self.streams[table], [], [task], defaultdict(set))

    self.scheduler.choice(schedules)

    return deliveryTasks

  def insertInto(self, table: str, row):
    rowStr = ", ".join(serialise(val) for val in row)
    q = f"INSERT INTO {table} VALUES ({rowStr});"
    insert = Task(f"insert {row} in to '{table}' on {self}", runDmlQuery(self, q))
    return self._scheduleDmlTask(table, insert)

  def insertOrReplace(self, table: str, row):
    rowStr = ", ".join(serialise(val) for val in row)
    q = f"INSERT OR REPLACE INTO {table} VALUES ({rowStr});"
    insert = Task(f"insert with replace {row} in to '{table}' on {self}", runDmlQuery(self, q))
    return self._scheduleDmlTask(table, insert)

  def deleteFromWhere(self, table: str, where: str):
    q = f"DELETE FROM {table} WHERE {where};"
    t = Task(f"'{q}' on {self}", runDmlQuery(self, q))
    return self._scheduleDmlTask(table, t)

  def updateSetWhere(self, table: str, setExprs: str, where: str):
    q = f"UPDATE {table} SET {setExprs} WHERE {where};"
    t = Task(f"'{q}' on {self}", runDmlQuery(self, q))
    return self._scheduleDmlTask(table, t)

  def purgeAllAtSomePointFromNow(self):
    t = Task(f"Purge all dirs {self}", compact(self))
    # we don't update self.lastTask as this is concurrent to other
    # tasks the peer performs, but we do define happens before as it
    # must happen at least after init (the db must be created)
    self.scheduler.add(t)
    self.scheduler.happensBefore(self.lastTask, t)
    return t

  async def query(self, schedule, query):
    return await runQuery(self, query)(schedule)

  def initTask(self) -> Task:
    raise NotImplementedError()

  def tailTask(self, table, dest, peerId):
    def factory(stream, init):
      subkey = (self, stream, 'sub')

      async def start(schedule):
        user = "todo"               # TODO:
        start = subscribe(self, subkey, table, user, dest, peerId)
        await start(schedule)

      async def pull(schedule):
        sinceKey = (self, stream, 'since')
        db = schedule.getScheduleLocal(self)
        session = schedule.getScheduleLocal(subkey)
        since = schedule.getScheduleLocal(sinceKey) or 1
        spec = { table: { "since": since } }
        payload, log = await tail(db, session, peerId, spec)
        schedule.debug(log.decode().rstrip())
        stream.send(schedule, payload)
        schedule.storeScheduleLocal(sinceKey, getOurLastCheckpoint(since, payload.decode()))

      if init:
        return Task(f"create subscription for {self} {table} {stream}", start)
      return Task(f"<{self} {table}> -> {stream}", pull)
    return factory

  def writeTask(self, source, peerId):
    def factory(stream, init):
      key = (self, stream, 'write')
      async def start(schedule):
        user = "todo"               # TODO:
        start = self.startWriteCsv(self, key, user, source, peerId, schedule.debug)
        await start(schedule)

      async def stop(schedule):
        proc = schedule.getScheduleLocal(key)
        proc.terminate()

      async def push(schedule):
        proc = schedule.getScheduleLocal(key)

        payload = stream.recv(schedule)
        proc.stdin.write(payload)
        await proc.stdin.drain()

        expectAck = payload.decode().startswith("^")
        while expectAck:
          ack = await proc.stdout.readline()
          if ack.decode().startswith(":"):
            return

      if init:
        return Task(f"start write-csv for {self} {stream}", start, stop)
      return Task(f"{stream} -> <{self}>", push)
    return factory

class Server(SkdbPeer):
  def initTask(self) -> Task:
    return Task(f"create server {self.name}",
                createNativeDb(self, self.schema, shouldInit=True),
                destroyNativeDb(self))

  def startWriteCsv(self, *args):
    return startStreamingWriteCsv(*args, enableRebuilds=False)

class Client(SkdbPeer):
  def initTask(self) -> Task:
    return Task(f"create client {self.name}",
                createNativeDb(self, self.schema, shouldInit=False),
                destroyNativeDb(self))

  def startWriteCsv(self, *args):
    return startStreamingWriteCsv(*args, enableRebuilds=True)

class Topology:

  def __init__(self, scheduler):
    self.replicationIdGen = 0
    self.schemaQueries = []
    self.peers = []
    self.scheduler = scheduler
    self.initTask = MutableCompositeTask()
    self.scheduler.add(self.initTask)

  def schema(self, query):
    self.schemaQueries.append(query)
    return self

  def add(self, peer: SkdbPeer):
    self.peers.append(peer)
    peer.schema = self.schemaQueries
    self.initTask.add(peer.initTask())
    peer.lastTask = self.initTask
    return peer

  def _genReplicationId(self):
    self.replicationIdGen = self.replicationIdGen + 1
    return str(self.replicationIdGen)

  def mirror(self, table, a, b):
    # TODO: this should take a list of tables and only setup a single
    # w-csv and tail. but currently all tests just work with one
    # table.
    repIdForA = self._genReplicationId()
    repIdForB = self._genReplicationId()
    atob = HalfStream(a, b,
                      a.tailTask(table, dest=repIdForB, peerId=a.name),
                      b.writeTask(source=repIdForA, peerId=b.name))
    btoa = HalfStream(b, a,
                      b.tailTask(table, dest=repIdForA, peerId=b.name),
                      a.writeTask(source=repIdForB, peerId=a.name))
    atob.other = btoa
    btoa.other = atob
    self.initTask.add(atob.initTask())
    self.initTask.add(btoa.initTask())
    a.notifyConnection(table, atob)
    b.notifyConnection(table, btoa)
    return self

  def state(self, query: str):
    expectations = Expectations()
    async def f(schedule):
      results = await asyncio.gather(
        *[peer.query(schedule, query) for peer in self.peers]
      )
      expectations.check(dict(zip(self.peers, results)), schedule)
    checkTask = Task(f"Check {expectations} on {query}", f)
    for scheduled in self.scheduler.tasks():
      self.scheduler.happensBefore(scheduled, checkTask)
    self.scheduler.add(checkTask)
    return expectations

  def isSilent(self):
    streams = [
      stream
      for peer in self.peers
      for table in peer.streams
      for stream in peer.streams[table]
    ]
    t = MutableCompositeTask()
    for s in streams:
      t.add(s.sendTask())
    async def f(schedule):
      for s in streams:
        out = s.recv(schedule).decode()
        if not diffOutputIsSilent(out):
          raise AssertionError(f"Not silent: {s} {out}")
    checkTask = Task(f"Check all tail output silent", f)
    t.add(checkTask)
    for scheduled in self.scheduler.tasks():
      self.scheduler.happensBefore(scheduled, t)
    self.scheduler.add(t)
