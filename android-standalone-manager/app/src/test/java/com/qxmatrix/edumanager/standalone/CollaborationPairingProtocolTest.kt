package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CollaborationPairingProtocolTest {
    @Test fun verifiesWindowsGeneratedDeviceConfirmationVector() {
        val confirmation = JSONObject(WINDOWS_CONFIRMATION)
        val verified = CollaborationPairingProtocol.verifyDeviceConfirmation(confirmation, "node-android-fixture")
        assertEquals("node-windows-fixture", verified.peerNodeId)
        assertEquals("device-binding-d3f6cf6a83a5891b37d4c4598a36a53f", verified.deviceBindingId)
        assertEquals(listOf("http://192.168.1.10:18777"), verified.endpoints)
        assertEquals("fixture-shared-secret", verified.sharedSecret)
    }

    @Test fun rejectsAlteredWindowsConfirmationProof() {
        val confirmation = JSONObject(WINDOWS_CONFIRMATION).put("proof", "0".repeat(64))
        val error = runCatching { CollaborationPairingProtocol.verifyDeviceConfirmation(confirmation, "node-android-fixture") }.exceptionOrNull()
        assertTrue(error?.message?.contains("签名无效") == true)
    }

    @Test fun connectionInfoRequiresUnexpiredPrivateOrManagedEndpoint() {
        val valid = JSONObject()
            .put("schema", CollaborationPairingProtocol.DEVICE_CONNECTION_SCHEMA)
            .put("protocolVersion", "1.0")
            .put("invitationId", "fixture")
            .put("nodeId", "node-windows")
            .put("pairingCode", "123456")
            .put("expiresAt", "2026-08-10T01:00:00Z")
            .put("endpoints", org.json.JSONArray().put("http://192.168.1.10:18777"))
        val parsed = CollaborationPairingProtocol.parseConnectionInput(valid.toString(), 1_786_323_000_000L)
        assertEquals("123456", parsed.pairingCode)
        assertEquals(listOf("http://192.168.1.10:18777"), parsed.endpoints)
        assertNull(CollaborationPairingProtocol.normalizeEndpoint("http://8.8.8.8:18777"))
        assertEquals("https://example.com", CollaborationPairingProtocol.normalizeEndpoint("https://example.com/"))
    }

    @Test fun sixDigitCodeCanUseLanDiscoveryWithoutEmbeddingAnAddress() {
        val parsed = CollaborationPairingProtocol.parseConnectionInput("123 456")
        assertEquals("123456", parsed.pairingCode)
        assertTrue(parsed.endpoints.isEmpty())
    }

    @Test fun studentMappingUsesTheExplicitLocalStudentIdAndProducesWindowsAcceptance() {
        val offer = studentOffer()
        val accepted = CollaborationPairingProtocol.acceptStudentMappingOffer(
            offer.toString(), "node-android-fixture", "student-local-exact", "fixture-shared-secret", 1_786_320_300_000L,
        )
        assertEquals("student-local-exact", accepted.localStudentId)
        assertEquals("student-windows-exact", accepted.peerStudentId)
        val output = JSONObject(accepted.acceptanceJson)
        assertEquals(CollaborationPairingProtocol.STUDENT_MAPPING_ACCEPTANCE_SCHEMA, output.getString("schema"))
        assertEquals("binding-student-fixture", accepted.transportBindingId)
        assertEquals("938faf068d5cd36e39f4bca921efbbdb96ece839605aabe423491f6e4cc1675f", output.getString("proof"))
        val participants = output.getJSONObject("studentMap").getJSONArray("participantStudents")
        assertTrue((0 until participants.length()).map { participants.getJSONObject(it).getString("studentId") }.contains("student-local-exact"))
        assertTrue(output.getString("proof").matches(Regex("^[a-f0-9]{64}$")))
    }

    @Test fun studentMappingRejectsAnOfferWithoutTheTrustedDeviceSecret() {
        val offer = studentOffer().put("proof", "0".repeat(64))
        val error = runCatching {
            CollaborationPairingProtocol.acceptStudentMappingOffer(
                offer.toString(), "node-android-fixture", "student-local-exact", "fixture-shared-secret", 1_786_320_300_000L,
            )
        }.exceptionOrNull()
        assertTrue(error?.message?.contains("信任校验") == true)
    }

    private fun studentOffer(): JSONObject {
        val offer = JSONObject()
            .put("schema", CollaborationPairingProtocol.STUDENT_MAPPING_OFFER_SCHEMA)
            .put("protocolVersion", "1.0")
            .put("offerId", "student-map-offer-fixture")
            .put("deviceBindingId", "device-binding-d3f6cf6a83a5891b37d4c4598a36a53f")
            .put("transportBindingId", "binding-fixture")
            .put("mappingBindingId", "binding-student-fixture")
            .put("inviterNodeId", "node-windows-fixture")
            .put("inviterStudentId", "student-windows-exact")
            .put("inviterStudentName", "远端学生")
            .put("createdAt", "2026-08-10T00:00:00.000Z")
            .put("expiresAt", "2026-08-10T01:00:00.000Z")
        offer.put("proof", CollaborationCrypto.hmac("fixture-shared-secret", listOf(
            offer.getString("offerId"), offer.getString("deviceBindingId"), offer.getString("transportBindingId"),
            offer.getString("mappingBindingId"), offer.getString("inviterNodeId"), offer.getString("inviterStudentId"), offer.getString("expiresAt"),
        )))
        return offer
    }

    companion object {
        private const val WINDOWS_CONFIRMATION = """{"schema":"edu-manager.collaboration-device-confirmation.v1","protocolVersion":"1.0","confirmationId":"device-confirmation-fixture","invitationId":"device-invitation-fixture","transportBindingId":"binding-fixture","inviterNode":{"schema":"edu-manager.collaboration-node.v1","protocolVersion":"1.0","nodeId":"node-windows-fixture","displayName":"Windows Fixture","machineCode":"WINFIXTURE","ownerIdentityId":"","publicKey":"","capabilities":[],"transportOffers":[],"createdAt":"2026-08-01T00:00:00.000Z","revokedAt":""},"acceptingNode":{"schema":"edu-manager.collaboration-node.v1","protocolVersion":"1.0","nodeId":"node-android-fixture","displayName":"Android Fixture","machineCode":"ANDFIXTURE","ownerIdentityId":"","publicKey":"","capabilities":[],"transportOffers":[],"createdAt":"2026-08-02T00:00:00.000Z","revokedAt":""},"binding":{"schema":"edu-manager.peer-binding.v1","protocolVersion":"1.0","bindingId":"binding-fixture","participantNodeIds":["node-windows-fixture","node-android-fixture"],"roleAssignments":[],"sharedSecretRef":"4497340e92494d63f9065064b98e9f2887179d26f0a153117865c02072fe550e","status":"active","capabilities":[],"transportOffers":[{"transportId":"lan_direct","protocolVersion":"1.0","endpoints":["http://192.168.1.10:18777"],"preferred":true,"nodeId":"node-windows-fixture"}],"createdAt":"2026-08-10T00:00:00.000Z","lastSeenAt":"","revokedAt":""},"deviceBinding":{"schema":"edu-manager.collaboration-device-binding.v1","deviceBindingId":"device-binding-d3f6cf6a83a5891b37d4c4598a36a53f","participantNodeIds":["node-android-fixture","node-windows-fixture"],"status":"active","capabilities":["device-trust-v1","student-mapping-v1"],"transportOffers":[{"transportId":"lan_direct","protocolVersion":"1.0","endpoints":["http://192.168.1.10:18777"],"preferred":true,"nodeId":"node-windows-fixture"}],"transportBindingIds":["binding-fixture"],"origin":"native","createdAt":"2026-08-10T00:00:00.000Z","updatedAt":"2026-08-10T00:00:00.000Z","revokedAt":""},"sharedSecret":"fixture-shared-secret","confirmedAt":"2026-08-10T00:05:00.000Z","proof":"fc10a2a3100b7d445bab644afe69ad52c8a951168872b6394f4f012e94c015d4"}"""
    }
}
