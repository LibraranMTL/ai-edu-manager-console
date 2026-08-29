package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationPublicLinkServiceTest {
    @Test fun rejectsLiteralPrivateAndLocalHosts() {
        assertFalse(ConversationPublicLinkService.isPublicHost("localhost"))
        assertFalse(ConversationPublicLinkService.isPublicHost("127.0.0.1"))
        assertFalse(ConversationPublicLinkService.isPublicHost("10.0.0.8"))
        assertFalse(ConversationPublicLinkService.isPublicHost("192.168.1.2"))
        assertTrue(ConversationPublicLinkService.isPublicHost("example.com"))
    }

    @Test fun stripsExecutableHtmlAndKeepsVisibleConversationText() {
        val text = ConversationPublicLinkService.htmlToText("<h1>对话</h1><script>secret()</script><p>用户：你好</p><p>助手：你好</p>")
        assertTrue(text.contains("用户：你好"))
        assertTrue(text.contains("助手：你好"))
        assertFalse(text.contains("secret"))
    }
}
