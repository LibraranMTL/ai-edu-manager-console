package com.qxmatrix.edumanager.standalone

/**
 * W0 protocol baseline copied from the Windows host implementation.
 * These values are compatibility contracts, not Android-specific replacements.
 */
object ProtocolBaseline {
    const val TASK_PROTOCOL_VERSION = "1.2"
    const val KNOWLEDGE_ENGINE_CONTRACT_VERSION = "edu-manager.knowledge-engine.v1"
    const val EDUCATION_DOMAIN_PROTOCOL_VERSION = "edu-manager.education-domain.v1"
    const val COURSE_CAPTURE_SCHEMA = "edu-manager.course-capture.v1"
    const val COURSE_PACKAGE_SCHEMA = "edu-manager.course-package.v3"
    const val CAPTURE_PROTOCOL_VERSION = 1
    const val ASSET_INDEX_VERSION = 1
    const val PROJECT_INDEX_VERSION = 1

    val materialStatuses = linkedSetOf(
        "pending_digest",
        "submitted",
        "digesting",
        "processed",
        "ignored",
        "invalid",
        "failed",
        "removed",
    )

    val explicitlyDisabledScopes = linkedSetOf(
        "windows_host_service",
        "terminal_pairing",
        "tailscale_connection",
        "cross_host_collaboration",
        "parent_role_ui",
        "tenant_course_management",
    )
}
