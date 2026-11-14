package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

data class PublicLearningCardChoice(
    val packId: String,
    val packTitle: String,
    val templateId: String,
    val templateRevision: String,
    val prompt: String,
    val subject: String,
    val locale: String,
    internal val pack: JSONObject,
    internal val template: JSONObject,
)

/** Deterministic validation and instantiation for public, non-student learning-card templates. */
object PublicLearningCardPolicy {
    private val locales = setOf("zh-CN", "zh-TW", "en-US", "en-GB", "fr", "es", "es-419", "ja", "ko", "vi", "ms")
    private val types = setOf("single_choice", "multiple_choice", "true_false", "short_answer", "self_check", "feynman", "task")
    private val answerPolicies = setOf("exact", "rubric", "self_review")
    private val templateId = Regex("^(platform|tenant):card-template:[a-z0-9][a-z0-9-]{2,120}$")
    private val packId = Regex("^(platform|tenant):card-pack:[a-z0-9][a-z0-9-]{2,120}$")

    fun validateManifest(manifest: JSONObject) {
        val courseIds = objects(manifest.optJSONArray("courses")).map { it.getString("courseId") }.toSet()
        val seenPacks = linkedSetOf<String>()
        val revisionContent = linkedMapOf<String, String>()
        for (pack in objects(manifest.optJSONArray("cardPacks"))) {
            val id = pack.getString("packId")
            require(packId.matches(id) && seenPacks.add(id)) { "公共学习卡包ID无效或重复" }
            val locale = pack.getString("locale"); require(locale in locales) { "公共学习卡包语言不受支持" }
            val packCourses = strings(pack.optJSONArray("courseIds"))
            require(packCourses.all { it in courseIds }) { "公共学习卡包关联了清单外课程" }
            val declared = strings(pack.getJSONArray("templateIds")); require(declared.isNotEmpty() && declared.distinct().size == declared.size) { "公共学习卡包模板列表无效" }
            val templates = objects(pack.getJSONArray("templates")); require(templates.size == declared.size) { "公共学习卡包模板数量不一致" }
            require(templates.map { it.getString("templateId") }.toSet() == declared.toSet()) { "公共学习卡包模板引用不一致" }
            for (template in templates) {
                val idValue = template.getString("templateId")
                require(templateId.matches(idValue)) { "公共学习卡模板ID无效" }
                require(template.getString("locale") == locale) { "公共学习卡模板与卡片包语言不一致" }
                require(template.getString("templateType") in types) { "公共学习卡题型不受支持" }
                require(template.getString("answerPolicy") in answerPolicies) { "公共学习卡答案策略不受支持" }
                require(template.getString("prompt").isNotBlank() && template.getString("prompt").length <= 8_000) { "公共学习卡题干无效" }
                require(strings(template.optJSONArray("knowledgePointIds")).isNotEmpty()) { "公共学习卡缺少知识点" }
                require(strings(template.optJSONArray("sourceRefs")).isNotEmpty()) { "公共学习卡缺少公共来源" }
                val templateCourses = strings(template.optJSONArray("courseIds"))
                require(templateCourses.all { it in packCourses }) { "公共学习卡模板关联课程不属于卡片包" }
                when (template.getString("answerPolicy")) {
                    "exact" -> require(template.optString("answer").isNotBlank()) { "公共学习卡缺少可验证答案" }
                    "rubric" -> require(template.optString("rubric").isNotBlank()) { "公共学习卡缺少评分规则" }
                }
                val revision = template.getString("templateRevision")
                require(revision.isNotBlank() && revision.length <= 120) { "公共学习卡模板修订无效" }
                val canonical = CourseCatalogCanonicalJson.canonicalize(JSONObject(template.toString()))
                revisionContent[revision]?.let { require(it == canonical) { "同一公共学习卡修订对应不同内容" } }
                revisionContent[revision] = canonical
            }
        }
    }

