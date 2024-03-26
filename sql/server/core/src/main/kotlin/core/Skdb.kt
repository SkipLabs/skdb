package io.skiplabs.skdb

import java.io.File
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64

val DB_ROOT_USER = "root"

enum class OutputFormat(val flag: String) {
  RAW("--format=sql"),
  JSON("--format=json"),
  CSV("--format=csv"),
}

// represents the complete output of a process run.
data class ProcessOutput(val output: ByteArray, val exitCode: Int) {
  fun exitSuccessfully(): Boolean {
    return exitCode == 0
  }

  fun logOnError(): ProcessOutput {
    if (!exitSuccessfully()) {
      System.err.println(decode())
    }
    return this
  }

  fun getOrThrow(): ByteArray {
    if (!exitSuccessfully()) {
      logOnError()
      throw RuntimeException("Process exited unsuccessfully: ${exitCode}")
    }
    return output
  }

  fun decode(): String {
    return String(output, StandardCharsets.UTF_8)
  }

  fun decodeOrThrow(): String {
    return String(getOrThrow(), StandardCharsets.UTF_8)
  }
}

data class TailSpec(
    val since: Int,
    val filterExpr: String,
    val filterParams: Map<String, Any?>,
    val expectedSchema: String
)

// super dumb, mostly synchronous, process facade
class Skdb(val name: String, private val dbPath: String) {

  private fun blockingRun(pb: ProcessBuilder, input: String? = null): ProcessOutput {
    // capture error output too. if you'are authenticated to run the
    // command you should also be able to see any issues.
    pb.redirectErrorStream(true)

    val proc = pb.start()

    if (input != null) {
      val writer = proc.outputStream.bufferedWriter()
      writer.write(input)
      writer.close()
    }

    val output = proc.inputStream.readAllBytes()

    // TODO: should have a timeout
    val exitCode = proc.waitFor()

    return ProcessOutput(output, exitCode)
  }

  fun init() {
    blockingRun(ProcessBuilder(ENV.skdbPath, "--init", dbPath))
  }

  fun sql(stmts: String, format: OutputFormat, expectQueryParams: Boolean = false): ProcessOutput {
    val pb =
        if (expectQueryParams)
            ProcessBuilder(ENV.skdbPath, "--data", dbPath, format.flag, "--expect-query-params")
        else ProcessBuilder(ENV.skdbPath, "--data", dbPath, format.flag)
    return blockingRun(pb, stmts)
  }

  fun sql(stmts: String, params: Map<String, Any?>, format: OutputFormat): ProcessOutput {
    val buf = StringBuilder()
    buf.append(jsonMapper.writeValueAsString(params))
    buf.append("\n")
    buf.append(stmts)
    return blockingRun(
        ProcessBuilder(ENV.skdbPath, "--data", dbPath, format.flag, "--expect-query-params"),
        buf.toString())
  }

  fun sqlStream(format: OutputFormat): Process {
    val pb = ProcessBuilder(ENV.skdbPath, "--data", dbPath, format.flag)

    // TODO: for hacky debug
    pb.redirectError(ProcessBuilder.Redirect.INHERIT)

    val proc = pb.start()
    return proc
  }

  fun replicationId(deviceUuid: String): ProcessOutput {
    return blockingRun(ProcessBuilder(ENV.skdbPath, "replication-id", deviceUuid, "--data", dbPath))
  }

  fun dumpTable(table: String, suffix: String): ProcessOutput {
    return blockingRun(
        ProcessBuilder(
            ENV.skdbPath, "dump-table", table, "--data", dbPath, "--table-suffix", suffix))
  }

  fun dumpView(view: String): ProcessOutput {
    return blockingRun(ProcessBuilder(ENV.skdbPath, "dump-view", view, "--data", dbPath))
  }

  fun dumpSchema(): ProcessOutput {
    val tables = blockingRun(ProcessBuilder(ENV.skdbPath, "dump-tables", "--data", dbPath))
    if (!tables.exitSuccessfully()) return tables
    val views = blockingRun(ProcessBuilder(ENV.skdbPath, "dump-views", "--data", dbPath))
    return ProcessOutput(tables.output + views.output, views.exitCode)
  }

  fun migrate(schema: String): ProcessOutput {
    return blockingRun(ProcessBuilder(ENV.skdbPath, "migrate", "--data", dbPath), schema)
  }

  fun writeCsv(
      user: String,
      replicationId: String,
      schemas: String,
      callback: (ByteBuffer, shouldFlush: Boolean) -> Unit,
      closed: () -> Unit,
  ): Process {
    val pb =
        ProcessBuilder(
            ENV.skdbPath,
            "write-csv",
            "--data",
            dbPath,
            "--user",
            user,
            "--source",
            replicationId,
            "--expect-schemas")

    // TODO: for hacky debug
    pb.redirectError(ProcessBuilder.Redirect.INHERIT)

    val proc = pb.start()

    val stdin = proc.outputStream.buffered()
    stdin.write((schemas + "\n").toByteArray(StandardCharsets.UTF_8))

    // Don't close yet, as we still need to write actual CSV data
    stdin.flush()

    // we work with text lines as it is convenient. there's a trivial
    // amount of work going on to decode and re-encode here - just
    // checkpoints
    val output = proc.inputStream.bufferedReader()

    val t =
        Thread({
          try {
            val encoder = StandardCharsets.UTF_8.newEncoder()
            output.forEachLine {
              callback(encoder.encode(CharBuffer.wrap(it + "\n")), it.startsWith(":"))
            }
            closed()
          } catch (ex: Exception) {
            closed()
          }
        })
    t.start()

    return proc
  }

