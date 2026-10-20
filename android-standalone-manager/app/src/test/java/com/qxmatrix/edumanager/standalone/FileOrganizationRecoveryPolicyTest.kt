package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Test

class FileOrganizationRecoveryPolicyTest {
    private fun decision(sourceHash: String?, targetHash: String?, registeredHash: String = "hash", path: String = "inbox/a.pdf") =
        FileOrganizationRecoveryPolicy.decision(sourceHash, targetHash, "hash", registeredHash, path, "inbox/a.pdf", "资料/a.pdf")
    @Test fun completedMoveIsRecoveredOnlyWhenIdentityAndTargetHashAgree() {
        assertEquals("adopt_target", decision(null, "hash"))
        assertEquals("adopt_target", decision(null, "hash", path = "资料/a.pdf"))
        assertEquals("needs_user", decision(null, "changed"))
        assertEquals("needs_user", decision(null, "hash", registeredHash = "new-version"))
        assertEquals("needs_user", decision(null, "hash", path = "another/a.pdf"))
    }
    @Test fun unstartedMoveKeepsOriginalAndAmbiguousCopiesNeverGetDeleted() {
        assertEquals("keep_source", decision("hash", null))
        assertEquals("needs_user", decision("hash", "hash"))
        assertEquals("needs_user", decision("changed", null))
        assertEquals("needs_user", decision(null, null))
    }
}
