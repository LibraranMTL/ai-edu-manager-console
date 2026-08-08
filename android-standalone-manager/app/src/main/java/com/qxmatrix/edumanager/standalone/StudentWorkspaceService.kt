package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri

data class StudentWorkspaceScan(
    val paths: StudentWorkspacePaths,
    val agentMd: Boolean,
    val rawDir: Boolean,
    val summaryDir: Boolean,
    val outputDir: Boolean,
    val indexMd: Boolean,
    val logMd: Boolean,
)

class StudentWorkspaceService(private val context: Context) {
    private val students = StudentIndexRepository(context)

    fun createStandard(name: String, grade: String, school: String, goal: String, baseRootUri: Uri): StudentRecord {
        val record = StudentRecord.create(name, grade, school, goal, "standard", baseRootUri.toString())
        students.validateAdd(record)
        val store = SafWorkspaceStore(context, baseRootUri)
        require(!store.exists(record.paths.rootPath)) { "同名学生知识库目录已存在，请使用接管已有目录" }
        initializeWorkspace(store, record)
        students.add(record)
        GrowthModelService(context).ensure(record.id)
        return record
    }

    fun scanAdopted(name: String, rootUri: Uri): StudentWorkspaceScan {
        val cleanName = StudentNamePolicy.sanitize(name)
        val store = SafWorkspaceStore(context, rootUri)
        val directories = store.listRoot().filter { it.isDirectory }.mapNotNull { it.name }
        val preferred = StudentWorkspacePaths.adopted(cleanName)
        val rawPath = findDirectory(directories, preferred.rawPath, listOf("原始资料库", "原始资料", "raw", "materials", "资料库"))
            ?: preferred.rawPath
        val summaryPath = findDirectory(directories, preferred.summaryPath, listOf("学情分析汇总", "汇总", "summary", "report", "分析", "综合"))
            ?: preferred.summaryPath
        val outputPath = findDirectory(directories, preferred.outputPath, listOf("输出结果", "输出", "result"))
            ?: preferred.outputPath
        val paths = preferred.copy(rawPath = rawPath, summaryPath = summaryPath, outputPath = outputPath)
        return StudentWorkspaceScan(
            paths = paths,
            agentMd = store.exists(paths.agentPath),
            rawDir = store.exists(paths.rawPath),
            summaryDir = store.exists(paths.summaryPath),
            outputDir = store.exists(paths.outputPath),
            indexMd = store.exists("${paths.summaryPath}/index.md"),
            logMd = store.exists("${paths.summaryPath}/log.md"),
        )
    }

    fun adoptExisting(name: String, grade: String, school: String, goal: String, rootUri: Uri): Pair<StudentRecord, StudentWorkspaceScan> {
        val scan = scanAdopted(name, rootUri)
        val record = StudentRecord.create(name, grade, school, goal, "adopted", rootUri.toString())
            .copy(paths = scan.paths)
        students.validateAdd(record)
        initializeWorkspace(SafWorkspaceStore(context, rootUri), record)
        students.add(record)
        GrowthModelService(context).ensure(record.id)
        return record to scan
    }

    fun listStudents(): List<StudentRecord> = students.list()

    fun requireStudent(studentId: String): StudentRecord = students.requireExact(studentId)

    fun knowledgeEngine(studentId: String): LlmWikiKnowledgeEngine {
        val student = students.requireExact(studentId)
        val safStore = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
        return LlmWikiKnowledgeEngine(student.id, SafKnowledgeDocumentStore(safStore, student.paths.rootPath))
    }

    private fun initializeWorkspace(store: SafWorkspaceStore, student: StudentRecord) {
        val paths = student.paths
        if (paths.rootPath.isNotBlank()) store.ensureDirectory(paths.rootPath)
        listOf(
            paths.outputPath,
            paths.rawPath,
            "${paths.rawPath}/图片",
            paths.summaryPath,
            "${paths.summaryPath}/摘要库",
            "${paths.summaryPath}/概念库",
            "${paths.summaryPath}/实体库",
            "${paths.summaryPath}/综合库",
            "${paths.summaryPath}/咨询精华库",
            child(paths.rootPath, ".edu-manager"),
        ).forEach(store::ensureDirectory)

        writeTextIfMissing(store, paths.agentPath, agentTemplate(student))
        writeTextIfMissing(store, "${paths.summaryPath}/index.md", "# ${student.name} 学情分析索引\n\n尚无已消化资料。\n")
        writeTextIfMissing(store, "${paths.summaryPath}/log.md", "# ${student.name} 知识库更新日志\n\n- ${student.createdAt}：档案库初始化。\n")
    }

    private fun writeTextIfMissing(store: SafWorkspaceStore, path: String, content: String) {
        if (!store.exists(path)) store.writeBytesSafely(path, content.toByteArray(Charsets.UTF_8), "text/markdown")
    }

    private fun agentTemplate(student: StudentRecord): String = """
        # ${student.name} 教育管家 AGENT.md

        ## 目录

        - 原始资料库：${student.paths.rawPath}
        - 学情分析汇总：${student.paths.summaryPath}
        - 输出结果：${student.paths.outputPath}

        ## 基本规则

        1. 只处理本学生档案范围内的资料，不读取其他学生目录。
        2. 不移动、删除或覆盖原始资料；知识产物保留来源文件名或相对路径。
        3. 每次资料消化后更新 index.md 和 log.md。
        4. 能力判断、成长证据和正式学情报告必须作为候选，确认后才能发布。
    """.trimIndent() + "\n"

    private fun findDirectory(names: List<String>, preferred: String, keywords: List<String>): String? {
        names.firstOrNull { it == preferred }?.let { return it }
        return names.firstOrNull { name -> keywords.any { keyword -> name.contains(keyword, ignoreCase = true) } }
    }

    private fun child(root: String, relative: String): String = if (root.isBlank()) relative else "$root/$relative"
}
