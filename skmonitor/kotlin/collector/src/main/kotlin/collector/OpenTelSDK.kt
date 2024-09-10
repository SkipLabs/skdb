package io.opentelemetry.sdk.trace

import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.api.trace.Span
import io.opentelemetry.api.trace.SpanContext
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.api.trace.TraceFlags
import io.opentelemetry.api.trace.TraceState
import io.opentelemetry.context.Context
import io.opentelemetry.sdk.common.Clock
import io.opentelemetry.sdk.common.InstrumentationScopeInfo
import io.opentelemetry.sdk.internal.AttributesMap
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.data.LinkData
import io.skiplabs.skmonitor.Config
import io.skiplabs.skmonitor.SERVICE_NAME
import io.skiplabs.skmonitor.SERVICE_VERSION
import io.skiplabs.skmonitor.Span as SKSpan
import io.skiplabs.skmonitor.VArray
import io.skiplabs.skmonitor.VBool
import io.skiplabs.skmonitor.VFloat
import io.skiplabs.skmonitor.VInt
import io.skiplabs.skmonitor.VString
import io.skiplabs.skmonitor.Value
import java.net.InetAddress
import java.time.Instant
import java.util.concurrent.TimeUnit.SECONDS

fun traceSkSpan(
    skSpan: SKSpan,
    spanLimits: SpanLimits,
    spanProcessor: SpanProcessor,
    clock: Clock,
) {
  val defResource = Resource.getDefault()

  var attrBuilder = Attributes.builder()
  if (skSpan.service != null) {
    attrBuilder.put(AttributeKey.stringKey("service.name"), skSpan.service.name)
    attrBuilder.put(AttributeKey.stringKey("service.version"), skSpan.service.version)
  } else {
    attrBuilder.put(AttributeKey.stringKey("service.name"), SERVICE_NAME)
    attrBuilder.put(AttributeKey.stringKey("service.version"), SERVICE_VERSION)
  }

  defResource
      .getAttributes()
      .forEach({ k, v ->
        @Suppress("UNCHECKED_CAST")
        if (k.getKey().startsWith("telemetry.sdk."))
            attrBuilder.put(k as AttributeKey<String>, v.toString())
      })
  val resource = Resource.create(attrBuilder.build())
  //
  val parentContext = Context.current()
  val parentSpan =
      if (skSpan.parentId == null) Span.fromContext(parentContext)
      else
          Span.wrap(
              SpanContext.create(
                  skSpan.traceId,
                  skSpan.parentId,
                  TraceFlags.getSampled(),
                  TraceState.getDefault()
              )
          )
  val attributes =
      convertAttributes(
          skSpan.attributes,
          spanLimits.maxNumberOfAttributes,
          spanLimits.maxAttributeValueLength
      )
  try {
    val hostName = InetAddress.getLocalHost().hostName
    attributes.put(AttributeKey.stringKey("host.name"), hostName)
  } catch (e: Exception) {}
  val spanContext =
      SpanContext.create(
          skSpan.traceId,
          skSpan.spanId,
          TraceFlags.getSampled(),
          TraceState.getDefault()
      )
  val span =
      SdkSpan.startSpan(
          spanContext,
          skSpan.getFinalName(),
          InstrumentationScopeInfo.builder("skmonitor").setVersion("0.0.1").build(),
          SpanKind.PRODUCER,
          parentSpan,
          parentContext,
          spanLimits,
          spanProcessor,
          clock,
          resource,
          attributes,
          listOf<LinkData>(),
          0,
          SECONDS.toNanos(skSpan.start.s) + skSpan.start.ns,
      )
  // add event
  for (event in skSpan.events) {
    span.addEvent(
        event.name,
        convertAttributes(
            event.attributes,
            spanLimits.maxNumberOfAttributesPerEvent,
            spanLimits.maxAttributeValueLength
        ),
        Instant.ofEpochSecond(event.time.s, event.time.ns)
    )
  }
  if (skSpan.status != null) {
    val status = skSpan.status
    span.setStatus(
        when (status.status) {
          "Ok" -> StatusCode.OK
          "Error" -> StatusCode.ERROR
          else -> StatusCode.UNSET
        },
        status.message
    )
  }
  span.end(Instant.ofEpochSecond(skSpan.end.s, skSpan.end.ns))
}

fun convertAttributes(
    skAttributes: Map<String, Value>,
    capacity: Int,
    lengthLimit: Int
): AttributesMap {
  val attributes = AttributesMap.create(capacity.toLong(), lengthLimit)
  for (attribute in skAttributes.entries) {
    when (attribute.value) {
      is VInt ->
          attributes.put(AttributeKey.longKey(attribute.key), (attribute.value as VInt).value)
      is VString ->
          attributes.put(AttributeKey.stringKey(attribute.key), (attribute.value as VString).value)
      is VFloat ->
          attributes.put(AttributeKey.doubleKey(attribute.key), (attribute.value as VFloat).value)
      is VBool ->
          attributes.put(AttributeKey.booleanKey(attribute.key), (attribute.value as VBool).value)
      is VArray -> {
        val array = (attribute.value as VArray).value
        if (array.size > 0) {
          when (array[0]) {
            is VInt ->
                attributes.put(
                    AttributeKey.longArrayKey(attribute.key),
                    array.map { (it as VInt).value }
                )
            is VString ->
                attributes.put(
                    AttributeKey.stringArrayKey(attribute.key),
                    array.map { (it as VString).value }
                )
            is VFloat ->
                attributes.put(
                    AttributeKey.doubleKey(attribute.key),
                    array.map { (it as VFloat).value }
                )
            is VBool ->
                attributes.put(
                    AttributeKey.booleanKey(attribute.key),
                    array.map { (it as VBool).value }
                )
          }
        }
      }
    }
  }
  return attributes
}

fun configToSpanLimits(config: Config): SpanLimits {
  val default = SpanLimits.getDefault()
  return SpanLimits.create(
      config.maxNumAttributes ?: default.maxNumberOfAttributes,
      config.maxNumEvents ?: default.maxNumberOfEvents,
      config.maxNumLinks ?: default.maxNumberOfLinks,
      config.maxNumAttributesPerEvent ?: default.maxNumberOfAttributesPerEvent,
      config.maxNumAttributesPerLink ?: default.maxNumberOfAttributesPerLink,
      config.maxAttributeLength ?: default.maxAttributeValueLength
  )
}
