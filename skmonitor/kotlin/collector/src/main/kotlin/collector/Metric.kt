package io.skiplabs.skmonitor

import com.fasterxml.jackson.databind.JsonNode
import io.opentelemetry.api.metrics.DoubleCounter
import io.opentelemetry.api.metrics.DoubleHistogram
import io.opentelemetry.api.metrics.LongCounter
import io.opentelemetry.api.metrics.LongHistogram
import io.opentelemetry.api.metrics.Meter
import io.opentelemetry.sdk.internal.AttributesMap
import io.opentelemetry.sdk.trace.SpanLimits
import io.opentelemetry.sdk.trace.convertAttributes
import java.util.concurrent.BlockingQueue
import java.util.logging.Logger

const val METRICS_ATTRIBUTE_MODE = "attribute"
const val METRICS_COUNT_MODE = "count"
const val METRICS_DURATION_MODE = "duration"
const val METRICS_EVENT_MODE = "event"

const val METRICS_COUNTER_KIND = "counter"
const val METRICS_HISTOGRAL_KIND = "histogram"

const val DEFAULT_METRICS_NAME = "skmonitor.unknown"

typealias StatusHandler = (status: Status?) -> Boolean

class OpenTelSpanMetricsManager(
    managers: ArrayList<SpanMetricsManager>,
    q: BlockingQueue<Element>,
) : SpanManager(q) {
  private val managers = managers

  override fun manage(span: Span) {
    for (manager in this.managers) {
      manager.manage(span)
    }
  }
}

data class Export(
    var name: String? = null,
    var asname: String? = null,
)

data class Metric(
    var name: String = DEFAULT_METRICS_NAME,
    var unit: String? = null,
    var description: String? = null,
    var mode: String = METRICS_ATTRIBUTE_MODE,
    var spans: Array<String> = arrayOf(),
    var key: String? = null,
    var kind: String = METRICS_COUNTER_KIND,
    var filter: Map<String, JsonNode> = HashMap(),
    var exports: Array<Export> = arrayOf(),
    var floatValue: Boolean = false,
    var status: String? = null,
) {
  fun withDefaultUnit(unit: String): Metric {
    if (this.unit == null) this.unit = unit
    return this
  }
}

class Values(
    val dHistogram: DoubleHistogram?,
    val dCounter: DoubleCounter?,
    val lHistogram: LongHistogram?,
    val lCounter: LongCounter?,
) {
  companion object {
    fun build(metric: Metric, meter: Meter): Values {
      return when (metric.kind) {
        METRICS_HISTOGRAL_KIND ->
            if (metric.floatValue) Values(buildDoubleHistogram(metric, meter), null, null, null)
            else Values(null, null, buildLongHistogram(metric, meter), null)
        else ->
            if (metric.floatValue) Values(null, buildDoubleCounter(metric, meter), null, null)
            else Values(null, null, null, buildLongCounter(metric, meter))
      }
    }
  }

  fun update(value: Value, attributes: () -> AttributesMap) {
    if (this.dHistogram != null || this.dCounter != null) {
      val double =
          when (value) {
            is VInt -> value.value.toDouble()
            is VFloat -> value.value
            else -> null
          }
      if (double != null) {
        if (this.dHistogram != null) this.dHistogram.record(double, attributes())
        if (this.dCounter != null) this.dCounter.add(double, attributes())
      }
    }
    if (this.lHistogram != null || this.lCounter != null) {
      val long =
          when (value) {
            is VInt -> value.value
            is VFloat -> value.value.toLong()
            else -> null
          }
      if (long != null) {
        if (this.lHistogram != null) this.lHistogram.record(long, attributes())
        if (this.lCounter != null) this.lCounter.add(long, attributes())
      }
    }
  }
}

interface SpanMetricsManager {
  fun manage(span: Span)
}

