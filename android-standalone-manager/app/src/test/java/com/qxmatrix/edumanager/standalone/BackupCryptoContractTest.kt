package com.qxmatrix.edumanager.standalone

import org.bouncycastle.crypto.generators.SCrypt
import org.junit.Assert.assertEquals
import org.junit.Test

class BackupCryptoContractTest {
    @Test fun rfc7914ScryptVectorIsStable() {
        val output = SCrypt.generate(ByteArray(0), ByteArray(0), 16, 1, 1, 64)
        assertEquals(
            "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442" +
                "fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906",
            output.joinToString("") { "%02x".format(it) },
        )
    }

    @Test fun migrationSchemaMatchesWindowsContract() {
        assertEquals("edu-manager.migration-package.v1", BackupRestoreService.PACKAGE_SCHEMA)
        assertEquals("edu-manager.migration-manifest.v1", BackupRestoreService.MANIFEST_SCHEMA)
    }
}
