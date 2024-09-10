package io.opentelemetry.sdk.trace.export

fun multiSpanExporter(exporters: List<SpanExporter>): SpanExporter {
  return MultiSpanExporter.create(exporters)
}
