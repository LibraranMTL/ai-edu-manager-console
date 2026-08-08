package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Test

class AgentEndpointTest {
    @Test fun appendsChatCompletionsToBaseUrl() {
        assertEquals("https://ark.cn-beijing.volces.com/api/v3/chat/completions", OpenAiCompatibleAgentAdapter.resolveChatCompletionsUrl("https://ark.cn-beijing.volces.com/api/v3"))
    }

    @Test fun preservesFullChatCompletionsUrl() {
        assertEquals("https://ark.cn-beijing.volces.com/api/v3/chat/completions", OpenAiCompatibleAgentAdapter.resolveChatCompletionsUrl("https://ark.cn-beijing.volces.com/api/v3/chat/completions"))
    }
}
