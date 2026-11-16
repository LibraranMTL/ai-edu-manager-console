package com.qxmatrix.edumanager.standalone

import android.content.Context

/** The Windows students.json array contract, stored atomically in app-private state. */
class StudentIndexRepository(context: Context) {
    private val appContext = context.applicationContext
    private val stateStore = PrivateStateStore(context)
    private val licenseManager = LicenseManager(context)
    private val index = StudentIndexStore(object : StudentIndexStorage {
        override fun read() = stateStore.readIfPresent(INDEX_PATH)
        override fun write(bytes: ByteArray) = stateStore.writeBytes(INDEX_PATH, bytes)
        override fun checkpoint() = stateStore.readIfPresent("recovery/students-last-good.json")
        override fun saveCheckpoint(bytes: ByteArray) = stateStore.writeBytes("recovery/students-last-good.json", bytes)
        override fun archiveDamaged(bytes: ByteArray) = stateStore.writeBytes("recovery/students-damaged-${java.util.UUID.randomUUID()}.json", bytes)
    })

    fun list(): List<StudentRecord> = index.list()
    fun recoveryPreview(): List<StudentRecord>? = index.recoveryPreview()
    fun restoreCheckpoint(): List<StudentRecord> = index.restoreCheckpoint()

    fun add(record: StudentRecord): List<StudentRecord> = index.mutate { current ->
        validateAdd(record, current)
        val next = current + record
        next to next
    }

    fun addImportedIdempotent(record: StudentRecord): List<StudentRecord> = index.mutate { current ->
        val existing = current.singleOrNull { it.id == record.id }
        if (existing != null) {
            require(existing.name == record.name && existing.storageRootUri == record.storageRootUri) { "相同学生 ID 已被其他档案使用" }
            current to current
        } else {
            validateAdd(record, current)
            val next = current + record
            next to next
        }
    }

    fun validateAdd(record: StudentRecord) {
        validateAdd(record, list())
    }

    private fun validateAdd(record: StudentRecord, current: List<StudentRecord>) {
        licenseManager.requireCanAddStudent(current.size)
        require(current.none { it.id == record.id }) { "学生 ID 已存在" }
        require(current.none { it.name == record.name }) { "同名学生档案已存在" }
        require(record.knowledgeBaseMode != "adopted" || current.none {
            it.knowledgeBaseMode == "adopted" && it.storageRootUri == record.storageRootUri
        }) { "该已有目录已被另一名学生档案接管" }
    }

    fun requireExact(studentId: String): StudentRecord = list().singleOrNull { it.id == studentId }
        ?: throw NoSuchElementException("未找到指定学生 ID：$studentId")

    fun remove(studentId: String): StudentRecord = index.mutate { current ->
        val target = current.singleOrNull { it.id == studentId }
            ?: throw NoSuchElementException("未找到指定学生 ID：$studentId")
        current.filterNot { it.id == studentId } to target
    }

    fun updateProfile(studentId: String, profile: StudentPlanningProfile): StudentRecord {
        val updated = index.mutate { current ->
            val target = current.singleOrNull { it.id == studentId } ?: error("未找到指定学生")
            profile.toJson() // Validate only explicitly edited V2 data.
            val original = target.toJson()
            val history = original.optJSONArray("planningProfileHistory") ?: org.json.JSONArray()
            val previous = org.json.JSONObject()
            StudentPlanningProfile.keys.forEach { key -> if (original.has(key)) previous.put(key, original.get(key)) }
            history.put(org.json.JSONObject().put("savedAt", Timestamp.now()).put("previous", previous))
            original.put("planningProfileHistory", history)
            val next = target.copy(planningProfile = profile, preservedFields = original.toString())
            current.map { if (it.id == studentId) next else it } to next
        }
        StudioAutomation.enqueueCheck(appContext, studentId)
        return updated
    }

    /**
     * Updates only the human-maintained basics of an existing student archive.
     *
     * In particular, this deliberately does not re-create paths or identifiers: adopted
     * archives may contain years of materials whose folder names pre-date a corrected
     * display name.  Changing a grade must therefore never move materials, rebind a
     * project, or create a second student identity.
     */
    fun updateBasicProfile(
        studentId: String,
        name: String,
        grade: String,
        school: String,
        goal: String,
    ): StudentRecord = index.mutate { current ->
        val target = current.singleOrNull { it.id == studentId } ?: error("未找到指定学生")
        val cleanName = StudentNamePolicy.sanitize(name)
        require(current.none { it.id != studentId && it.name == cleanName }) { "同名学生档案已存在" }

        val original = target.toJson()
        val history = original.optJSONArray("basicProfileHistory") ?: org.json.JSONArray()
        history.put(org.json.JSONObject().apply {
            put("savedAt", Timestamp.now())
            put("previous", org.json.JSONObject().apply {
                put("name", target.name)
                put("grade", target.grade)
                put("school", target.school)
                put("goal", target.goal)
            })
        })
        original.put("basicProfileHistory", history)
        val next = target.copy(
            name = cleanName,
            grade = grade.trim(),
            school = school.trim(),
            goal = goal.trim(),
            preservedFields = original.toString(),
        )
        current.map { if (it.id == studentId) next else it } to next
    }

    companion object {
        private const val INDEX_PATH = "students.json"
    }
}
