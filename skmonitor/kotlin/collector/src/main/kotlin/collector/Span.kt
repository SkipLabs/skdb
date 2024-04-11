package io.skiplabs.skmonitor

import com.fasterxml.jackson.databind.JsonNode
import java.time.Duration
import java.time.Instant

data class Time(var s: Long, var ns: Long)

data class Event(var name: String, var attributes: Map<String, Value>, var time: Time)

data class Status(val status: String, val message: String)

data class Service(val name: String, val version: String)

data class Span(
    val traceId: String,
    val spanId: String,
    val parentId: String?,
    val name: String?,
    val start: Time,
    val end: Time,
    val events: Array<Event>,
    val attributes: Map<String, Value>,
    val status: Status?,
    val service: Service?
) {
  fun getFinalName(): String {
    if (this.name == null) return "skmonitor.operation"
    return this.name
  }

  fun status(): String {
    return if (status != null) status.status.uppercase() else "UNSET"
  }

  fun duration(unit: String): Double {
    val start = Instant.ofEpochSecond(this.start.s, this.start.ns)
    val end = Instant.ofEpochSecond(this.end.s, this.end.ns)
    val duration = Duration.between(start, end)
    val divider =
        when (unit) {
          "d" -> 24 * 60 * 60 * 1_000_000_000.0
          "h" -> 60 * 60 * 1_000_000_000.0
          "m" -> 60 * 1_000_000_000.0
          "ms" -> 1_000_000.0
          "µs" -> 1_000.0
          "ns" -> 1.0
          else -> 1_000_000_000.0
        }
    return duration.toNanos().toDouble() / divider
  }
}

fun toTime(jsonTime: JsonNode): Time {
  var idx = 0
  var v1: Long = 0L
  var v2: Long = 0L
  for (e in jsonTime.asIterable()) {
    if (idx == 0) {
      v1 = e.asLong()
    } else {
      v2 = e.asLong()
      break
    }
    idx++
  }
  return Time(v1, v2)
}

fun toEvents(jsonEvents: JsonNode?): Array<Event> {
  if (jsonEvents == null) return arrayOf<Event>()
  val events = jsonEvents.asIterable().map { toEvent(it) }
  return events.toTypedArray()
}

fun toAttributes(jsonAttributes: JsonNode?): Map<String, Value> {
  if (jsonAttributes == null) return emptyMap()
  val fieldNames = jsonAttributes.fieldNames()
  var res = emptyMap<String, Value>()
  for (fieldName in fieldNames) {
    res += Pair(fieldName, toValue(jsonAttributes.get(fieldName)))
  }
  return res
}

fun toStatus(jsonStatus: JsonNode?): Status? {
  if (jsonStatus == null) return null
  return Status(jsonStatus.get("status").asText(), jsonStatus.get("message").asText())
}

fun toService(jsonService: JsonNode?): Service? {
  if (jsonService == null) return null
  return Service(jsonService.get("name").asText(), jsonService.get("version").asText())
}

fun toEvent(jsonEvent: JsonNode): Event {
  return Event(
      jsonEvent.get("name").asText(),
      toAttributes(jsonEvent.get("attributes")),
      toTime(jsonEvent.get("time"))
  )
}

fun spanFromJSON(jsonSpan: JsonNode): Span {
  return Span(
      jsonSpan.get("traceId").asText(),
      jsonSpan.get("spanId").asText(),
      jsonSpan.get("parentId")?.asText(),
      jsonSpan.get("name")?.asText(),
      toTime(jsonSpan.get("start")),
      toTime(jsonSpan.get("end")),
      toEvents(jsonSpan.get("events")),
      toAttributes(jsonSpan.get("attributes")),
      toStatus(jsonSpan.get("status")),
      toService(jsonSpan.get("service"))
  )
}
