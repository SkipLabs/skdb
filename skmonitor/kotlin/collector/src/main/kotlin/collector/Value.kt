package io.skiplabs.skmonitor

import com.fasterxml.jackson.databind.JsonNode

abstract class Value {
  abstract fun toValue(): Any

  override fun toString(): String {
    return toValue().toString()
  }
}

data class VInt(var value: Long) : Value() {
  override fun toValue(): Any {
    return this.value
  }
}

data class VString(var value: String) : Value() {
  override fun toValue(): Any {
    return this.value
  }
}

data class VFloat(var value: Double) : Value() {
  override fun toValue(): Any {
    return this.value
  }
}

data class VBool(var value: Boolean) : Value() {
  override fun toValue(): Any {
    return this.value
  }
}

data class VArray(var value: Array<Value>) : Value() {
  override fun toString(): String {
    return this.value.toString()
  }

  override fun toValue(): Any {
    return this.value.map { it.toValue() }
  }
}

const val INT_FIELD_NAME = "int"

fun toValue(jsonValue: JsonNode): Value {
  if (jsonValue.isInt()) return VInt(jsonValue.asLong())
  if (jsonValue.isTextual()) return VString(jsonValue.asText())
  if (jsonValue.isNumber()) return VFloat(jsonValue.asDouble())
  if (jsonValue.isBoolean()) return VBool(jsonValue.asBoolean())
  if (jsonValue.isArray()) return VArray(jsonValue.asIterable().map { toValue(it) }.toTypedArray())

  return VInt(jsonValue.get(INT_FIELD_NAME).asText().toLong())
}
