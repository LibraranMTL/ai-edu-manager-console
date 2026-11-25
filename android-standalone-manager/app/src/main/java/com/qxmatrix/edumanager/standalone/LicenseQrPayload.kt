package com.qxmatrix.edumanager.standalone

object LicenseQrPayload {
    private const val MAX_TOKEN_LENGTH = 16_384

    fun normalize(raw: String?): String? {
        val token = raw?.trim().orEmpty()
        val compact = token.uppercase(java.util.Locale.US).replace(Regex("[\\s-]"), "")
        if (compact.startsWith("AEC1")) {
            if (!compact.matches(Regex("AEC1[WA][0-9A-HJKMNP-TV-Z]{32}[0-9A-F]{4}"))) return null
            val hash = java.security.MessageDigest.getInstance("SHA-256").digest(compact.dropLast(4).toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }.take(4).uppercase(java.util.Locale.US)
            return compact.takeIf { it.takeLast(4) == hash }
        }
        if (token.length !in 16..MAX_TOKEN_LENGTH) return null
        if (!token.startsWith("AIE3.")) return null
        if (token.count { it == '.' } != 2) return null
        if (token.any { it.isWhitespace() }) return null
        return token
    }
}
