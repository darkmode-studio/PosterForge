import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Release signing is read from keystore.properties (not committed). See README.md.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
    // CI (GitHub Actions): environment variables override keystore.properties when present.
    System.getenv("PF_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }?.let { setProperty("storeFile", it) }
    System.getenv("PF_KEYSTORE_PASSWORD")?.takeIf { it.isNotBlank() }?.let { setProperty("storePassword", it) }
    System.getenv("PF_KEY_ALIAS")?.takeIf { it.isNotBlank() }?.let { setProperty("keyAlias", it) }
    System.getenv("PF_KEY_PASSWORD")?.takeIf { it.isNotBlank() }?.let { setProperty("keyPassword", it) }
}

android {
    namespace = "com.sandeep.posterforge"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sandeep.posterforge"
        minSdk = 24
        targetSdk = 36
        versionCode = 7
        versionName = "2.2.0"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

    signingConfigs {
        create("release") {
            if (keystoreProps.getProperty("storeFile") != null) {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreProps.getProperty("storeFile") != null) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    androidResources {
        // keep .wasm/.tflite/.ttf uncompressed-friendly; never strip web assets
        noCompress += listOf("wasm", "tflite")
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    buildFeatures { buildConfig = true }
    testOptions { unitTests { isIncludeAndroidResources = true; all { it.maxHeapSize = "1536m"; it.testLogging { showStandardStreams = true } } } }
    lint { abortOnError = false; checkReleaseBuilds = false }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.security.crypto)
    implementation(libs.mlkit.subject)
    implementation(libs.play.services.base)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.mockwebserver)
}
