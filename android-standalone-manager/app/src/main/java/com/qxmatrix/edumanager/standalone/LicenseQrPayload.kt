package com.qxmatrix.edumanager.standalone

object LicenseQrPayload {
    private const val MAX_TOKEN_LENGTH = 16_384

    fun normalize(raw: String?): String? {
        val token = raw?.trim().orEmpty()
        if (token.length !in 16..MAX_TOKEN_LENGTH) return null
        if (!token.startsWith("AIE3.")) return null
        if (token.count { it == '.' } != 2) return null
        if (token.any { it.isWhitespace() }) return null
        return token
    }
}
