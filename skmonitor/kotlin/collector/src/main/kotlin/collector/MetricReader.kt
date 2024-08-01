package io.skiplabs.skmonitor

import io.opentelemetry.exporter.logging.otlp.OtlpJsonLoggingSpanExporter
import io.opentelemetry.sdk.common.CompletableResultCode
import io.opentelemetry.sdk.common.export.MemoryMode
import io.opentelemetry.sdk.metrics.Aggregation
import io.opentelemetry.sdk.metrics.InstrumentType
import io.opentelemetry.sdk.metrics.data.AggregationTemporality
import io.opentelemetry.sdk.metrics.export.CollectionRegistration
import io.opentelemetry.sdk.metrics.export.MetricExporter
import io.opentelemetry.sdk.metrics.export.MetricReader
import java.util.logging.Level
import java.util.logging.Logger

class SkMetricReader(exporter: MetricExporter) : MetricReader {
  var logger = Logger.getLogger(OtlpJsonLoggingSpanExporter::class.java.getName())
  val exporter = exporter
  var collectionRegistration = CollectionRegistration.noop()

  companion object {
    /** Returns a {@link SkMetricReader} which exports to the {@code exporter} once every minute. */
    fun create(exporter: MetricExporter): SkMetricReader {
      return builder(exporter).build()
    }
    /** Returns a {@link SkMetricReader}. */
    fun builder(exporter: MetricExporter): SkMetricReaderBuilder {
      return SkMetricReaderBuilder(exporter)
    }
  }

  override fun getAggregationTemporality(instrumentType: InstrumentType): AggregationTemporality {
    return exporter.getAggregationTemporality(instrumentType)
  }

  override fun getDefaultAggregation(instrumentType: InstrumentType): Aggregation {
    return exporter.getDefaultAggregation(instrumentType)
  }

  override fun getMemoryMode(): MemoryMode {
    return exporter.getMemoryMode()
  }

  override fun forceFlush(): CompletableResultCode {
    return CompletableResultCode.ofSuccess()
  }

  override fun shutdown(): CompletableResultCode {
    return CompletableResultCode.ofSuccess()
  }

  fun export() {
    val metricData = collectionRegistration.collectAllMetrics()
    if (metricData.isEmpty()) {
      logger.log(Level.FINE, "No metric data to export - skipping export.")
    } else {
      val result = exporter.export(metricData)
      result.whenComplete({
        if (!result.isSuccess()) {
          logger.log(Level.FINE, "Exporter failed")
        }
      })
    }
  }

  override fun register(collectionRegistration: CollectionRegistration) {
    this.collectionRegistration = collectionRegistration
  }

  override fun toString(): String {
    return "SkMetricReader{" + "exporter=" + exporter + "}"
  }

  fun start() {
    System.out.println("SkMetricReader.start")
  }
}

class SkMetricReaderBuilder(exporter: MetricExporter) {
  val exporter = exporter

  /** Constructs a {@link SkMetricReader} based on the builder's values. */
  fun build(): SkMetricReader {
    return SkMetricReader(this.exporter)
  }
}