    fun eligible(manifest: JSONObject, locale: String, grade: String, includeOtherLanguages: Boolean = false): List<PublicLearningCardChoice> {
        validateManifest(manifest)
        val normalizedLocale = locale.takeIf { it in locales } ?: return emptyList()
        return objects(manifest.optJSONArray("cardPacks")).filter { pack ->
            (includeOtherLanguages || pack.getString("locale") == normalizedLocale) && gradeMatches(strings(pack.optJSONArray("gradeBands")), grade)
        }.flatMap { pack -> objects(pack.getJSONArray("templates")).filter { template ->
            gradeMatches(strings(template.optJSONArray("gradeBands")), grade)
        }.map { template -> PublicLearningCardChoice(
            pack.getString("packId"), pack.getString("title"), template.getString("templateId"),
            template.getString("templateRevision"), template.getString("prompt"), template.getString("subject"), pack.getString("locale"),
            JSONObject(pack.toString()), JSONObject(template.toString()),
        ) } }.distinctBy { it.templateRevision }.sortedBy { if (it.locale == normalizedLocale) 0 else 1 }
    }

    fun instancePayload(choice: PublicLearningCardChoice): JSONObject {
        val template = choice.template
        val explanation = template.optString("explanation").ifBlank { template.optString("rubric") }
        val sourceIds = JSONArray(strings(template.getJSONArray("sourceRefs")))
        val item = JSONObject().put("question", template.getString("prompt"))
            .put("answer", template.optString("answer")).put("rationale", explanation).put("sourceIds", sourceIds)
        return JSONObject().put("schema", "edu-manager.public-learning-card-instance.v1")
            .put("module", "cards").put("origin", "public_template")
            .put("packId", choice.packId).put("packRevision", choice.pack.getString("packRevision"))
            .put("templateId", choice.templateId).put("templateRevision", choice.templateRevision)
            .put("answerPolicy", template.getString("answerPolicy")).put("rubric", template.optString("rubric"))
            .put("hintPolicy", template.optString("hintPolicy"))
            .put("knowledgePointIds", JSONArray(strings(template.getJSONArray("knowledgePointIds"))))
            .put("courseIds", JSONArray(strings(template.optJSONArray("courseIds"))))
            .put("result", JSONObject().put("items", JSONArray().put(item)))
            .put("publicSourceRefs", sourceIds)
    }

    fun sourceKey(choice: PublicLearningCardChoice): String = "public-card:${choice.templateRevision}"

    private fun gradeMatches(bands: List<String>, grade: String): Boolean = bands.isEmpty() ||
        (grade.isNotBlank() && bands.any { it.equals(grade.trim(), ignoreCase = true) })
    private fun objects(array: JSONArray?): List<JSONObject> = if (array == null) emptyList() else (0 until array.length()).map { array.getJSONObject(it) }
    private fun strings(array: JSONArray?): List<String> = if (array == null) emptyList() else (0 until array.length()).map { array.getString(it) }
}

/** Creates a student-scoped immutable instance only after signed public-cache validation. */
class PublicLearningCardService(private val context: Context) {
    private val sync = PublicCourseSyncService(context)
    private val students = StudentIndexRepository(context)
    private val repository = ScopedContentRepository(context)

    fun available(studentId: String): List<PublicLearningCardChoice> {
        val student = students.requireExact(studentId)
        val manifest = requireNotNull(sync.cloudLearningCardManifest()) { "尚无有效的云端学习卡目录，请先同步云端课程" }
        val locale = supportedLocale(Locale.getDefault())
        return PublicLearningCardPolicy.eligible(manifest, locale, student.grade, includeOtherLanguages = true)
    }

    fun instantiate(studentId: String, templateRevision: String): ScopedContentEntity {
        val choice = available(studentId).singleOrNull { it.templateRevision == templateRevision }
            ?: error("学习卡模板已更新或不适用于当前学生，请刷新后重试")
        val payload = PublicLearningCardPolicy.instancePayload(choice)
        return repository.insertVersion(studentId, PublicLearningCardPolicy.sourceKey(choice),
            "${choice.packTitle} · ${choice.subject}", payload)
    }

    private fun supportedLocale(locale: Locale): String {
        val tag = locale.toLanguageTag()
        if (tag in setOf("zh-CN", "zh-TW", "en-US", "en-GB", "es-419")) return tag
        return locale.language.takeIf { it in setOf("fr", "es", "ja", "ko", "vi", "ms") } ?: "en-US"
    }
}
