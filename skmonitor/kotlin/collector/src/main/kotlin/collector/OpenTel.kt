package io.skiplabs.skmonitor

// import io.opentelemetry.sdk.metrics.export.PeriodicMetricReader
import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.api.metrics.DoubleCounter
import io.opentelemetry.api.metrics.DoubleHistogram
import io.opentelemetry.api.metrics.LongCounter
import io.opentelemetry.api.metrics.LongHistogram
import io.opentelemetry.api.metrics.Meter
import io.opentelemetry.api.trace.StatusCode.ERROR
import io.opentelemetry.api.trace.Tracer
import io.opentelemetry.exporter.logging.otlp.OtlpJsonLoggingMetricExporter
import io.opentelemetry.exporter.logging.otlp.OtlpJsonLoggingSpanExporter
import io.opentelemetry.exporter.otlp.defaultMetricExporterProvider
import io.opentelemetry.exporter.otlp.defaultSpanExporterProvider
import io.opentelemetry.sdk.OpenTelemetrySdk
import io.opentelemetry.sdk.autoconfigure.spi.ConfigProperties
import io.opentelemetry.sdk.common.Clock
import io.opentelemetry.sdk.metrics.SdkMeterProvider
import io.opentelemetry.sdk.metrics.export.MetricExporter
import io.opentelemetry.sdk.metrics.export.MetricReader
import io.opentelemetry.sdk.metrics.export.PeriodicMetricReader
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.SpanLimits
import io.opentelemetry.sdk.trace.SpanProcessor
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor
import io.opentelemetry.sdk.trace.export.SpanExporter
import io.opentelemetry.sdk.trace.export.multiSpanExporter
import io.opentelemetry.sdk.trace.traceSkSpan
import java.time.Duration
import java.util.concurrent.BlockingQueue

const val SERVICE_NAME = "skmonitor.collector"
const val SERVICE_VERSION = "0.0.1"

const val METRIC_EXPORT_INTERVAL_S = 10L

class OpenTelSpanManager(
    q: BlockingQueue<Element>,
    spanProcessor: SpanProcessor,
    spanLimits: SpanLimits,
    clock: Clock,
) : SpanManager(q) {
  // todo define timeout for partial send
  // todo maximum number of stanby span
  val spanProcessor: SpanProcessor = spanProcessor
  val spanLimits: SpanLimits = spanLimits
  val clock: Clock = clock

  override fun manage(span: Span) {
    traceSkSpan(span, this.spanLimits, this.spanProcessor, this.clock)
  }
}

fun reportException(tracer: Tracer, exn: Exception) {
  val message: String = if (exn.message != null) exn.message!! else ""
  var span = tracer.spanBuilder("skmonitor.collector").startSpan()
  span.setStatus(ERROR, message)
  span.end()
}

data class Otel(
    val otel: OpenTelemetrySdk,
    val processor: SpanProcessor,
    val readers: Array<SkMetricReader>,
)

data class SkTracer(
    val provider: SdkTracerProvider,
    val processor: SpanProcessor,
)

data class SkMetric(
    val provider: SdkMeterProvider,
    val readers: Array<SkMetricReader>,
)

fun initOpenTelemetry(
    spanLimits: SpanLimits,
    clock: Clock,
    otelConfig: ConfigProperties? = null
): Otel {
  val meter = initMetrics(otelConfig)
  val tracer = initTraces(spanLimits, clock, otelConfig)
  val otelBuilder =
      OpenTelemetrySdk.builder().setTracerProvider(tracer.provider).setMeterProvider(meter.provider)
  return Otel(otelBuilder.buildAndRegisterGlobal(), tracer.processor, meter.readers)
}

