package io.opentelemetry.exporter.otlp

import io.opentelemetry.exporter.otlp.internal.OtlpMetricExporterProvider
import io.opentelemetry.exporter.otlp.internal.OtlpSpanExporterProvider
import io.opentelemetry.sdk.autoconfigure.spi.metrics.ConfigurableMetricExporterProvider
import io.opentelemetry.sdk.autoconfigure.spi.traces.ConfigurableSpanExporterProvider

fun defaultSpanExporterProvider(): ConfigurableSpanExporterProvider {
  return OtlpSpanExporterProvider()
}

fun defaultMetricExporterProvider(): ConfigurableMetricExporterProvider {
  return OtlpMetricExporterProvider()
}
