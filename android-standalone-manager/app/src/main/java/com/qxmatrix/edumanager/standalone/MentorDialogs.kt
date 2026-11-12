package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.webkit.WebView
import android.widget.Toast

object MentorDialogs {
    private fun valid(activity: Activity, student: StudentRecord, project: ProjectRecord? = null): Boolean {
        if (activity.isFinishing || activity.isDestroyed) return false
        val current = activity.getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, Context.MODE_PRIVATE)
            .getString(MainActivity.KEY_CURRENT_STUDENT_ID, "")
        if (current != student.id) return false
        return runCatching {
            StudentIndexRepository(activity).requireExact(student.id)
            if (project != null) {
                val fresh = ProjectRepository(activity).requireExact(project.id)
                require(student.id in fresh.studentIds && fresh.status !in setOf("archived", "sealed"))
            }
        }.isSuccess
    }

    private fun check(activity: Activity, student: StudentRecord, project: ProjectRecord? = null): Boolean {
        if (valid(activity, student, project)) return true
        Toast.makeText(activity, "学生或项目范围已变化，请重新选择", Toast.LENGTH_LONG).show()
        return false
    }

    fun learning(activity: Activity, student: StudentRecord) {
        if (!check(activity, student)) return
        AlertDialog.Builder(activity).setTitle("学习导师 · 学习模式")
            .setItems(MentorTemplates.learningGroups.toTypedArray()) { _, group ->
                if (check(activity, student)) AlertDialog.Builder(activity)
                    .setTitle("学习导师 · ${MentorTemplates.learningGroups[group]}")
                    .setItems(MentorTemplates.learningActions[group].toTypedArray()) { _, action ->
                        if (check(activity, student)) preview(activity, student, null,
                            "学习导师 · ${MentorTemplates.label(MentorTemplates.learningActions[group][action])}",
                            MentorTemplates.learning(student.name, student.id, group, action))
                    }.setNegativeButton("返回", null).show()
            }.setNegativeButton("取消", null).show()
    }

    fun project(activity: Activity, student: StudentRecord, project: ProjectRecord) {
        if (!check(activity, student, project)) return
        AlertDialog.Builder(activity).setTitle("${project.name} · 项目导师")
            .setItems(MentorTemplates.projectStages.toTypedArray()) { _, stage ->
                if (check(activity, student, project)) AlertDialog.Builder(activity)
                    .setTitle(MentorTemplates.projectStages[stage])
                    .setItems(MentorTemplates.projectActions[stage].toTypedArray()) { _, action ->
                        if (check(activity, student, project)) preview(activity, student, project,
                            "项目导师 · ${MentorTemplates.label(MentorTemplates.projectActions[stage][action])}",
                            MentorTemplates.project(student.name, student.id, project.name, project.id, stage, action))
                    }.setNegativeButton("返回", null).show()
            }.setNegativeButton("取消", null).show()
    }

    private fun preview(activity: Activity, student: StudentRecord, project: ProjectRecord?, title: String, markdown: String) {
        val web = WebView(activity).apply {
            settings.javaScriptEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            loadDataWithBaseURL(null, MarkdownRenderer.html("复制正文后可粘贴到 Agent；复制不会自动读取、发送或写入资料。\n\n$markdown"), "text/html", "UTF-8", null)
        }
        val dialog = AlertDialog.Builder(activity).setTitle(title).setView(web)
            .setPositiveButton("复制正文", null).setNegativeButton("关闭", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (check(activity, student, project)) {
                    (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                        .setPrimaryClip(ClipData.newPlainText(title, markdown))
                    Toast.makeText(activity, "已复制正文", Toast.LENGTH_SHORT).show()
                }
            }
        }
        dialog.setOnDismissListener { web.destroy() }
        dialog.show()
    }
}