fun initTraces(spanLimits: SpanLimits, clock: Clock, otelConfig: ConfigProperties?): SkTracer {
  val tracerProviderBuilder = SdkTracerProvider.builder()
  tracerProviderBuilder.setClock(clock)
  tracerProviderBuilder.setSpanLimits(spanLimits)
  tracerProviderBuilder.setResource(Resource.getDefault())
  val exporters = ArrayList<SpanExporter>()
  if (otelConfig != null) {
    val exporterProvider = defaultSpanExporterProvider()
    exporters.add(exporterProvider.createExporter(otelConfig))
  }
  exporters.add(OtlpJsonLoggingSpanExporter.create())
  val processor =
      BatchSpanProcessor.builder(multiSpanExporter(exporters))
          .setScheduleDelay(Duration.ofSeconds(1))
          .build()
  return SkTracer(tracerProviderBuilder.addSpanProcessor(processor).build(), processor)
}

fun initMetrics(otelConfig: ConfigProperties?): SkMetric {
  // METRICS
  val defResource = Resource.getDefault()
  var attrBuilder = Attributes.builder()
  attrBuilder.put(AttributeKey.stringKey("service.name"), SERVICE_NAME)
  attrBuilder.put(AttributeKey.stringKey("service.version"), SERVICE_VERSION)
  defResource
      .getAttributes()
      .forEach({ k, v ->
        @Suppress("UNCHECKED_CAST")
        if (k.getKey().startsWith("telemetry.sdk."))
            attrBuilder.put(k as AttributeKey<String>, v.toString())
      })
  val skReaders = ArrayList<SkMetricReader>()
  val meterProviderBuilder = SdkMeterProvider.builder()
  meterProviderBuilder.setResource(Resource.create(attrBuilder.build()))
  if (PERIODIC) {
    val readers = ArrayList<MetricReader>()
    readers.add(PeriodicMetricReader.builder(OtlpJsonLoggingMetricExporter.create()).build())
    if (otelConfig != null) {
      var httpBuilder = defaultMetricExporterProvider()
      readers.add(
          PeriodicMetricReader.builder(httpBuilder.createExporter(otelConfig))
              .setInterval(Duration.ofSeconds(10))
              .build()
      )
    }
    for (reader in readers) {
      meterProviderBuilder.registerMetricReader(reader)
    }
  } else {
    skReaders.add(buildMetricReader(OtlpJsonLoggingMetricExporter.create()))

    if (otelConfig != null) {
      var httpBuilder = defaultMetricExporterProvider()
      var metricReader = buildMetricReader(httpBuilder.createExporter(otelConfig))
      skReaders.add(metricReader)
    }
    for (reader in skReaders) {
      meterProviderBuilder.registerMetricReader(reader)
    }
  }
  return SkMetric(meterProviderBuilder.build(), skReaders.toTypedArray())
}

fun buildMetricReader(exporter: MetricExporter): SkMetricReader {
  return SkMetricReader.builder(exporter).build()
}

fun buildDoubleHistogram(metric: Metric, meter: Meter, suffix: String = ""): DoubleHistogram {
  val histogramBuilder = meter.histogramBuilder(metric.name + suffix)
  if (metric.unit != null) histogramBuilder.setUnit(metric.unit!!)
  if (metric.description != null) histogramBuilder.setDescription(metric.description!!)
  return histogramBuilder.build()
}

fun buildLongHistogram(metric: Metric, meter: Meter, suffix: String = ""): LongHistogram {
  val histogramBuilder = meter.histogramBuilder(metric.name + suffix).ofLongs()
  if (metric.unit != null) histogramBuilder.setUnit(metric.unit!!)
  if (metric.description != null) histogramBuilder.setDescription(metric.description!!)
  return histogramBuilder.build()
}

fun buildLongCounter(metric: Metric, meter: Meter, suffix: String = ""): LongCounter {
  val counterBuilder = meter.counterBuilder(metric.name + suffix)
  if (metric.unit != null) counterBuilder.setUnit(metric.unit!!)
  if (metric.description != null) counterBuilder.setDescription(metric.description!!)
  return counterBuilder.build()
}

fun buildDoubleCounter(metric: Metric, meter: Meter, suffix: String = ""): DoubleCounter {
  val counterBuilder = meter.counterBuilder(metric.name + suffix).ofDoubles()
  if (metric.unit != null) counterBuilder.setUnit(metric.unit!!)
  if (metric.description != null) counterBuilder.setDescription(metric.description!!)
  return counterBuilder.build()
}
