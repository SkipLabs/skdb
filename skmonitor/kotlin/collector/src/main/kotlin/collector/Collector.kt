package io.skiplabs.skmonitor

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import io.opentelemetry.exporter.logging.otlp.OtlpJsonLoggingMetricExporter
import io.opentelemetry.exporter.logging.otlp.OtlpJsonLoggingSpanExporter
import io.opentelemetry.sdk.autoconfigure.spi.internal.DefaultConfigProperties
import io.opentelemetry.sdk.common.Clock
import io.opentelemetry.sdk.trace.configToSpanLimits
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.BlockingQueue
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.logging.FileHandler
import java.util.logging.LogManager
import java.util.logging.Logger
import java.util.logging.SimpleFormatter

const val DEFAULT_FILEHANDLER_LIMIT = 1024 * 1024 * 10
const val DEFAULT_FILEHANDLER_COUNT = 50
const val COLLECTOR = "io.skiplabs.skmonitor"
const val PERIODIC = true

data class LogFile(
    var pattern: String = "%h/.skmonitor/skmonitor%g.log",
    var limit: Int = DEFAULT_FILEHANDLER_LIMIT,
    var count: Int = DEFAULT_FILEHANDLER_COUNT,
) {
  fun toFileHandler(): FileHandler {
    val handler = FileHandler(this.pattern, this.limit, this.count, true)
    handler.setFormatter(SimpleFormatter())
    return handler
  }
}

data class Encryption(
    var trusted: String = "",
    var certificate: String = "",
    var key: String = "",
) {
  fun isValid(): Boolean {
    return !this.trusted.isBlank() && !this.certificate.isBlank() && !this.key.isBlank()
  }
}

// Uptrace http dev endpoint
data class Endpoint(
    var protocol: String = "grpc",
    var url: String = "http://localhost:14317",
    var headers: Map<String, String> =
        mapOf("uptrace-dsn" to "http://project2_secret_token@localhost:14317/2"),
    var compression: String = "gzip",
    var timeout: String = "10s"
) {}

data class Config(
    var endpoint: Endpoint = Endpoint(),
    var logFile: LogFile = LogFile(),
    var maxNumAttributes: Int? = null,
    var maxNumEvents: Int? = null,
    var maxNumLinks: Int? = null,
    var maxNumAttributesPerEvent: Int? = null,
    var maxNumAttributesPerLink: Int? = null,
    var maxAttributeLength: Int? = null,
    var stderr: Boolean = false,
    var encryption: Encryption? = null,
    // Uptrace metric properties
    var additional: Map<String, String> =
        mapOf(
            "otel.exporter.otlp.metrics.temporality.preference" to "DELTA",
            "otel.exporter.otlp.metrics.default.histogram.aggregation" to
                "BASE2_EXPONENTIAL_BUCKET_HISTOGRAM"
        )
) {
  fun update(config: Config) {
    this.endpoint = config.endpoint
    this.logFile = config.logFile
    this.stderr = config.stderr
    if (config.maxNumAttributes != null) this.maxNumAttributes = config.maxNumAttributes
    if (config.maxNumEvents != null) this.maxNumEvents = config.maxNumEvents
    if (config.maxNumLinks != null) this.maxNumLinks = config.maxNumLinks
    if (config.maxNumAttributesPerEvent != null)
        this.maxNumAttributesPerEvent = config.maxNumAttributesPerEvent
    if (config.maxNumAttributesPerLink != null)
        this.maxNumAttributesPerLink = config.maxNumAttributesPerLink
    if (config.maxAttributeLength != null) this.maxAttributeLength = config.maxAttributeLength
    if (config.encryption != null) this.encryption = config.encryption
  }
}

data class Element(val span: Span?)

abstract class SpanManager(q: BlockingQueue<Element>) : Runnable {
  private final val queue: BlockingQueue<Element> = q

  abstract fun manage(span: Span)

  override fun run() {
    try {
      while (true) {
        val e = queue.take()
        if (e.span == null) break
        manage(e.span)
      }
    } catch (ex: InterruptedException) {
      //
    }
  }
}

fun exec(vararg cmd: String): Int {
  return ProcessBuilder(*cmd)
      .redirectOutput(ProcessBuilder.Redirect.INHERIT)
      .redirectError(ProcessBuilder.Redirect.INHERIT)
      .start()
      .waitFor()
}

