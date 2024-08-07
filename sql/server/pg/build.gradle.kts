/*
 * This file was generated by the Gradle 'init' task.
 *
 * This generated file contains a sample Kotlin library project to get you started.
 * For more details take a look at the 'Building Java & JVM projects' chapter in the Gradle
 * User Manual available at https://docs.gradle.org/8.1.1/userguide/building_java_projects.html
 */

plugins {
  id("org.jetbrains.kotlin.jvm")
  id("com.diffplug.spotless") version "6.12.1"

  `java-library`
}

repositories {
  // Use Maven Central for resolving dependencies.
  mavenCentral()
}

dependencies {
  implementation(project(":core"))
  implementation("org.postgresql:postgresql:42.7.3") //pgjdbc
}

// Apply a specific Java toolchain to ease working on different environments.
java { toolchain { languageVersion.set(JavaLanguageVersion.of(20)) } }

spotless { kotlin { ktfmt("0.49") } }

task("replication", JavaExec::class) {
  mainClass.set("io.skiplabs.skdb.pg.RepliTestKt")
  classpath = sourceSets["test"].runtimeClasspath
}
