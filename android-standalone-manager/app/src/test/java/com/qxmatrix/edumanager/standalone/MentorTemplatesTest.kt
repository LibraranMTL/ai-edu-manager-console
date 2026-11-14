package com.qxmatrix.edumanager.standalone

import org.junit.Assert.*
import org.junit.Test

class MentorTemplatesTest {
    @Test fun allStudentTerminalTasksHaveScopedPrompts() {
        assertEquals(listOf(4, 4, 2, 4, 4), MentorTemplates.learningActions.map { it.size })
        assertEquals(List(6) { 4 }, MentorTemplates.projectActions.map { it.size })
        MentorTemplates.learningActions.forEachIndexed { g, actions -> actions.forEachIndexed { a, value ->
            val prompt = MentorTemplates.learning("学生甲", "student-a", g, a)
            assertTrue(prompt.contains(MentorTemplates.label(value)))
            assertTrue(prompt.contains("学生甲（student-a）"))
            assertTrue(prompt.contains(value.substringAfter('｜')))
            assertTrue(prompt.contains(HostMentorActions.learning[g][a].workflow.first()))
            assertTrue(prompt.contains(HostMentorActions.learning[g][a].output))
        } }
        MentorTemplates.projectActions.forEachIndexed { stage, actions -> actions.forEachIndexed { action, value ->
            val prompt = MentorTemplates.project("学生甲", "student-a", "项目甲", "project-a", stage, action)
            assertTrue(prompt.contains(value.substringAfter('｜')))
            assertTrue(prompt.contains(HostMentorActions.project[stage][action].workflow.first()))
            assertTrue(prompt.contains(HostMentorActions.project[stage][action].boundary))
            assertTrue(prompt.contains("学生甲（student-a）"))
            assertTrue(prompt.contains("项目甲（project-a）"))
        } }
    }
    @Test(expected = IllegalArgumentException::class) fun missingStudentCannotGeneratePrompt() {
        MentorTemplates.learning("", "student-a", 0, 0)
    }
    @Test(expected = IllegalArgumentException::class) fun missingProjectCannotGeneratePrompt() {
        MentorTemplates.project("学生甲", "student-a", "", "project-a", 0, 0)
    }
}
