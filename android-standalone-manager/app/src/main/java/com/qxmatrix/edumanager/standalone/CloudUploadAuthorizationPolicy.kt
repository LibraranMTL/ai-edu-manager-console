package com.qxmatrix.edumanager.standalone

object CloudUploadAuthorizationPolicy {
    val PROFILE_FIELDS = listOf("displayName", "grade", "school", "learningGoal", "currentRegion", "phone", "email", "birthday", "address", "guardian")
    val MATERIAL_CATEGORIES = listOf("learning_report", "learning_material", "topic_suggestion", "competition_recommendation", "learning_card")
    val PURPOSES = setOf("document_sync", "expert_interpretation")
    const val MIN_LIFETIME_MS = 10 * 60 * 1_000L
    const val MAX_LIFETIME_MS = 365L * 24 * 60 * 60 * 1_000
    const val UNTIL_REVOKED = -1L

    fun validate(profileFields: Set<String>, materialCategories: Set<String>, purpose: String,
        expiresAt: Long, now: Long = System.currentTimeMillis()) {
        require(profileFields.isNotEmpty() || materialCategories.isNotEmpty()) { "至少选择一项基础信息或资料类别" }
        require(profileFields.all { it in PROFILE_FIELDS } && (profileFields.isEmpty() || "displayName" in profileFields)) {
            "基础信息字段范围无效；选择基础信息时必须包含姓名"
        }
        require(materialCategories.all { it in MATERIAL_CATEGORIES }) { "资料类别无效" }
        require(purpose in PURPOSES) { "授权用途无效" }
        require(expiresAt == UNTIL_REVOKED || expiresAt in (now + MIN_LIFETIME_MS)..(now + MAX_LIFETIME_MS)) { "授权有效期无效" }
    }

    fun isExpired(expiresAt: Long, now: Long = System.currentTimeMillis()) = expiresAt > 0 && expiresAt <= now
}