fun main(args: Array<String>) {
  val quit = AtomicBoolean(false)
  val shudown = AtomicBoolean(false)
  val tmpDir = File(System.getProperty("java.io.tmpdir"))
  val monitorDir = File(tmpDir, "skmonitor")
  if (!monitorDir.exists()) {
    monitorDir.mkdir()
  }
  var logger = Logger.getLogger(OtlpJsonLoggingSpanExporter::class.java.getName())
  var metricsLogger = Logger.getLogger(OtlpJsonLoggingMetricExporter::class.java.getName())
  val jsonMapper = ObjectMapper()
  val config = checkConfig(jsonMapper)
  val spanLimits = configToSpanLimits(config)
  val clock = Clock.getDefault()
  var metrics = collectMetrics(args, jsonMapper, logger)
  val endpoint = config.endpoint
  val headers =
      endpoint.headers.entries.map { it.key + "=" + it.value }.joinToString(separator = ",")
  val otelConfig = HashMap<String, String>()
  otelConfig.put("otel.exporter.otlp.protocol", endpoint.protocol)
  otelConfig.put("otel.exporter.otlp.endpoint", endpoint.url)
  val encryption = config.encryption
  if (encryption != null && encryption.isValid()) {
    otelConfig.put("otel.exporter.otlp.certificate", encryption.trusted)
    otelConfig.put("otel.exporter.otlp.client.key", encryption.key)
    otelConfig.put("otel.exporter.otlp.client.certificate", encryption.certificate)
  }
  otelConfig.put("otel.exporter.otlp.headers", headers)
  otelConfig.put("otel.exporter.otlp.compression", endpoint.compression)
  otelConfig.put("otel.exporter.otlp.timeout", endpoint.timeout)
  for (e in config.additional.entries) {
    otelConfig.put(e.key, e.value)
  }
  val otel = initOpenTelemetry(spanLimits, clock, DefaultConfigProperties.createFromMap(otelConfig))
  val openTelemetry = otel.otel
  if (!config.stderr) {
    // Reset default logging behavior (STDERR)
    LogManager.getLogManager().reset()
  }
  // Add logging file handler
  val handler = config.logFile.toFileHandler()
  metricsLogger.addHandler(handler)
  logger.addHandler(handler)

  val tracer = openTelemetry.getTracer(COLLECTOR)
  val meter = openTelemetry.getMeter(COLLECTOR)
  val managers = ArrayList<BlockingQueue<Element>>()
  val otelTraceQueue = LinkedBlockingQueue<Element>()
  managers.add(otelTraceQueue)
  val otelMetricsQueue = LinkedBlockingQueue<Element>()
  managers.add(otelMetricsQueue)
  val metricsmanagers = computeMetrics(meter, metrics, spanLimits)
  val traceThread = Thread(OpenTelSpanManager(otelTraceQueue, otel.processor, spanLimits, clock))
  val metricsThread = Thread(OpenTelSpanMetricsManager(metricsmanagers, otelMetricsQueue))
  Runtime.getRuntime()
      .addShutdownHook(
          object : Thread() {
            override fun run() {
              otelTraceQueue.put(Element(null))
              otelMetricsQueue.put(Element(null))
              quit.set(true)
              while (!shudown.get()) {
                TimeUnit.MILLISECONDS.sleep(200)
              }
            }
          }
      )
  traceThread.start()
  metricsThread.start()
  // Check existing files
  while (!quit.get()) {
    val files = monitorDir.listFiles()?.filter { it.isFile }
    if (files != null && !files.isEmpty()) {
      for (file in files) {
        if (quit.get()) break
        if (!file.isDirectory()) {
          try {
            file.bufferedReader().forEachLine {
              val jsonSpan: JsonNode = jsonMapper.readValue(it, JsonNode::class.java)
              val skSpan = spanFromJSON(jsonSpan)
              for (manager in managers) {
                manager.put(Element(skSpan))
              }
              if (skSpan.parentId == null) {
                for (reader in otel.readers) {
                  reader.export()
                }
              }
            }
          } catch (e: Exception) {
            reportException(tracer, e)
          } finally {
            file.delete()
          }
        }
      }
    } else {
      TimeUnit.MILLISECONDS.sleep(200)
    }
  }
  openTelemetry.shutdown().join(10, TimeUnit.SECONDS)
  traceThread.join()
  metricsThread.join()
  System.out.println("Bye")
  shudown.set(true)
}

fun collectMetrics(args: Array<String>, jsonMapper: ObjectMapper, logger: Logger): Array<Metric> {
  val metrics = ArrayList<Metric>()
  for (value in args) {
    val path = Paths.get(value)
    if (!Files.exists(path)) {
      logger.warning("'" + path + "' is not a valid metrics file. (File does not exist)")
      continue
    }
    try {
      val content = Files.readString(path)
      if (content == null) {
        logger.warning("'" + path + "' is not a valid metrics file. (Unable to load file contents)")
        continue
      }
      return jsonMapper.readValue(content, Array<Metric>::class.java)
    } catch (e: Exception) {
      logger.warning("'" + path + "' is not a valid metrics file. (" + e + ")")
    }
  }
  return metrics.toTypedArray()
}

fun loadConfig(jsonMapper: ObjectMapper, path: Path): Config? {
  if (Files.exists(path)) {
    val content = Files.readString(path)
    if (content == null) return null
    return jsonMapper.readValue(content, Config::class.java)
  }
  return null
}

fun checkConfig(jsonMapper: ObjectMapper): Config {
  val userHome = System.getProperty("user.home")
  val paths =
      if (userHome != null) {
        val userPath = Paths.get(userHome)
        val confPath = userPath.resolve(".skmonitor/conf.json")
        arrayOf(confPath, Paths.get(".skmonitor.json"))
      } else {
        Array(1) { Paths.get(".skmonitor.json") }
      }
  var current: Config = Config()
  for (path in paths) {
    val config = loadConfig(jsonMapper, path)
    if (config == null) continue
    current.update(config)
  }
  return current
}
