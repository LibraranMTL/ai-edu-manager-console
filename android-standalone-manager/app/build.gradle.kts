import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
}

val releaseStoreFile = providers.environmentVariable("EDU_ANDROID_KEYSTORE").orNull
val releaseStorePassword = providers.environmentVariable("EDU_ANDROID_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("EDU_ANDROID_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("EDU_ANDROID_KEY_PASSWORD").orNull
val releaseSigningReady = listOf(releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { !it.isNullOrBlank() }
val publicContentBaseUrl = providers.gradleProperty("eduPublicContentBaseUrl")
    .orElse(providers.environmentVariable("EDU_PUBLIC_CONTENT_BASE_URL"))
    .orElse("https://www.greatbg.com/edu-cloud")
    .get()
    .trimEnd('/')
val publicContentUri = URI(publicContentBaseUrl)
require(publicContentUri.scheme == "https" && publicContentUri.userInfo == null && publicContentUri.host != null && publicContentUri.query == null && publicContentUri.fragment == null) {
    "eduPublicContentBaseUrl must be an HTTPS base URL without credentials, query, or fragment"
}

kapt {
    arguments {
        arg("room.schemaLocation", "$projectDir/schemas")
    }
}

android {
    namespace = "com.qxmatrix.edumanager.standalone"
    compileSdk = 34

    buildFeatures {
        // PublicCourseSyncService reports the installed client version in privacy-bounded sync receipts.
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.qxmatrix.edumanager.standalone"
        minSdk = 23
        targetSdk = 34
        versionCode = 39
        versionName = "1.3.5"

        // Candidate/device builds must bind to their explicit public-content environment.
        // Production remains the default; secrets and runtime student data are never embedded here.
        buildConfigField("String", "PUBLIC_CONTENT_BASE_URL", "\"$publicContentBaseUrl\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(requireNotNull(releaseStoreFile))
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            if (releaseSigningReady) signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
    sourceSets.getByName("test").resources.srcDir("schemas")
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.0")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-savedstate:2.8.4")
    implementation("androidx.room:room-ktx:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("com.google.mlkit:text-recognition-chinese:16.0.1")
    implementation("com.google.zxing:core:3.5.3")
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
    kapt("androidx.room:room-compiler:2.6.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.13")
    testImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit-ktx:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.work:work-testing:2.9.0")
}
