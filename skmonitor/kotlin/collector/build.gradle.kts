plugins {
  id("org.jetbrains.kotlin.jvm") version "1.9.0"
  application
  java
}

val opentelVersion = "1.37.0"
val otInstVersion = "2.2.0"
val jacksonVersion = "2.16.1"
val log4jVersion = "2.21.1"

repositories {
  mavenCentral()
}

dependencies {
  implementation("com.fasterxml.jackson.core:jackson-databind:${jacksonVersion}") // json
  implementation("com.fasterxml.jackson.core:jackson-annotations:${jacksonVersion}")
  implementation("org.apache.logging.log4j:log4j-core:${log4jVersion}")
  implementation("io.opentelemetry:opentelemetry-api:${opentelVersion}")
  implementation("io.opentelemetry:opentelemetry-sdk:${opentelVersion}")
  implementation("io.opentelemetry:opentelemetry-exporter-logging:${opentelVersion}")
  implementation("io.opentelemetry:opentelemetry-exporter-logging-otlp:${opentelVersion}")
  implementation("io.opentelemetry:opentelemetry-exporter-otlp:${opentelVersion}")
  implementation("io.opentelemetry:opentelemetry-sdk-extension-autoconfigure-spi:${opentelVersion}")
  implementation("io.opentelemetry.instrumentation:opentelemetry-instrumentation-annotations:${otInstVersion}")
}

application {
    mainClass.set("io.skiplabs.skmonitor.CollectorKt")
}

tasks.jar {
    manifest.attributes["Main-Class"] = "io.skiplabs.skmonitor.CollectorKt"
    val dependencies = configurations
        .runtimeClasspath
        .get()
        .map(::zipTree)
    from(dependencies)
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}