  fun tail(
      user: String,
      replicationId: String,
      spec: Map<String, TailSpec>,
      callback: (ByteBuffer, shouldFlush: Boolean) -> Unit,
      closed: () -> Unit,
  ): Process {
    val connPb =
        ProcessBuilder(
            ENV.skdbPath, "subscribe", "--data", dbPath, "--ignore-source", replicationId)
    for (table in spec.keys) {
      connPb.command().add(table)
    }
    // TODO: check for existing
    val connection = blockingRun(connPb).decode()
    val tailPb =
        ProcessBuilder(
            ENV.skdbPath,
            "tail",
            "--data",
            dbPath,
            "--format=csv",
            connection.trim(),
            "--follow",
            "--user",
            user,
            "--read-spec")

    // TODO: for hacky debug
    tailPb.redirectError(ProcessBuilder.Redirect.INHERIT)
    val proc = tailPb.start()

    val stdin = proc.outputStream.buffered()
    jsonMapper.writeValue(stdin, spec)
    stdin.close()

    // TODO: working with text currently to detect checkpoint flush
    // markers. this should change as it is expensive. I particularly
    // don't like having to allocate 4x here.
    val output = proc.inputStream.bufferedReader()

    val t =
        Thread({
          try {
            val acc = ArrayList<String>()
            output.forEachLine {
              acc.add(it)

              val shouldFlush = it.startsWith(":")
              // threshold is fairly arbitrary. tested a handful of
              // values. it's mostly a guess at a good value to save the
              // arraylist from doing another double allocate/copy
              val shouldSend = acc.size > 8191 || shouldFlush

              if (shouldSend) {
                val payload = acc.joinToString(separator = "\n", postfix = "\n")

                val encoder = StandardCharsets.UTF_8.newEncoder()
                val buf = ByteBuffer.allocate(payload.length * 4 + 1)
                var res = encoder.encode(CharBuffer.wrap(payload), buf, true)
                if (!res.isUnderflow()) {
                  res.throwException()
                }
                res = encoder.flush(buf)
                if (!res.isUnderflow()) {
                  res.throwException()
                }

                callback(buf.flip(), shouldFlush)
                acc.clear()
              }
            }
            closed()
          } catch (ex: Exception) {
            closed()
          }
        })
    t.start()

    return proc
  }

  fun notify(
      table: String,
      callback: () -> Unit,
  ) {
    val notifyFile = File.createTempFile("notify", table)
    // TODO: notifyFile.deleteOnExit() -- need to unsubscribe first

    val connection =
        blockingRun(
            ProcessBuilder(
                ENV.skdbPath, "subscribe", table, "--data", dbPath, "--notify", notifyFile.path))

    if (!connection.exitSuccessfully()) {
      throw RuntimeException("Notify failed")
    }

    var tick = ""
    // super dumb right now. just poll the file.
    val t =
        Thread({
          while (true) {
            val now = Files.readString(notifyFile.toPath())
            if (now != tick) {
              tick = now
              callback()
            }
            Thread.sleep(1000)
          }
        })
    t.start()
  }

  fun privateKeyAsStored(user: String): ByteArray {
    val key =
        sql(
                "SELECT privateKey FROM skdb_users WHERE userID = @user;",
                mapOf("user" to user),
                OutputFormat.RAW)
            .decodeOrThrow()
            .trim()

    if (key.isEmpty()) {
      throw IllegalArgumentException("User ${user} could not be found.")
    }

    return Base64.getDecoder().decode(key)
  }

  fun createDb(encryptedRootPrivateKey: String): Skdb {
    if (File(dbPath).exists()) {
      return openSkdb(name)!!
    }
    val initScript = Files.readString(Path.of(ENV.skdbInitPath), Charsets.UTF_8)
    blockingRun(ProcessBuilder(ENV.skdbPath, "--init", dbPath))
    blockingRun(ProcessBuilder(ENV.skdbPath, "--data", dbPath), initScript)
    sql(
        "INSERT INTO skdb_users VALUES ('${DB_ROOT_USER}', @key)",
        mapOf("key" to encryptedRootPrivateKey),
        OutputFormat.RAW)
    return this
  }

  fun createUser(encryptedPrivateKey: String): String {
    val accessKey =
        sql(
                "BEGIN TRANSACTION; INSERT INTO skdb_users VALUES (id('userID'), @privateKey); SELECT id('userID'); COMMIT;",
                mapOf("privateKey" to encryptedPrivateKey),
                OutputFormat.RAW)
            .decodeOrThrow()
            .trim()
    return accessKey
  }

  fun canMirror(table: String, schema: String): Boolean {
    val result = blockingRun(ProcessBuilder(ENV.skdbPath, "can-mirror", table, schema))
    result.logOnError()
    return result.exitSuccessfully() && result.decode() == ""
  }
}

fun openSkdb(db: String?): Skdb? {
  if (db == null) {
    return null
  }

  val dbPath = ENV.resolveDbPath(db)
  if (!File(dbPath).exists()) return null

  return Skdb(db, dbPath)
}

fun createSkdb(db: String, encryptedRootPrivateKey: String): Skdb {
  return Skdb(db, ENV.resolveDbPath(db)).createDb(encryptedRootPrivateKey)
}
