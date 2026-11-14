package com.qxmatrix.edumanager.standalone

import android.provider.DocumentsContract
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FaultHarnessSmokeTest {
    @Test fun syntheticTreeIsConfinedToFaultTestPackage() {
        assumeTrue(BuildConfig.FAULT_HARNESS)
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertTrue(context.packageName.endsWith(".faulttest"))
        val root = DocumentsContract.buildTreeDocumentUri("${context.packageName}.faultdocuments", "root")
        val store = SafWorkspaceStore(context, root)
        store.ensureDirectory("synthetic")
        val text = "Synthetic material only; no real student data."
        store.writeBytesSafely("synthetic/smoke.txt", text.toByteArray(), "text/plain")
        assertEquals(text, store.readBytes("synthetic/smoke.txt").toString(Charsets.UTF_8))
    }
}