fun status(status: String?): StatusHandler? {
  if (status == null) return { _ -> true }
  return { it ->
    var statusStr = if (it != null) it.status.uppercase() else "UNSET"
    if (status.startsWith("!")) {
      !status.equals("!" + statusStr)
    } else {
      status.equals(statusStr)
    }
  }
}

abstract class MetricComputer(
    metric: Metric,
    meter: Meter,
    spanLimits: SpanLimits,
) : SpanMetricsManager {
  val metric = metric
  val collection = Values.build(metric, meter)
  val spanLimits = spanLimits
  val logger = Logger.getLogger(MetricComputer::class.java.getName())
  val status: StatusHandler? = status(metric.status)

  abstract fun value(span: Span): Value?

  override fun manage(span: Span) {
    val statusH = this.status
    if (statusH != null && !statusH(span.status)) return
    if (!metric.spans.isEmpty() && metric.spans.filter { it.equals(span.name) }.isEmpty()) return
    val attrFilter = metric.filter.mapValues { toValue(it.value) }
    for (filter in attrFilter) {
      val value = span.attributes.get(filter.key)
      if (value == null || !value.equals(filter.value)) return
    }
    var value = value(span)
    if (value == null) return
    this.collection.update(value) { buildAttributes(span, this.metric.exports, this.spanLimits) }
  }
}

class AttributeMetric(metric: Metric, meter: Meter, spanLimits: SpanLimits) :
    MetricComputer(metric, meter, spanLimits) {

  override fun value(span: Span): Value? {
    val name = if (this.metric.key != null) this.metric.key!! else this.metric.name
    return span.attributes.get(name)
  }
}

class SpanMetric(metric: Metric, meter: Meter, spanLimits: SpanLimits) :
    MetricComputer(metric, meter, spanLimits) {

  override fun value(span: Span): Value? {
    return VInt(1)
  }
}

class EventMetric(metric: Metric, meter: Meter, spanLimits: SpanLimits) :
    MetricComputer(metric, meter, spanLimits) {

  override fun value(span: Span): Value? {
    var count = 0L
    for (event in span.events) {
      if (this.metric.key != null && !event.name.equals(this.metric.key)) continue
      count++
    }
    return VInt(count)
  }
}

class DurationMetric(metric: Metric, meter: Meter, spanLimits: SpanLimits) :
    MetricComputer(metric, meter, spanLimits) {

  override fun value(span: Span): Value? {
    return VFloat(span.duration(this.metric.unit!!))
  }
}

fun computeMetrics(
    meter: Meter,
    metrics: Array<Metric>,
    spanLimits: SpanLimits,
): ArrayList<SpanMetricsManager> {
  val managers = ArrayList<SpanMetricsManager>()
  for (metric in metrics) {
    if (metric.name.equals(DEFAULT_METRICS_NAME)) continue
    when (metric.mode) {
      METRICS_ATTRIBUTE_MODE -> managers.add(AttributeMetric(metric, meter, spanLimits))
      METRICS_COUNT_MODE -> managers.add(SpanMetric(metric, meter, spanLimits))
      METRICS_DURATION_MODE -> managers.add(DurationMetric(metric, meter, spanLimits))
      METRICS_EVENT_MODE -> managers.add(EventMetric(metric, meter, spanLimits))
    }
  }
  return managers
}

fun buildAttributes(span: Span, exports: Array<Export>, spanLimits: SpanLimits): AttributesMap {
  val skAttributes = HashMap<String, Value>()
  skAttributes.put("trace", VString(span.traceId))
  if (span.parentId != null) {
    skAttributes.put("parent", VString(span.parentId))
  }
  for (e in exports) {
    if (e.name == null) continue
    val attr = span.attributes.get(e.name)
    if (attr == null) continue
    skAttributes.put(if (e.asname == null) e.name!! else e.asname!!, attr)
  }
  return convertAttributes(
      skAttributes,
      spanLimits.maxNumberOfAttributes,
      spanLimits.maxAttributeValueLength
  )
}
