package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CourseCatalogCanonicalizationTest {
    @Test fun slashInUrlMatchesJavascriptJsonStringify() {
        val value = JSONObject().put("url", "https://www.starfall.com/h/")
        assertEquals("{\"url\":\"https://www.starfall.com/h/\"}", CourseCatalogCanonicalJson.canonicalize(value))
    }

    @Test fun keysAreSortedAndControlsUseJavascriptEscapes() {
        val value = JSONObject().put("z", JSONArray().put("line\nnext").put(2)).put("a", true)
        assertEquals("{\"a\":true,\"z\":[\"line\\nnext\",2]}", CourseCatalogCanonicalJson.canonicalize(value))
    }

    @Test fun windowsNullExpiryRemainsNonExpiring() {
        val value = JSONObject().put("expiresAt", JSONObject.NULL)
        assertTrue(catalogNullableText(value, "expiresAt").isEmpty())
    }
}
